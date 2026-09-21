import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma.js';

const CRITICAL_MISSING_CODES = new Set(['actor', 'outcome', 'business_rules']);

function clean(value, maxLength = 2000) { return String(value || '').replace(/\r/g, '').trim().slice(0, maxLength); }

export function buildClarificationState(result) {
  const model = result.requirement_model || {};
  const critical = [];
  for (const entry of model.missing_information || []) {
    const code = String(entry.id || '').split(':').pop();
    if (CRITICAL_MISSING_CODES.has(code)) critical.push({ type: 'missing_information', code, message: entry.message, evidence: entry.evidence || null });
  }
  if (!(model.business_rules || []).length && !critical.some((item) => item.code === 'business_rules')) critical.push({ type: 'business_rules', code: 'business_rules', message: 'As regras essenciais ainda não foram definidas.', evidence: null });
  if (!(model.acceptance_criteria || []).length) critical.push({ type: 'testability', code: 'acceptance_criteria', message: 'Os critérios principais de aceite ainda não são testáveis.', evidence: null });
  for (const entry of model.ambiguities || []) {
    if (entry.severity === 'high') critical.push({ type: 'ambiguity', code: entry.id, message: entry.message, evidence: entry.evidence || null });
  }
  for (const entry of model.contradictions || []) critical.push({ type: 'contradiction', code: entry.id, message: entry.message, evidence: entry.evidence || null });

  const questionByCode = {
    actor: 'Qual perfil inicia este fluxo?',
    outcome: 'Qual resultado de negócio deve ser alcançado?',
    business_rules: 'Qual regra, limite ou permissão é obrigatória?',
    acceptance_criteria: 'Qual resultado observável confirma o aceite?',
  };
  const questions = [];
  for (const issue of critical) {
    const existing = (model.clarification_questions || []).find((question) => String(question.relates_to) === issue.code);
    const question = clean(existing?.question || questionByCode[issue.code] || issue.message, 500);
    if (question && !questions.some((item) => item.question === question)) questions.push({ id: existing?.id || `CQ-${String(questions.length + 1).padStart(2, '0')}`, question, relates_to: issue.code });
  }
  return {
    status: critical.length ? 'required' : 'completed',
    finalization: {
      no_critical_problems: !critical.some((item) => ['missing_information', 'contradiction'].includes(item.type)),
      no_critical_ambiguities: !critical.some((item) => item.type === 'ambiguity'),
      main_criteria_testable: (model.acceptance_criteria || []).length > 0,
      essential_rules_defined: (model.business_rules || []).length > 0,
    },
    critical_issues: critical,
    questions,
  };
}

function mergeContext(originalInput, priorAnswers, newAnswers) {
  const all = [...priorAnswers, ...newAnswers];
  const answerLines = all.map((entry) => `Esclarecimento (${entry.question}): ${entry.answer}`).join('\n');
  return answerLines ? `${originalInput}\n\n${answerLines}` : originalInput;
}

export async function createAlignmentSession({ input, result, userId = null }) {
  const sessionUuid = randomUUID();
  const clarification = buildClarificationState(result);
  return prisma.$transaction(async (tx) => {
    const session = await tx.alignmentSession.create({ data: { uuid: sessionUuid, originalInput: input, status: clarification.status, createdByUserId: userId } });
    const version = await tx.alignmentVersion.create({ data: { uuid: randomUUID(), sessionId: session.id, version: 1, inputSnapshot: input, analysisSnapshot: JSON.stringify(result), clarificationSnapshot: JSON.stringify(clarification) } });
    return { sessionUuid, version: version.version, clarification };
  });
}

export async function appendAlignmentVersion({ sessionUuid, answers, analyze, userId = null }) {
  const session = await prisma.alignmentSession.findUnique({ where: { uuid: sessionUuid }, include: { versions: { include: { answers: true }, orderBy: { version: 'asc' } } } });
  if (!session) throw new Error('Sessão de alinhamento não encontrada.');
  const latest = session.versions.at(-1);
  if (!latest) throw new Error('Sessão de alinhamento sem versão inicial.');
  const pending = JSON.parse(latest.clarificationSnapshot).questions || [];
  const normalizedAnswers = (Array.isArray(answers) ? answers : []).map((item) => ({ questionId: clean(item?.question_id || item?.questionId, 120), answer: clean(item?.answer, 2000) })).filter((item) => item.questionId && item.answer);
  if (!normalizedAnswers.length) throw new Error('Informe ao menos uma resposta de esclarecimento.');
  const pendingById = new Map(pending.map((item) => [item.id, item]));
  if (normalizedAnswers.some((item) => !pendingById.has(item.questionId))) throw new Error('Uma resposta não corresponde a uma pergunta pendente.');
  const priorAnswers = session.versions.flatMap((version) => version.answers.map((answer) => ({ question: answer.question, answer: answer.answer })));
  const newAnswers = normalizedAnswers.map((item) => ({ question: pendingById.get(item.questionId).question, answer: item.answer }));
  const mergedInput = mergeContext(session.originalInput, priorAnswers, newAnswers);
  const previousAnalysis = JSON.parse(latest.analysisSnapshot);
  const result = await analyze(mergedInput, previousAnalysis.visual_analysis || null);
  const clarification = buildClarificationState(result);
  const versionNumber = latest.version + 1;
  const saved = await prisma.$transaction(async (tx) => {
    const version = await tx.alignmentVersion.create({ data: { uuid: randomUUID(), sessionId: session.id, version: versionNumber, inputSnapshot: mergedInput, analysisSnapshot: JSON.stringify(result), clarificationSnapshot: JSON.stringify(clarification), createdByUserId: userId } });
    await tx.alignmentClarificationAnswer.createMany({ data: normalizedAnswers.map((item) => ({ uuid: randomUUID(), alignmentVersionId: version.id, questionId: item.questionId, question: pendingById.get(item.questionId).question, answer: item.answer })) });
    await tx.alignmentSession.update({ where: { id: session.id }, data: { status: clarification.status } });
    return version;
  });
  return { result, sessionUuid, version: saved.version, clarification };
}

export async function getAlignmentSession(sessionUuid) {
  const session = await prisma.alignmentSession.findUnique({ where: { uuid: sessionUuid }, include: { versions: { include: { answers: true }, orderBy: { version: 'asc' } } } });
  if (!session) throw new Error('Sessão de alinhamento não encontrada.');
  return { session_uuid: session.uuid, original_input: session.originalInput, status: session.status, versions: session.versions.map((version) => ({ version: version.version, input: version.inputSnapshot, analysis: JSON.parse(version.analysisSnapshot), clarification: JSON.parse(version.clarificationSnapshot), answers: version.answers.map((answer) => ({ question_id: answer.questionId, question: answer.question, answer: answer.answer })) })) };
}
