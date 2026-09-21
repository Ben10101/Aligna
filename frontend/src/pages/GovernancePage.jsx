import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Clock3,
  DollarSign,
  RefreshCw,
  ShieldCheck,
  Siren,
  Workflow,
} from 'lucide-react';
import AppShell from '../components/AppShell';
import {
  getActiveAlerts,
  getAiOperationsOverview,
  getApiErrorMessage,
  getAuditTrail,
  getGovernanceOverview,
  getOperationalHealth,
  getOperationalHistory,
  getPipelineQualityOverview,
  getProductionReadiness,
  listProjects,
} from '../services/api';

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, delay, ease: 'easeOut' },
});

function formatCompactNumber(value) {
  return new Intl.NumberFormat('pt-BR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(value || 0));
}

function MetricCard({ label, value, hint, icon: Icon, tone = 'slate' }) {
  const tones = {
    blue: 'bg-blue-50 text-[#102a72] border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${tones[tone]}`}>
          <Icon className="h-5 w-5" strokeWidth={2} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">{label}</span>
      </div>
      <p className="mt-4 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
      {hint ?<p className="mt-2 text-sm leading-6 text-slate-500">{hint}</p> : null}
    </div>
  );
}

function EventCard({ title, subtitle, tone = 'slate' }) {
  const toneClass =
    tone === 'rose'
      ?'border-rose-200 bg-rose-50 text-rose-800'
      : tone === 'amber'
        ?'border-amber-200 bg-amber-50 text-amber-800'
        : tone === 'emerald'
          ?'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-slate-200 bg-slate-50 text-slate-800';

  return (
    <div className={`rounded-2xl border px-4 py-4 ${toneClass}`}>
      <p className="text-sm font-semibold">{title}</p>
      {subtitle ?<p className="mt-1 text-xs opacity-90">{subtitle}</p> : null}
    </div>
  );
}

function InsightCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      {hint ?<p className="mt-2 text-sm leading-6 text-slate-500">{hint}</p> : null}
    </div>
  );
}

function formatExecutorLabel(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return 'n/a';

  const labels = {
    sub_agent_pipeline: 'sub-agent pipeline',
  };

  return labels[normalized] || normalized;
}

function EmptyPanel({ title, subtitle }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {subtitle ?<p className="mt-1 text-sm leading-6 text-slate-500">{subtitle}</p> : null}
    </div>
  );
}

export default function GovernancePage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [health, setHealth] = useState(null);
  const [operations, setOperations] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [history, setHistory] = useState(null);
  const [governance, setGovernance] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [auditTrail, setAuditTrail] = useState([]);
  const [pipelineQuality, setPipelineQuality] = useState(null);
  const [projects, setProjects] = useState([]);
  const [selectedProjectUuid, setSelectedProjectUuid] = useState('');

  function handleExportAuditCsv() {
    if (!auditTrail || !auditTrail.length) return;
    const headers = ['Timestamp', 'Método', 'Caminho', 'Ação', 'Usuário', 'Duração (ms)', 'Status'];
    const rows = auditTrail.map((entry) => [
      new Date(entry.timestamp || Date.now()).toLocaleString('pt-BR'),
      entry.method || 'GET',
      `"${(entry.path || '').replace(/"/g, '""')}"`,
      `"${(entry.actionType || '').replace(/"/g, '""')}"`,
      `"${(entry.userEmail || 'Desconhecido').replace(/"/g, '""')}"`,
      entry.durationMs || 0,
      entry.success ? 'Sucesso' : 'Falha',
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `trilha-auditoria-governanca-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function refreshGovernanceDashboard({ silent = false } = {}) {
    try {
      if (!silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError('');

      const [healthData, operationsData, readinessData, historyData, governanceData, alertsData, auditData, pipelineQualityData] =
        await Promise.all([
          getOperationalHealth(),
          getAiOperationsOverview(),
          getProductionReadiness(),
          getOperationalHistory({ days: 7 }),
          getGovernanceOverview(),
          getActiveAlerts(),
          getAuditTrail({ limit: 12 }),
          getPipelineQualityOverview(),
        ]);

      setHealth(healthData);
      setOperations(operationsData);
      setReadiness(readinessData);
      setHistory(historyData);
      setGovernance(governanceData);
      setAlerts(Array.isArray(alertsData) ?alertsData : []);
      setAuditTrail(Array.isArray(auditData) ?auditData : []);
      setPipelineQuality(pipelineQualityData);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, silent ?'Não foi possível atualizar os dados de governança.' : 'Não foi possível carregar a governança operacional.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function load({ silent = false } = {}) {
      await refreshGovernanceDashboard({ silent });
      if (!active) return;
    }

    load();

    return () => {
      active = false;
    };
  }, []);

  const historyTail = useMemo(() => (history?.series || []).slice(-5), [history]);
  const readinessFailures = useMemo(
    () => (readiness?.checks || []).filter((check) => check.status === 'failed'),
    [readiness]
  );
  const readinessWarnings = useMemo(
    () => (readiness?.checks || []).filter((check) => check.status === 'warning'),
    [readiness]
  );
  const readinessRunbook = readiness?.runbook || [];
  const releaseReadiness = readiness?.releaseReadiness || null;
  const topFailingAgents = operations?.reliability?.topFailingAgents || [];
  const summary = operations?.summary || {};
  const repairGovernance = governance?.repairGovernance || null;
  const qualitySummary = pipelineQuality?.summary || null;
  const actionItems = useMemo(() => {
    const items = [];

    if (alerts.length) {
      const topAlert = alerts[0];
      items.push({
        title: topAlert.message,
        subtitle: topAlert.recommendedAction,
        tone: topAlert.severity === 'high' ?'rose' : 'amber',
      });
    }

    if (summary.staleRunningRuns > 0) {
      items.push({
        title: `${summary.staleRunningRuns} run${summary.staleRunningRuns > 1 ?'s' : ''} travada${summary.staleRunningRuns > 1 ?'s' : ''}`,
        subtitle: 'Revise timeout, watchdog e recuperação automática antes da próxima rodada.',
        tone: 'rose',
      });
    }

    if (summary.overBudgetRuns > 0) {
      items.push({
        title: `${summary.overBudgetRuns} execução${summary.overBudgetRuns > 1 ?'es' : ''} acima do budget`,
        subtitle: 'Corte contexto, troque provider ou refine budgets por agente.',
        tone: 'amber',
      });
    }

    if ((summary.budgetPressureLevel || 'low') === 'high') {
      items.push({
        title: `Pressao de budget alta (${summary.recentBudgetPressurePercent || 0}%)`,
        subtitle: 'Ajuste budgets por agente e reduza o contexto das proximas execucoes.',
        tone: 'rose',
      });
    }

    if (topFailingAgents.length) {
      const lead = topFailingAgents[0];
      items.push({
        title: `${lead.agentName} lidera falhas recentes`,
        subtitle: `${lead.failed} falhas em ${lead.runs} runs e taxa de falha de ${lead.failureRate}%.`,
        tone: 'rose',
      });
    }

    if (readinessFailures.length) {
      items.push({
        title: `${readinessFailures.length} check${readinessFailures.length > 1 ?'s' : ''} crítico${readinessFailures.length > 1 ?'s' : ''}`,
        subtitle: 'Corrija os itens de readiness marcados como failed antes de ampliar a operação.',
        tone: 'rose',
      });
    }

    if (!items.length) {
      items.push({
        title: 'Operação estável neste momento',
        subtitle: 'Sem alertas críticos ativos, sem runs travadas e com health consistente.',
        tone: 'emerald',
      });
    }

    return items.slice(0, 4);
  }, [alerts, summary.staleRunningRuns, summary.overBudgetRuns, topFailingAgents, readinessFailures.length]);
  const primaryActionItem = actionItems[0];

  return (
    <AppShell
      eyebrow="Governança"
      title="Governança Operacional"
      description="Acompanhe saúde, alertas, custo, auditoria e estabilidade da operação de IA em um único lugar."
    >
      <div className="space-y-8">
        {error ?(
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div>
        ) : null}

        <motion.section {...fade(0.02)} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-8 px-8 py-8 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Operação da plataforma</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
                Veja o que precisa de atenção agora sem misturar isso com o fluxo de produto.
              </h2>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
                Esta área concentra saúde da API, estabilidade dos agentes, custos, trilha de auditoria e alertas ativos.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <select
                  value={selectedProjectUuid}
                  onChange={(e) => {
                    const projectUuid = e.target.value;
                    setSelectedProjectUuid(projectUuid);
                    refreshGovernanceDashboard({ projectUuid, silent: true });
                  }}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300"
                >
                  <option value="">Visão Consolidada (Todos os Projetos)</option>
                  {projects.map((p) => (
                    <option key={p.uuid} value={p.uuid}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Recarregar página
                </button>
                <button
                  type="button"
                  onClick={() => refreshGovernanceDashboard({ silent: true })}
                  disabled={refreshing || loading}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#102a72] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0d235f] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw className={`h-4 w-4 ${refreshing ?'animate-spin' : ''}`} strokeWidth={2} />
                  {refreshing ?'Atualizando...' : 'Atualizar sinais'}
                </button>
              </div>
            </div>
            <div className="space-y-3">
              <div className={`rounded-3xl border p-5 ${
                primaryActionItem?.tone === 'rose'
                  ?'border-rose-200 bg-rose-50 text-rose-900'
                  : primaryActionItem?.tone === 'amber'
                    ?'border-amber-200 bg-amber-50 text-amber-900'
                    :'border-emerald-200 bg-emerald-50 text-emerald-900'
              }`}>
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] opacity-70">Foco agora</p>
                <p className="mt-3 text-lg font-semibold">{primaryActionItem?.title || 'Operação estável neste momento'}</p>
                <p className="mt-2 text-sm leading-6 opacity-90">
                  {primaryActionItem?.subtitle || 'Sem alertas críticos ativos e sem runs travadas.'}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <InsightCard
                  label="Readiness gate"
                  value={readiness?.gate?.status || readiness?.status || 'n/a'}
                  hint={`${readiness?.gate?.blockers?.length || readinessFailures.length} blockers`}
                />
                <InsightCard
                  label="Alertas ativos"
                  value={alerts.length}
                  hint={alerts.length ? 'Atenção imediata' : 'Sem alertas'}
                />
                <InsightCard
                  label="P95"
                  value={`${summary.p95RunDurationSeconds || 0}s`}
                  hint={`${summary.successRatePercent || 0}% de sucesso`}
                />
                <InsightCard
                  label="Budget pressure"
                  value={`${summary.recentBudgetPressurePercent || 0}%`}
                  hint={summary.budgetPressureLabel || 'pressao baixa'}
                />
              </div>
              {releaseReadiness ? (
                <div className={`mt-4 rounded-3xl border p-4 ${
                  releaseReadiness.state === 'blocked'
                    ? 'border-rose-200 bg-rose-50 text-rose-900'
                    : releaseReadiness.state === 'watch'
                      ? 'border-amber-200 bg-amber-50 text-amber-900'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-900'
                }`}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] opacity-70">Próxima release</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <p className="text-lg font-semibold">{releaseReadiness.label}</p>
                    <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold">
                      Rollback: {releaseReadiness.rollbackReady ? 'pronto' : 'precisa de atenção'}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 opacity-90">{releaseReadiness.nextAction}</p>
                </div>
              ) : null}
            </div>
          </div>
        </motion.section>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Health API"
            value={health?.status || 'n/a'}
            hint={`Banco ${health?.database || 'n/a'} · ${health?.environment || 'n/a'}`}
            icon={ShieldCheck}
            tone={health?.status === 'ok' ?'emerald' : 'rose'}
          />
          <MetricCard
            label="Runs recentes"
            value={summary.totalRuns || 0}
            hint={`${summary.runningRuns || 0} em andamento · ${summary.staleRunningRuns || 0} travadas`}
            icon={Activity}
            tone="blue"
          />
          <MetricCard
            label="Custo estimado"
            value={formatCurrency(summary.totalCostUsd || 0)}
            hint={`${formatCompactNumber(summary.totalEstimatedTokens || 0)} tokens no recorte`}
            icon={DollarSign}
            tone={summary.overBudgetRuns > 0 ?'amber' : 'slate'}
          />
          <MetricCard
            label="Auditoria"
            value={governance?.summary?.totalEvents || 0}
            hint={`${governance?.summary?.failureEvents || 0} eventos com falha · ${governance?.summary?.uniqueActors || 0} atores`}
            icon={Workflow}
            tone="slate"
          />
        </div>

        {qualitySummary ?(
          <motion.section {...fade(0.05)} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Qualidade PM → RA → QA</p>
                <h2 className="mt-2 text-2xl font-bold text-slate-900">Métricas verificáveis da esteira</h2>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">Cobertura, qualidade e processo são calculados a partir dos contratos e revisões persistidos. Ausência de contrato gera finding, não uma estimativa de IA.</p>
              </div>
              <span className={`dashboard-badge ${qualitySummary.block > 0 ? 'bg-rose-100 text-rose-700' : qualitySummary.revise > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                Score {qualitySummary.quality_score ?? 0} · {qualitySummary.block > 0 ? 'BLOCK' : qualitySummary.revise > 0 ? 'REVISE' : 'PASS'}
              </span>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <InsightCard label="Projetos avaliados" value={qualitySummary.projects || 0} hint={`${qualitySummary.findings || 0} findings rastreáveis`} />
              <InsightCard label="Passaram" value={qualitySummary.pass || 0} hint={`${qualitySummary.revise || 0} precisam revisão`} />
              <InsightCard label="Bloqueados" value={qualitySummary.block || 0} hint="Somente evidências críticas bloqueiam" />
              <InsightCard label="Score consolidado" value={`${qualitySummary.quality_score ?? 0}/100`} hint="Threshold operacional: 85" />
            </div>
            <div className="mt-5 grid gap-3 xl:grid-cols-3">
              {(pipelineQuality?.projects || []).slice(0, 6).map((item) => (
                <div key={item.projectUuid} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-bold text-slate-900">{item.projectName}</p><span className="text-xs font-semibold text-slate-600">{item.quality_gate?.decision}</span></div>
                  <p className="mt-3 text-xs text-slate-600">Completude {item.metrics?.completeness ?? 0}% · Testabilidade {item.metrics?.testability ?? 0}% · Rastreabilidade {item.metrics?.traceability_coverage ?? 0}%</p>
                  <p className="mt-2 text-xs text-slate-500">{item.findings?.length || 0} findings · {item.process_metrics?.agent_runs || 0} execuções</p>
                </div>
              ))}
            </div>
          </motion.section>
        ) : null}

        {repairGovernance ?(
          <motion.section {...fade(0.06)} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Governanca do repair</p>
                <h2 className="mt-2 text-2xl font-bold text-slate-900">Qualidade do auto-reparo da esteira</h2>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                  Veja se os repairs continuam locais, quando escalam e quais causas raiz estao se repetindo no portfolio.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <InsightCard
                  label="Repair local"
                  value={`${repairGovernance.localRepairRatePercent ?? 0}%`}
                  hint={`${repairGovernance.complianceCounts?.compliant || 0} compliant`}
                />
                <InsightCard
                  label="Escalado"
                  value={`${repairGovernance.escalatedRatePercent ?? 0}%`}
                  hint={`${repairGovernance.repairsObserved || 0} repairs observados`}
                />
                <InsightCard
                  label="Aderencia media"
                  value={`${repairGovernance.averageAdherencePercent ?? 0}%`}
                  hint={`${repairGovernance.totalImplementationsObserved || 0} implementacoes lidas`}
                />
              </div>
            </div>

            <div className="mt-6 grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Causas mais frequentes</p>
                <div className="mt-4 space-y-3">
                  {repairGovernance.topRootCauses?.length ?(
                    repairGovernance.topRootCauses.map((item) => (
                      <div key={`root-${item.rootCause}`} className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700">
                        <strong className="text-slate-900">{item.rootCause}</strong>
                        <span className="ml-2 text-slate-500">{item.count}x</span>
                      </div>
                    ))
                  ) : (
                    <EmptyPanel title="Sem causa recorrente consolidada" subtitle="A telemetria ainda nao agrupou uma causa raiz dominante." />
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Mix de executores</p>
                <div className="mt-4 space-y-3">
                  {repairGovernance.executorMix?.length ?(
                    repairGovernance.executorMix.map((item) => (
                      <div key={`executor-${item.executor}`} className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-sm text-slate-700">
                        <span className="font-semibold text-slate-900">{formatExecutorLabel(item.executor)}</span>
                        <span className="dashboard-badge bg-slate-100 text-slate-700">{item.count}</span>
                      </div>
                    ))
                  ) : (
                    <EmptyPanel title="Sem executor dominante" subtitle="Ainda nao existe volume suficiente para consolidar o mix de executores." />
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Tendencia recente</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {(repairGovernance.trend || []).slice(-4).map((item) => (
                  <div key={`repair-trend-${item.date}`} className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{item.date}</p>
                    <p className="mt-2 font-semibold text-slate-900">{item.repairs} repairs</p>
                    <p className="mt-1 text-slate-500">local {item.localRatePercent}%</p>
                    <p className="text-slate-500">escalado {item.escalatedRatePercent}%</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.section>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <motion.section {...fade(0.08)} className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Atenção imediata</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">O que destravar agora</h2>
            </div>
            <div className="space-y-3 p-6">
              {actionItems.map((item) => (
                <EventCard key={`${item.title}-${item.subtitle}`} title={item.title} subtitle={item.subtitle} tone={item.tone} />
              ))}
            </div>
          </motion.section>

          <motion.section {...fade(0.12)} className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Operação IA</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">Resumo executivo da esteira</h2>
            </div>
            <div className="grid gap-4 p-6 md:grid-cols-2">
              <EventCard
                title={`${summary.successRatePercent || 0}% de sucesso`}
                subtitle={`${summary.completedRuns || 0} runs concluídas e ${summary.failedRuns || 0} falhas recentes.`}
                tone={summary.successRatePercent >= 80 ?'emerald' : summary.successRatePercent >= 60 ?'amber' : 'rose'}
              />
              <EventCard
                title={`${summary.overBudgetRuns || 0} acima do budget`}
                subtitle={`${summary.staleRunningRuns || 0} runs travadas e ${summary.runningRuns || 0} em andamento.`}
                tone={summary.overBudgetRuns > 0 || summary.staleRunningRuns > 0 ?'amber' : 'slate'}
              />
              <EventCard
                title={`${summary.p95RunDurationSeconds || 0}s de P95`}
                subtitle={`${summary.averageRunDurationSeconds || 0}s de média nas runs concluídas.`}
                tone="slate"
              />
              <EventCard
                title={formatCurrency(summary.totalCostUsd || 0)}
                subtitle={`${formatCompactNumber(summary.totalEstimatedTokens || 0)} tokens estimados no período.`}
                tone="slate"
              />
            </div>
          </motion.section>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <motion.section {...fade(0.16)} className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Readiness</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">Prontidão para operar</h2>
            </div>
            <div className="grid gap-4 p-6 md:grid-cols-2">
              <EventCard
                title={`v${readiness?.release?.version || 'n/a'} · ${readiness?.release?.channel || 'n/a'}`}
                subtitle="Release em operação"
              />
              <EventCard
                title={readiness?.security?.authSecretConfigured ?'Segredo de auth configurado' : 'Segredo de auth ausente'}
                subtitle="Segurança de autenticação"
                tone={readiness?.security?.authSecretConfigured ?'emerald' : 'rose'}
              />
              <EventCard
                title={`${Object.values(readiness?.providersConfigured || {}).filter(Boolean).length} provedores com chave`}
                subtitle="Capacidade remota atual"
              />
            </div>
            {readiness?.gate?.blockers?.length ?(
              <div className="mx-6 mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-rose-700">Blockers do gate</p>
                <div className="mt-3 space-y-2">
                  {readiness.gate.blockers.map((blocker) => (
                    <div key={blocker.code} className="rounded-2xl bg-white px-4 py-3 text-sm text-rose-800">
                      <strong className="text-rose-900">{blocker.label}</strong>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="space-y-3 px-6 pb-6">
              {(readiness?.checks || []).length ?(
                (readiness?.checks || []).map((check) => (
                  <EventCard
                    key={check.code}
                    title={check.label}
                    subtitle={`Status: ${check.status}`}
                    tone={check.status === 'failed' ?'rose' : check.status === 'warning' ?'amber' : 'emerald'}
                  />
                ))
              ) : (
                <EmptyPanel title="Sem checks de readiness" subtitle="Quando os checks estiverem disponíveis, eles aparecem aqui com status e risco." />
              )}
            </div>
            <div className="border-t border-slate-200 px-6 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Runbook recomendado</p>
              <div className="mt-4 space-y-3">
                {readinessRunbook.length ? (
                  readinessRunbook.map((item) => (
                    <EventCard
                      key={item.code}
                      title={item.title}
                      subtitle={item.detail}
                      tone={item.category === 'security' ? 'rose' : item.category === 'cost' ? 'amber' : 'slate'}
                    />
                  ))
                ) : (
                  <EmptyPanel
                    title="Sem ações recomendadas"
                    subtitle="O readiness não encontrou ações adicionais para a operação neste momento."
                  />
                )}
              </div>
            </div>
          </motion.section>

          <motion.section {...fade(0.2)} className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Alertas e hotspots</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">Onde a operação mais sofre</h2>
            </div>
            <div className="space-y-3 p-6">
              {alerts.length ?(
                alerts.slice(0, 3).map((alert) => (
                  <EventCard
                    key={alert.code}
                    title={alert.message}
                    subtitle={alert.recommendedAction}
                    tone={alert.severity === 'high' ?'rose' : 'amber'}
                  />
                ))
              ) : (
                <EventCard title="Nenhum alerta ativo" subtitle="A governança da plataforma está estável agora." tone="emerald" />
              )}
              {(governance?.failureHotspots || []).slice(0, 3).map((item) => (
                <EventCard
                  key={`failure-${item.actionType}`}
                  title={`${item.actionType} · ${item.failures} falhas`}
                  subtitle={`${item.failureRatePercent}% de falha`}
                  tone="rose"
                />
              ))}
              {(governance?.latencyHotspots || []).slice(0, 2).map((item) => (
                <EventCard
                  key={`latency-${item.actionType}`}
                  title={`${item.actionType} · ${item.averageDurationMs}ms`}
                  subtitle={`${item.total} eventos no recorte`}
                  tone="amber"
                />
              ))}
            </div>
          </motion.section>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr_1fr]">
          <motion.section {...fade(0.24)} className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Histórico</p>
              <h2 className="mt-2 text-xl font-bold text-slate-900">Últimos 7 dias</h2>
            </div>
            <div className="space-y-3 p-6">
              {historyTail.length ?(
                historyTail.map((day) => (
                  <EventCard
                    key={day.date}
                    title={`${day.date} · ${day.totalRuns} runs`}
                    subtitle={`${day.successRatePercent}% sucesso · ${formatCompactNumber(day.estimatedTokens)} tokens`}
                  />
                ))
              ) : (
                <EmptyPanel title="Sem histórico recente" subtitle="As tendências dos últimos dias aparecem aqui assim que a operação gerar dados." />
              )}
            </div>
          </motion.section>

          <motion.section {...fade(0.28)} className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Agentes em risco</p>
              <h2 className="mt-2 text-xl font-bold text-slate-900">Onde estabilizar primeiro</h2>
            </div>
            <div className="space-y-3 p-6">
              {topFailingAgents.length ?(
                topFailingAgents.slice(0, 5).map((agent) => (
                  <EventCard
                    key={agent.agentName}
                    title={`${agent.agentName} · ${agent.failed} falhas`}
                    subtitle={`${agent.failureRate}% de falha · ${agent.averageDurationSeconds}s de média · ${agent.averageTokens} tokens`}
                    tone={agent.failureRate >= 40 ?'rose' : 'amber'}
                  />
                ))
              ) : (
                <EmptyPanel title="Sem agentes instáveis no recorte" subtitle="Quando houver concentração de falhas por agente, ela aparece aqui." />
              )}
            </div>
          </motion.section>

          <motion.section {...fade(0.32)} className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Auditoria</p>
              <h2 className="mt-2 text-xl font-bold text-slate-900">Ações recentes</h2>
              <button type="button" onClick={handleExportAuditCsv} disabled={!auditTrail.length} className="dashboard-button-secondary px-3 py-1.5 text-xs">Exportar CSV</button>
            </div>
            <div className="space-y-3 p-6">
              {auditTrail.length ?(
                auditTrail.slice(0, 8).map((entry) => (
                  <EventCard
                    key={`${entry.timestamp}-${entry.actionType}`}
                    title={`${entry.method} ${entry.path}`}
                    subtitle={`${entry.actionType} · ${entry.userEmail || 'Usuário desconhecido'} · ${entry.durationMs}ms`}
                    tone={entry.success ?'slate' : 'rose'}
                  />
                ))
              ) : (
                <EmptyPanel title="Sem eventos recentes" subtitle="A trilha de auditoria aparece aqui conforme a plataforma recebe acoes operacionais." />
              )}
            </div>
          </motion.section>
        </div>

        <motion.section {...fade(0.36)} className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-4 p-6 md:grid-cols-3">
            <EventCard
              title={health?.status === 'ok' ?'API respondendo' : 'API com degradação'}
              subtitle={`Status da API: ${health?.status || 'n/a'}`}
              tone={health?.status === 'ok' ?'emerald' : 'rose'}
            />
            <EventCard
              title={health?.database === 'ok' ?'Banco operacional' : 'Banco exige atenção'}
              subtitle={`Banco: ${health?.database || 'n/a'}`}
              tone={health?.database === 'ok' ?'emerald' : 'rose'}
            />
            <EventCard
              title={`${governance?.summary?.coveredActionTypes || 0} fluxos auditados`}
              subtitle="Mostra quantos tipos de ação entraram no recorte de governança."
              tone="slate"
            />
          </div>
        </motion.section>
      </div>
    </AppShell>
  );
}
