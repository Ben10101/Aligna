import { runSingleAgent } from './orchestratorService.js';
import { validateSemanticFindings } from './alignmentValidationService.js';
import { MAX_REQUIREMENT_LENGTH, validateRequirementModel } from './requirementSchemaService.js';
import {
  challengeRequirementDeterministically,
  validateChallengerCandidates,
  validateChallengeReport,
} from './requirementChallengerService.js';
import { judgeRequirementDeterministically, validateJudgeReport } from './requirementJudgeService.js';
import { logInfo, logWarn } from '../utils/logger.js';

function isEnabled(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

export function isRequirementEngineLlmEnabled() {
  return isEnabled(process.env.ALIGNMENT_REQUIREMENT_ENGINE_LLM_ENABLED);
}

function item(id, statement, evidence, status = 'confirmed') {
  return { id, statement, evidence: evidence || null, status };
}

function finding(id, category, message, recommendation, evidence = null) {
  return { id, category, message, recommendation, evidence: evidence || null };
}

function statementFinding(itemFinding, index) {
  return finding(
    itemFinding.id || `deterministic:${itemFinding.category || itemFinding.type}:${index + 1}`,
    itemFinding.category || (itemFinding.type === 'vague_term' ? 'ambiguity' : 'missing_information'),
    itemFinding.message,
    itemFinding.recommendation,
    itemFinding.evidence || null
  );
}

function detectContradictions(input) {
  const normalized = String(input || '').replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
  const candidates = [
    ['permitir', 'permitir'], ['exigir', 'exigir'], ['aprovar', 'aprovar'], ['enviar', 'enviar'], ['registrar', 'registrar'],
  ];
  return candidates.filter(([positive, negative]) =>
    new RegExp(`\\bdeve\\s+${positive}\\b`).test(normalized) && new RegExp(`\\b(?:n[aã]o\\s+pode|n[aã]o\\s+deve)\\s+${negative}\\b`).test(normalized)
  );
}

function buildClarificationQuestions(missingInformation) {
  const prompts = {
    actor: 'Qual ator inicia ou consome este fluxo?',
    outcome: 'Qual resultado de negócio deve ser alcançado?',
    business_rules: 'Quais regras, limites ou permissões precisam ser confirmados?',
    exception_flow: 'Como o sistema deve se comportar em caso de erro ou exceção?',
    context: 'Qual contexto adicional delimita este requisito?',
    object: 'Qual objeto de negócio é manipulado neste requisito?',
    main_flow: 'Quais passos formam o fluxo principal esperado?',
  };
  return missingInformation
    .filter((entry) => prompts[entry.id.split(':').pop()] || prompts[entry.code] || prompts[entry.type])
    .map((entry, index) => {
      const relatesTo = entry.id.split(':').pop() || entry.code || entry.type;
      return { id: `CQ-${String(index + 1).padStart(2, '0')}`, question: prompts[relatesTo], relates_to: relatesTo };
    });
}

function addMissing(missingInformation, code, message, recommendation) {
  missingInformation.push(finding(`missing_information:${code}`, 'missing_information', message, recommendation));
}

function buildDeterministicRequirement(input, deterministic, existingFindings = []) {
  const truncated = input.length > MAX_REQUIREMENT_LENGTH;
  const requirement = truncated ? input.slice(0, MAX_REQUIREMENT_LENGTH) : input;
  const missingInformation = (deterministic.missing_information || []).map(statementFinding);
  const ambiguities = (existingFindings || []).filter((entry) => entry.category === 'ambiguity' || entry.type === 'vague_term').map(statementFinding);
  const contradictions = detectContradictions(requirement).map(([verb], index) =>
    finding(`contradiction:${index + 1}`, 'contradiction', `O requisito contém comandos potencialmente conflitantes sobre "${verb}".`, 'Esclareça qual comportamento deve prevalecer.', verb)
  );
  if (truncated) addMissing(missingInformation, 'input_truncated', 'A entrada excede o limite estruturado do requisito.', 'Divida ou resuma o requisito antes de aprová-lo.');
  if (!deterministic.extracted?.object) addMissing(missingInformation, 'object', 'O objeto de negócio principal não foi explicitamente identificado.', 'Informe qual objeto é criado, consultado, alterado ou removido.');
  if (!deterministic.extracted?.action) addMissing(missingInformation, 'main_flow', 'O fluxo principal não pôde ser estruturado sem uma ação explícita.', 'Descreva os passos observáveis do fluxo principal.');

  const action = deterministic.extracted?.action || null;
  const actor = deterministic.extracted?.actor || null;
  const goal = deterministic.extracted?.outcome || null;
  const functionalRequirements = action ? [item('FR-01', action, action)] : [];
  const businessRules = (deterministic.business_rules || []).map((rule, index) => item(`BR-${String(index + 1).padStart(2, '0')}`, rule, rule));
  const acceptanceCriteria = actor && action && goal
    ? [{ id: 'AC-01', given: `${actor} está no contexto descrito`, when: action, then: goal, status: 'confirmed', evidence: action }]
    : [];
  const model = {
    requirement,
    user_story: actor && action && goal ? deterministic.user_story : null,
    actor,
    goal,
    action,
    object: null,
    context: deterministic.input_summary || requirement,
    functional_requirements: functionalRequirements,
    business_rules: businessRules,
    main_flow: [],
    alternative_flows: [],
    exception_flows: [],
    acceptance_criteria: acceptanceCriteria,
    ambiguities,
    missing_information: missingInformation,
    assumptions: [],
    contradictions,
    dependencies: [],
    scope: { in_scope: action ? [item('SC-01', action, action)] : [], out_of_scope: [], not_defined: [] },
    clarification_questions: buildClarificationQuestions(missingInformation),
    risks: [...ambiguities, ...contradictions].map((entry, index) => item(`RK-${String(index + 1).padStart(2, '0')}`, entry.message, entry.evidence, entry.category)),
  };
  return validateRequirementModel(model);
}

async function runStage(stage, input, requirementModel, options) {
  const result = await runSingleAgent('requirement_engine', {
    idea: input,
    stage,
    requirement_model: requirementModel,
    visual_requirement_model: options.visualRequirementModel || null,
  }, { envOverrides: options.envOverrides || {} });
  return Array.isArray(result?.findings) ? result.findings : [];
}

async function runChallengerStage(input, requirementModel, options) {
  const result = await runSingleAgent('requirement_challenger', {
    idea: input,
    requirement_model: requirementModel,
    context: options.context || '',
  }, { envOverrides: options.envOverrides || {} });
  return {
    problems: Array.isArray(result?.problems) ? result.problems : [],
    modelExecution: result?.model_execution || null,
  };
}

async function runJudgeStage(input, requirementModel, challengeReport, options) {
  if (typeof options.judgeRunner === 'function') {
    return options.judgeRunner({ idea: input, requirement_model: requirementModel, challenge_report: challengeReport });
  }
  return runSingleAgent('requirement_judge', {
    idea: input,
    requirement_model: requirementModel,
    challenge_report: challengeReport,
  }, { envOverrides: options.envOverrides || {} });
}

async function runAnalyzerRevision(input, requirementModel, feedback, options) {
  if (typeof options.analyzerRunner === 'function') {
    return options.analyzerRunner({ idea: input, requirement_model: requirementModel, feedback_for_analyzer: feedback });
  }
  return runSingleAgent('requirement_engine', {
    idea: input,
    stage: 'requirements_analysis',
    requirement_model: requirementModel,
    feedback_for_analyzer: feedback,
  }, { envOverrides: options.envOverrides || {} });
}

function mergeValidatedFindings(model, findings) {
  for (const entry of findings) {
    const target = entry.category === 'missing_information' ? model.missing_information
      : entry.category === 'ambiguity' ? model.ambiguities
        : entry.category === 'assumption' ? model.assumptions : model.contradictions;
    target.push(finding(entry.id, entry.category, entry.message, entry.recommendation, entry.evidence));
  }
  model.clarification_questions = buildClarificationQuestions(model.missing_information);
  return validateRequirementModel(model);
}

function mergeChallengeProblems(model, problems) {
  const categoryByType = {
    AMBIGUITY: 'ambiguity',
    MISSING_INFORMATION: 'missing_information',
    CONTRADICTION: 'contradiction',
    ASSUMPTION: 'assumption',
  };
  for (const challenge of problems) {
    const category = categoryByType[challenge.type];
    if (!category) continue;
    const target = category === 'missing_information' ? model.missing_information
      : category === 'ambiguity' ? model.ambiguities
        : category === 'assumption' ? model.assumptions : model.contradictions;
    if (target.some((entry) => entry.message === challenge.explanation && entry.evidence === challenge.evidence)) continue;
    target.push(finding(`challenge:${challenge.id}`, category, challenge.explanation, challenge.clarification_question || challenge.impact, challenge.evidence));
  }
  model.clarification_questions = buildClarificationQuestions(model.missing_information);
  return validateRequirementModel(model);
}

function maxJudgeRetries(options) {
  const value = Number(options.maxJudgeRetries ?? process.env.REQUIREMENT_JUDGE_MAX_RETRIES ?? 2);
  return Number.isFinite(value) ? Math.max(0, Math.min(Math.floor(value), 5)) : 2;
}

export async function runRequirementJudgeWorkflow({ input, requirementModel, challengeReport, options = {} }) {
  const retries = maxJudgeRetries(options);
  const canRunAgents = options.llmEnabled === true || typeof options.judgeRunner === 'function';
  let model = requirementModel;
  let lastReport = null;
  let lastError = null;
  let attempts = 0;

  while (attempts <= retries) {
    const deterministic = judgeRequirementDeterministically({ requirement: input, requirementModel: model, challengeReport });
    let report = deterministic;
    let mode = 'deterministic';
    if (canRunAgents) {
      try {
        const result = await runJudgeStage(input, model, challengeReport, options);
        const candidate = validateJudgeReport(result?.judge_candidate ?? result, input);
        // The model may raise a stricter decision, but cannot suppress deterministic evidence.
        report = {
          ...deterministic,
          decision: candidate.decision === 'BLOCK' ? 'BLOCK' : deterministic.decision,
          findings: [...deterministic.findings, ...candidate.findings],
          challenger_false_positives: [...deterministic.challenger_false_positives, ...candidate.challenger_false_positives],
          feedback_for_analyzer: [...new Set([...deterministic.feedback_for_analyzer, ...candidate.feedback_for_analyzer])],
        };
        if (report.decision === 'PASS' && candidate.decision === 'REVISE') report.decision = 'REVISE';
        mode = 'deterministic_plus_llm';
      } catch (error) {
        lastError = error;
        mode = 'deterministic_fallback';
      }
    }
    lastReport = report;
    if (report.decision !== 'REVISE') {
      return { requirementModel: model, judgeReport: report, stage: { stage: 'requirements_judge', status: lastError ? 'degraded' : 'completed', mode, decision: report.decision, retries: attempts, ...(lastError ? { reason: lastError.code || 'judge_stage_failed' } : {}) } };
    }
    if (attempts >= retries || !(options.llmEnabled === true || typeof options.analyzerRunner === 'function')) break;
    try {
      const analyzerResult = await runAnalyzerRevision(input, model, report.feedback_for_analyzer, options);
      const validated = validateSemanticFindings(analyzerResult?.findings, input);
      model = mergeValidatedFindings(model, validated.accepted);
    } catch (error) {
      lastError = error;
      break;
    }
    attempts += 1;
  }
  return { requirementModel: model, judgeReport: lastReport, stage: { stage: 'requirements_judge', status: 'completed', mode: lastError ? 'deterministic_fallback' : 'deterministic_plus_llm', decision: 'REVISE', retries: attempts, reason: lastError ? (lastError.code || 'revision_failed') : 'retry_exhausted' } };
}

export async function buildRequirementEngine(input, deterministic, existingFindings = [], options = {}) {
  let requirementModel = buildDeterministicRequirement(input, deterministic, existingFindings);
  const stages = [
    { name: 'requirements_analyst', task: 'requirements_analysis' },
    { name: 'requirements_challenger', task: 'requirements_challenge' },
  ];
  const stageResults = [];
  const llmEnabled = options.llmEnabled === true;
  let challengeReport = challengeRequirementDeterministically({ requirement: input, requirementModel, context: options.context || '' });

  for (const stage of stages) {
    if (stage.name === 'requirements_challenger') {
      challengeReport = challengeRequirementDeterministically({ requirement: input, requirementModel, context: options.context || '' });
      if (!llmEnabled) {
        requirementModel = mergeChallengeProblems(requirementModel, challengeReport.problems);
        stageResults.push({ stage: stage.name, status: 'completed', mode: 'deterministic', problems_count: challengeReport.problems.length, retry: 0 });
        continue;
      }
      try {
        const challengerResult = await runChallengerStage(input, requirementModel, options);
        const validated = validateChallengerCandidates(challengerResult.problems, input);
        challengeReport = validateChallengeReport({
          version: '1.0',
          problems: [...challengeReport.problems, ...validated.accepted],
        });
        requirementModel = mergeChallengeProblems(requirementModel, challengeReport.problems);
        stageResults.push({
          stage: stage.name,
          status: 'completed',
          mode: 'deterministic_plus_llm',
          problems_count: challengeReport.problems.length,
          accepted_problems: validated.accepted.length,
          rejected_problems: validated.rejected.length,
          model_execution: challengerResult.modelExecution,
          retry: challengerResult.modelExecution?.retry ?? 0,
        });
      } catch (error) {
        requirementModel = mergeChallengeProblems(requirementModel, challengeReport.problems);
        logWarn('requirement_challenger.stage_failed', { error });
        stageResults.push({ stage: stage.name, status: 'degraded', mode: 'deterministic', problems_count: challengeReport.problems.length, reason: 'llm_stage_failed', retry: 0 });
      }
      continue;
    }
    if (!llmEnabled) {
      stageResults.push({ stage: stage.name, status: 'skipped', reason: 'disabled_by_configuration', accepted_findings: 0 });
      continue;
    }
    try {
      const candidates = await runStage(stage.task, input, requirementModel, options);
      const validated = validateSemanticFindings(candidates, input);
      requirementModel = mergeValidatedFindings(requirementModel, validated.accepted);
      stageResults.push({ stage: stage.name, status: 'completed', accepted_findings: validated.accepted.length, rejected_findings: validated.rejected.length });
    } catch (error) {
      logWarn('requirement_engine.stage_failed', { stage: stage.name, error });
      stageResults.push({ stage: stage.name, status: 'unavailable', reason: 'stage_failed', accepted_findings: 0 });
    }
  }

  const judged = await runRequirementJudgeWorkflow({
    input,
    requirementModel,
    challengeReport,
    options: { ...options, llmEnabled },
  });
  requirementModel = judged.requirementModel;
  stageResults.push(judged.stage);

  const report = {
    status: 'completed',
    version: '1.0',
    stages: [
      { stage: 'deterministic_analysis', status: 'completed' },
      ...stageResults,
      { stage: 'structured_requirement', status: 'completed' },
      { stage: 'deterministic_score', status: 'completed', source: 'alignment.clarity_score' },
      { stage: 'alignment_report', status: 'completed' },
    ],
  };
  logInfo('requirement_engine.completed', { stages: stageResults.map((stage) => `${stage.stage}:${stage.status}`), requirementLength: requirementModel.requirement.length });
  return { requirementModel, report, challengeReport, judgeReport: judged.judgeReport };
}

export { buildDeterministicRequirement };
