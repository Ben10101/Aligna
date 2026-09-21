import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate, useParams } from 'react-router-dom';
import { X } from 'lucide-react';
import AppShell from '../components/AppShell';
import { createTaskArtifact, getApiErrorMessage, getTask, repairTaskArtifact, reviewTaskArtifact } from '../services/api';
import { exportTaskArtifactsPdf } from '../utils/taskArtifactsExport';

function diffLines(oldText = '', newText = '') {
  const oldLines = String(oldText).split('\n');
  const newLines = String(newText).split('\n');
  return Array.from({ length: Math.max(oldLines.length, newLines.length) }, (_, index) => ({
    old: oldLines[index] || '', current: newLines[index] || '',
    type: oldLines[index] === newLines[index] ? 'same' : !oldLines[index] ? 'added' : !newLines[index] ? 'removed' : 'changed',
  }));
}

function extractPendingDecisions(content = '') {
  const match = String(content).match(/^##\s+Decisoes pendentes\s*\r?\n([\s\S]*?)(?=^##\s+|(?![\s\S]))/im);
  const planningOnly = /^(definir a prioridade|confirmar dependencias|definir requisitos nao funcionais|definir metricas|avaliar viabilidade|definir quem valida|avaliar o impacto)/i;
  return (match?.[1] || '').split('\n').map((line) => line.replace(/^\s*[-*]\s*/, '').trim()).filter((line) => line && !planningOnly.test(line));
}

function extractQaGaps(content = '') {
  const match = String(content).match(/^##\s+Lacunas de qualidade\s*\r?\n([\s\S]*?)(?=^##\s+|(?![\s\S]))/im);
  return (match?.[1] || '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter((line) => line && !/^nenhuma lacuna/i.test(line));
}

function qaRepairDiagnostics(qaContent = '', requirementContent = '') {
  const cases = [...String(qaContent).matchAll(/^###\s*CT[-\s]*\d+\b/gim)].length;
  const mappedCriteria = new Set([...String(qaContent).matchAll(/^\s*Crit[eé]rio relacionado\s*:\s*(CA[-\s]*\d+)\b/gim)]
    .map((match) => match[1].replace(/\s+/g, '').toUpperCase()));
  const expectedCriteria = [...String(requirementContent).matchAll(/^###\s*Cen[aá]rio\s+\d+\b/gim)].length;
  const trailingContent = String(qaContent).match(/FIM_DOS_CASOS_DE_VALIDACAO\s*([\s\S]+)$/i)?.[1]?.trim();
  const findings = [];
  if (trailingContent) findings.push({ tone: 'rose', title: 'Conteúdo fora do padrão', detail: 'Há conteúdo após o encerramento dos casos de validação.' });
  if (!cases) findings.push({ tone: 'rose', title: 'Casos de validação ausentes', detail: 'O QA não possui CTs estruturados para revisão.' });
  if (expectedCriteria && mappedCriteria.size < expectedCriteria) findings.push({ tone: 'amber', title: 'Cobertura incompleta', detail: `${mappedCriteria.size} de ${expectedCriteria} critérios de aceite possuem caso relacionado.` });
  if (!findings.length) findings.push({ tone: 'blue', title: 'Revisão estrutural completa', detail: 'O agente conferirá cobertura, rastreabilidade e consistência dos casos atuais.' });
  return { cases, mappedCriteria: mappedCriteria.size, expectedCriteria, findings };
}

function ArtifactMarkdown({ content }) {
  return <div className="max-w-none text-sm leading-7 text-slate-700">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: (props) => <h1 className="mb-6 text-2xl font-bold tracking-tight text-slate-950" {...props} />,
        h2: (props) => <h2 className="mb-3 mt-8 border-b border-slate-200 pb-2 text-lg font-bold text-slate-900" {...props} />,
        h3: (props) => <h3 className="mb-2 mt-5 text-base font-bold text-slate-800" {...props} />,
        p: (props) => <p className="my-3" {...props} />,
        ul: (props) => <ul className="my-3 list-disc space-y-1 pl-6 marker:text-slate-400" {...props} />,
        ol: (props) => <ol className="my-3 list-decimal space-y-1 pl-6 marker:font-semibold marker:text-slate-500" {...props} />,
        li: (props) => <li className="pl-1" {...props} />,
        strong: (props) => <strong className="font-semibold text-slate-900" {...props} />,
        blockquote: (props) => <blockquote className="my-4 border-l-4 border-[#102a72] bg-blue-50 px-4 py-2" {...props} />,
        code: ({ inline, ...props }) => inline ? <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800" {...props} /> : <code className="font-mono text-xs text-slate-100" {...props} />,
        pre: (props) => <pre className="my-4 overflow-x-auto rounded-xl bg-slate-900 p-4" {...props} />,
        table: (props) => <div className="my-4 overflow-x-auto"><table className="w-full border-collapse text-left" {...props} /></div>,
        th: (props) => <th className="border border-slate-200 bg-slate-100 px-3 py-2 font-semibold text-slate-800" {...props} />,
        td: (props) => <td className="border border-slate-200 px-3 py-2 align-top" {...props} />,
      }}
    >{content || '*Nenhum conteúdo disponível neste artefato.*'}</ReactMarkdown>
  </div>;
}

export default function TaskArtifactReviewPage({ stage = 'requirements' }) {
  const { taskUuid } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [comment, setComment] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairModal, setRepairModal] = useState(false);
  const [decisionResponses, setDecisionResponses] = useState({});
  const [qaInstruction, setQaInstruction] = useState('');
  const [editing, setEditing] = useState(false);
  const [compare, setCompare] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { getTask(taskUuid).then(setTask).catch((requestError) => setError(getApiErrorMessage(requestError, 'Não foi possível carregar os artefatos.'))); }, [taskUuid]);
  const isQaStage = stage === 'qa';
  const requirementsApproved = useMemo(() => (task?.artifacts || []).some((item) => item.isCurrent && item.artifactType === 'requirements' && item.isApproved), [task]);
  const artifact = useMemo(() => (task?.artifacts || []).find((item) => item.isCurrent && (isQaStage ? ['qa_validation_cases', 'test_plan'].includes(item.artifactType) : item.artifactType === 'requirements')), [task, isQaStage]);
  const versions = useMemo(() => (task?.artifacts || []).filter((item) => isQaStage ? ['qa_validation_cases', 'test_plan'].includes(item.artifactType) : item.artifactType === 'requirements').sort((a, b) => Number(b.version || 0) - Number(a.version || 0)), [task, isQaStage]);
  const pendingDecisions = useMemo(() => extractPendingDecisions(artifact?.content), [artifact?.content]);
  const qaGaps = useMemo(() => extractQaGaps(artifact?.content), [artifact?.content]);
  const repairQuestions = isQaStage ? qaGaps : pendingDecisions;
  const isRequirementsArtifact = artifact?.artifactType === 'requirements';
  const repairLabel = isQaStage ? 'Corrigir QA com agente' : 'Corrigir requisitos com agente';
  const repairTargetLabel = isQaStage ? 'os casos de validação de QA' : 'os requisitos refinados';
  const relatedRequirementContent = useMemo(() => (task?.artifacts || []).find((item) => item.isCurrent && item.artifactType === 'requirements')?.content || '', [task]);
  const qaDiagnostics = useMemo(() => qaRepairDiagnostics(artifact?.content, relatedRequirementContent), [artifact?.content, relatedRequirementContent]);
  useEffect(() => { setContent(artifact?.content || ''); setEditing(false); setCompare(null); }, [artifact?.uuid]);

  async function review(approved) {
    if (!artifact) return;
    if (!approved && !comment.trim()) { setError('Informe um comentário ao rejeitar o artefato.'); return; }
    setSaving(true);
    try { await reviewTaskArtifact(taskUuid, artifact.uuid, { approved, comment }); setTask(await getTask(taskUuid)); setComment(''); }
    catch (requestError) {
      try { setTask(await getTask(taskUuid)); } catch { /* preserve the original request error */ }
      setError(getApiErrorMessage(requestError, 'Não foi possível registrar a revisão.'));
    }
    finally { setSaving(false); }
  }
  async function repair() {
    if (!artifact) return;
    if (!repairModal) { setRepairModal(true); return; }
    setRepairing(true);
    setNotice(null);
    const decisionsInstruction = repairQuestions.map((question, index) => {
      const response = decisionResponses[index] || {};
      return response.ignored ? `Pendencia mantida: ${question}` : response.answer?.trim() ? `Decisao: ${question}\nResposta: ${response.answer.trim()}` : null;
    }).filter(Boolean).join('\n\n');
    const decisionResponsesPayload = repairQuestions.map((question, index) => ({ question, answer: decisionResponses[index]?.answer?.trim() || null, ignored: Boolean(decisionResponses[index]?.ignored) })).filter((item) => item.answer || item.ignored);
    try {
      const repairResult = await repairTaskArtifact(taskUuid, artifact.uuid, { instruction: [comment.trim(), isQaStage ? qaInstruction.trim() : '', decisionsInstruction].filter(Boolean).join('\n\n'), decisionResponses: decisionResponsesPayload });
      setTask(await getTask(taskUuid));
      if (repairResult?.noArtifactChange) setNotice(repairResult.message || 'A decisão foi registrada para a próxima revisão do requisito.');
      setComment(''); setDecisionResponses({}); setQaInstruction('');
    }
    catch (requestError) {
      try { setTask(await getTask(taskUuid)); } catch { /* preserve the original request error */ }
      setError(getApiErrorMessage(requestError, 'Não foi possível executar o reparo direcionado.'));
    }
    finally { setRepairing(false); setRepairModal(false); }
  }
  async function saveManualVersion() {
    if (!artifact || !content.trim()) return;
    setSaving(true);
    try { await createTaskArtifact(taskUuid, { artifactType: artifact.artifactType, title: artifact.title, content, contentFormat: artifact.contentFormat || 'markdown' }); setTask(await getTask(taskUuid)); setEditing(false); }
    catch (requestError) { setError(getApiErrorMessage(requestError, 'Não foi possível salvar a nova versão.')); }
    finally { setSaving(false); }
  }

  function exportTaskArtifacts() {
    if (!task) return;
    setExporting(true);
    setError(null);
    try {
      exportTaskArtifactsPdf(task);
    } catch (exportError) {
      setError(getApiErrorMessage(exportError, 'Não foi possível exportar os artefatos desta task.'));
    } finally {
      setExporting(false);
    }
  }

  const stageLabel = isQaStage ? 'Revisão de QA' : 'Revisão de requisitos';
  const stageDescription = isQaStage
    ? 'Revise somente os casos de validação produzidos pelo QA. Esta etapa depende de requisitos aprovados.'
    : 'Revise somente o refinamento produzido pelo Requirements Analyst antes de liberar a task para QA.';

  return <AppShell eyebrow={stageLabel} title={task?.title || stageLabel} description={stageDescription} actions={<div className="flex flex-wrap gap-2"><button type="button" className="dashboard-button-secondary" disabled={!task || exporting} onClick={exportTaskArtifacts}>{exporting ? 'Preparando exportação...' : 'Exportar task em PDF'}</button><button className="dashboard-button-secondary" onClick={() => navigate(`/projects/${task?.project?.uuid || ''}`)}>Voltar ao projeto</button></div>}>
    <section className="dashboard-panel w-full">
      <div className="p-4">
        {notice && <div className="mb-4 flex items-start justify-between gap-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-[#102a72]" role="status"><p>{notice}</p><button type="button" onClick={() => setNotice(null)} className="shrink-0 font-semibold">Fechar</button></div>}
        {!task && <div className="rounded-xl bg-slate-50 p-6 text-sm text-slate-500">Carregando artefatos...</div>}
        {task && isQaStage && !requirementsApproved && <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm leading-6 text-amber-900">A revisão de QA permanece bloqueada até que a versão atual dos requisitos seja aprovada. Conclua primeiro a revisão do Requirements Analyst.</div>}
        {task && (!isQaStage || requirementsApproved) && !artifact && <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">Ainda não existe um artefato de {isQaStage ? 'QA' : 'requisitos'} para esta task.</div>}
        {artifact && (!isQaStage || requirementsApproved) && <article className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">{artifact.artifactType} · versão {artifact.version} · ID {artifact.uuid}</p><h2 className="mt-2 text-xl font-bold text-slate-900">{artifact.title}</h2></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${artifact.isApproved ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{artifact.isApproved ? 'Aprovado' : 'Pendente de aprovação'}</span></div>
          {editing ? <textarea value={content} onChange={(event) => setContent(event.target.value)} className="dashboard-input mt-5 min-h-[420px] font-mono text-sm leading-6" /> : <div className="mt-5 max-h-[70vh] overflow-auto rounded-xl bg-slate-50 p-5"><ArtifactMarkdown content={artifact.content} /></div>}
          <div className="mt-5 border-t border-slate-200 pt-4"><textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} className="dashboard-input" placeholder="Comentário (obrigatório ao rejeitar)" /><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={saving || repairing || artifact.isApproved} onClick={() => setEditing((value) => !value)} className="dashboard-button-secondary">{editing ? 'Cancelar edição' : 'Editar manualmente'}</button>{editing && <button type="button" disabled={saving || !content.trim()} onClick={saveManualVersion} className="dashboard-button-primary">{saving ? 'Salvando...' : 'Salvar nova versão'}</button>}<button type="button" disabled={saving || repairing || artifact.isApproved} onClick={repair} className="dashboard-button-secondary">{repairing ? 'Corrigindo...' : repairLabel}</button><button type="button" disabled={saving || artifact.isApproved} onClick={() => review(false)} className="dashboard-button-secondary">Rejeitar</button><button type="button" disabled={saving || artifact.isApproved} onClick={() => review(true)} className="dashboard-button-primary">{saving ? 'Salvando...' : 'Aprovar artefato'}</button></div></div>
        </article>}
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-bold text-slate-900">Histórico de versões</h2><span className="text-xs text-slate-500">{versions.length} versão(ões)</span></div><div className="mt-3 space-y-2">{versions.map((version) => <div key={version.uuid} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs"><span>v{version.version} · {version.isCurrent ? 'Atual' : 'Anterior'} · {version.isApproved ? 'Aprovada' : 'Pendente'}</span><button type="button" className="font-semibold text-[#102a72]" onClick={() => setCompare(compare?.uuid === version.uuid ? null : version)}>Comparar</button></div>)}</div>{compare && artifact && <pre className="mt-4 max-h-72 overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-200">{diffLines(compare.content, artifact.content).map((line) => `${line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : line.type === 'changed' ? '~ ' : '  '}${line.type === 'removed' ? line.old : line.type === 'added' ? line.current : line.type === 'changed' ? `${line.old} → ${line.current}` : line.current}`).join('\n')}</pre>}</section>
      </div>
    </section>
    {repairModal && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-0 backdrop-blur-[2px] sm:p-5" role="dialog" aria-modal="true" aria-labelledby="repair-title" aria-busy={repairing}>
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(82vh,820px)] sm:max-w-4xl sm:rounded-3xl">
        <div className="shrink-0 border-b border-white/10 bg-gradient-to-r from-slate-950 to-[#102a72] px-5 py-5 text-white sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200">{isQaStage ? 'Correção de QA' : 'Correção de requisitos'}</p>
              <h2 id="repair-title" className="mt-2 text-xl font-bold tracking-tight">{repairLabel}</h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden shrink-0 rounded-full bg-blue-400/15 px-3 py-1 text-xs font-semibold text-blue-100 sm:inline">Nova versão pendente</span>
              <button type="button" onClick={() => setRepairModal(false)} disabled={repairing} className="rounded-xl border border-white/20 p-2 text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Fechar correção"><X size={20} /></button>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">{isRequirementsArtifact ? 'O agente preserva o que está correto, aplica as decisões registradas e propõe uma nova versão para sua revisão.' : 'Responda às lacunas que já possuem decisão. O agente só as fechará quando a resposta puder ser rastreada a um critério aprovado.'}</p>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50 px-5 py-5 sm:px-7">
          {isQaStage ? <div className="mx-auto max-w-3xl space-y-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#102a72]">Diagnóstico de QA</p><h3 className="mt-2 text-lg font-bold text-slate-900">O que será revisado</h3><p className="mt-2 text-sm leading-6 text-slate-600">O revisor reconstruirá os casos a partir do requisito aprovado e preservará somente a cobertura válida.</p></div>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-[#102a72]">{qaDiagnostics.cases} CTs · {qaDiagnostics.mappedCriteria}{qaDiagnostics.expectedCriteria ? `/${qaDiagnostics.expectedCriteria}` : ''} CAs</span>
              </div>
              <div className="mt-5 space-y-3">{qaDiagnostics.findings.map((finding) => <article key={finding.title} className={`rounded-xl border p-4 ${finding.tone === 'rose' ? 'border-rose-200 bg-rose-50' : finding.tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-blue-100 bg-blue-50'}`}><p className={`text-sm font-bold ${finding.tone === 'rose' ? 'text-rose-900' : finding.tone === 'amber' ? 'text-amber-900' : 'text-[#102a72]'}`}>{finding.title}</p><p className="mt-1 text-sm leading-6 text-slate-700">{finding.detail}</p></article>)}</div>
            </section>
            {qaGaps.length > 0 && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#102a72]">Lacunas a resolver</p>
                  <h3 className="mt-2 text-lg font-bold text-slate-900">Confirme somente decisões já tomadas</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">A resposta é aplicada à nova versão de QA apenas quando detalhar um critério de aceite existente. Se criar uma regra nova, a lacuna permanece para revisão do requisito.</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{qaGaps.length} {qaGaps.length === 1 ? 'lacuna' : 'lacunas'}</span>
              </div>
              <div className="mt-6 space-y-4">{qaGaps.map((gap, index) => <article key={gap} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-xs font-bold text-[#102a72] shadow-sm">{index + 1}</span><p className="pt-0.5 text-sm font-semibold leading-6 text-slate-900">{gap}</p></div>
                <textarea value={decisionResponses[index]?.answer || ''} disabled={decisionResponses[index]?.ignored} onChange={(event) => setDecisionResponses((current) => ({ ...current, [index]: { ...current[index], answer: event.target.value } }))} rows={3} className="dashboard-input mt-4 text-sm" placeholder="Registre a decisão confirmada que resolve esta lacuna" />
                <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={Boolean(decisionResponses[index]?.ignored)} onChange={(event) => setDecisionResponses((current) => ({ ...current, [index]: { ...current[index], ignored: event.target.checked } }))} />Manter como lacuna</label>
              </article>)}</div>
            </section>}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <label htmlFor="qa-repair-instruction" className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#102a72]">Orientação adicional <span className="normal-case tracking-normal text-slate-400">(opcional)</span></label>
              <p className="mt-2 text-sm leading-6 text-slate-600">Indique uma prioridade de revisão. O agente não criará regras ou testes fora do requisito aprovado.</p>
              <textarea id="qa-repair-instruction" value={qaInstruction} onChange={(event) => setQaInstruction(event.target.value)} rows={3} className="dashboard-input mt-4 text-sm" placeholder="Ex.: priorize a cobertura dos cenários de recusa e a rastreabilidade CA → CT." />
            </section>
          </div> : pendingDecisions.length > 0 ? <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#102a72]">Decisões pendentes</p>
                <h3 className="mt-2 text-lg font-bold text-slate-900">Confirme somente o que já foi decidido</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">As respostas serão usadas para gerar a nova versão. Se uma decisão ainda não existe, mantenha-a pendente.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{pendingDecisions.length} {pendingDecisions.length === 1 ? 'decisão' : 'decisões'}</span>
            </div>
            <div className="mt-6 space-y-4">{pendingDecisions.map((question, index) => <article key={question} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-xs font-bold text-[#102a72] shadow-sm">{index + 1}</span>
                <p className="pt-0.5 text-sm font-semibold leading-6 text-slate-900">{question}</p>
              </div>
              <textarea value={decisionResponses[index]?.answer || ''} disabled={decisionResponses[index]?.ignored} onChange={(event) => setDecisionResponses((current) => ({ ...current, [index]: { ...current[index], answer: event.target.value } }))} rows={3} className="dashboard-input mt-4 text-sm" placeholder="Registre a decisão confirmada" />
              <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={Boolean(decisionResponses[index]?.ignored)} onChange={(event) => setDecisionResponses((current) => ({ ...current, [index]: { ...current[index], ignored: event.target.checked } }))} />Manter como pendência</label>
            </article>)}</div>
          </section> : <section className="mx-auto flex min-h-[220px] max-w-3xl flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm font-bold text-slate-900">Nenhuma decisão pendente</p>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">O agente preservará o conteúdo atual e aplicará somente os achados de qualidade já identificados.</p>
          </section>}
        </div>

        <div className="shrink-0 flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <p className="text-xs leading-5 text-slate-500">A nova versão será criada para sua revisão; nada é aprovado automaticamente.</p>
          <div className="flex gap-2"><button type="button" disabled={repairing} onClick={() => setRepairModal(false)} className="dashboard-button-secondary">Cancelar</button><button type="button" disabled={repairing} onClick={repair} className="dashboard-button-primary">{repairing ? 'Corrigindo...' : 'Iniciar correção'}</button></div>
        </div>
        {repairing && <div className="absolute inset-0 z-10 flex min-h-full items-center justify-center bg-white/90 p-6 backdrop-blur-[1px] sm:rounded-3xl" role="status" aria-live="polite">
          <div className="max-w-sm text-center">
            <span className="mx-auto block h-10 w-10 animate-spin rounded-full border-4 border-blue-100 border-t-[#102a72]" aria-hidden="true" />
            <p className="mt-4 text-base font-bold text-slate-900">O agente está corrigindo {repairTargetLabel}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">Estamos aplicando as regras e preparando uma nova versão para sua revisão.</p>
          </div>
        </div>}
      </div>
    </div>}
    {error && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="quality-error-title"><div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-lg text-rose-700">!</div><div><p className="text-[10px] font-bold uppercase tracking-[0.22em] text-rose-700">Ação não concluída</p><h2 id="quality-error-title" className="mt-1 text-lg font-bold text-slate-950">Não foi possível concluir a operação</h2></div></div><div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-900">{error}</div><p className="mt-4 text-sm text-slate-600">Se houver uma versão mais recente, ela já estará carregada nesta tela.</p><div className="mt-6 flex justify-end"><button type="button" onClick={() => setError(null)} className="dashboard-button-primary">Entendi</button></div></div></div>}
  </AppShell>;
}
