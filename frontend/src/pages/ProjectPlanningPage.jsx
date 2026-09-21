import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { getApiErrorMessage, getProject, listProjectTasks, updateProjectBrief } from '../services/api';

function TextAreaField({ label, value, onChange, placeholder, rows = 4 }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.28em] text-slate-500">{label}</span>
      <textarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        className="dashboard-input min-h-[120px] resize-none"
      />
    </label>
  );
}

function formatShortDate(value) {
  if (!value) return 'Sem prazo';
  return new Date(value).toLocaleDateString('pt-BR');
}

export default function ProjectPlanningPage() {
  const navigate = useNavigate();
  const { projectUuid } = useParams();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [roadmap, setRoadmap] = useState({
    milestone: '',
    phase1: '',
    phase2: '',
    phase3: '',
  });
  const [riskRegister, setRiskRegister] = useState({
    risk1: '',
    risk2: '',
    risk3: '',
    impediment1: '',
    impediment2: '',
  });
  const [timeline, setTimeline] = useState({
    startDate: '',
    targetDate: '',
    weeklyCapacity: '',
  });

  const groupedStats = useMemo(
    () => ({
      total: tasks.length,
      backlog: tasks.filter((task) => task.status === 'backlog').length,
      inProgress: tasks.filter((task) => task.status === 'in_progress').length,
      done: tasks.filter((task) => task.status === 'done').length,
    }),
    [tasks]
  );

  const roadmapPhases = project?.intakeConfig?.roadmap?.phases || [];
  const riskCount = project?.intakeConfig?.riskRegister?.risks?.length || 0;
  const impedimentCount = project?.intakeConfig?.riskRegister?.impediments?.length || 0;

  useEffect(() => {
    loadPlanning();
  }, [projectUuid]);

  async function loadPlanning() {
    setLoading(true);
    setError(null);

    try {
      const [projectData, taskList] = await Promise.all([getProject(projectUuid), listProjectTasks(projectUuid)]);
      setProject(projectData);
      setTasks(taskList);
      setRoadmap({
        milestone: projectData?.intakeConfig?.roadmap?.milestone || '',
        phase1: projectData?.intakeConfig?.roadmap?.phases?.[0]?.title || '',
        phase2: projectData?.intakeConfig?.roadmap?.phases?.[1]?.title || '',
        phase3: projectData?.intakeConfig?.roadmap?.phases?.[2]?.title || '',
      });
      setRiskRegister({
        risk1: projectData?.intakeConfig?.riskRegister?.risks?.[0] || '',
        risk2: projectData?.intakeConfig?.riskRegister?.risks?.[1] || '',
        risk3: projectData?.intakeConfig?.riskRegister?.risks?.[2] || '',
        impediment1: projectData?.intakeConfig?.riskRegister?.impediments?.[0] || '',
        impediment2: projectData?.intakeConfig?.riskRegister?.impediments?.[1] || '',
      });
      setTimeline({
        startDate: projectData?.intakeConfig?.timeline?.startDate || '',
        targetDate: projectData?.intakeConfig?.timeline?.targetDate || '',
        weeklyCapacity: projectData?.intakeConfig?.timeline?.weeklyCapacity || '',
      });
    } catch (loadError) {
      if (loadError.response?.status === 404) {
        navigate('/projects', { replace: true });
        return;
      }
      setError(getApiErrorMessage(loadError, 'Não foi possível carregar o planejamento do projeto.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleSavePlanning(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMessage('');

    try {
      const nextIntakeConfig = {
        ...(project?.intakeConfig || {}),
        roadmap: {
          milestone: roadmap.milestone.trim(),
          phases: [
            { order: 1, title: roadmap.phase1.trim() },
            { order: 2, title: roadmap.phase2.trim() },
            { order: 3, title: roadmap.phase3.trim() },
          ].filter((phase) => phase.title),
        },
        riskRegister: {
          risks: [riskRegister.risk1.trim(), riskRegister.risk2.trim(), riskRegister.risk3.trim()].filter(Boolean),
          impediments: [riskRegister.impediment1.trim(), riskRegister.impediment2.trim()].filter(Boolean),
        },
        timeline: {
          startDate: timeline.startDate || null,
          targetDate: timeline.targetDate || null,
          weeklyCapacity: timeline.weeklyCapacity ? Number(timeline.weeklyCapacity) : null,
        },
      };

      const updatedProject = await updateProjectBrief(projectUuid, {
        intakeConfig: nextIntakeConfig,
      });

      setProject(updatedProject);
      setSuccessMessage('Planejamento salvo com sucesso.');
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, 'Não foi possível salvar o planejamento do projeto.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      eyebrow="Planejamento"
      title={project?.name || 'Planejamento do projeto'}
      description="Use esta tela para manter roadmap, riscos, impedimentos e timeline organizados em um lugar próprio."
      actions={
        <div className="flex flex-col gap-3 sm:flex-row">
          <button onClick={() => navigate(`/projects/${projectUuid}`)} className="dashboard-button-secondary w-full sm:w-auto">
            Voltar ao overview
          </button>
          <button onClick={() => navigate(`/projects/${projectUuid}/team`)} className="dashboard-button-secondary w-full sm:w-auto">
            Abrir equipe
          </button>
          <button onClick={() => navigate(`/projects/${projectUuid}`)} className="dashboard-button-primary w-full sm:w-auto">
            Abrir contexto
          </button>
        </div>
      }
      sidebar={
        <>
          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Resumo rápido</p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4">
              {[
                [groupedStats.total, 'Tasks'],
                [groupedStats.backlog, 'Backlog'],
                [groupedStats.inProgress, 'Em progresso'],
                [groupedStats.done, 'Concluídas'],
              ].map(([value, label]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-2xl font-semibold text-slate-900">{value}</div>
                  <div className="mt-1 text-xs text-slate-500">{label}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Roadmap</p>
            <p className="mt-3 text-sm text-slate-700">
              {roadmap.milestone || 'Defina o próximo marco principal para orientar a evolução do produto.'}
            </p>
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <p>
                <strong>Fase 1:</strong> {roadmap.phase1 || 'Não definida'}
              </p>
              <p>
                <strong>Fase 2:</strong> {roadmap.phase2 || 'Não definida'}
              </p>
              <p>
                <strong>Fase 3:</strong> {roadmap.phase3 || 'Não definida'}
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-rose-600">Riscos</p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Atenção no plano</p>
                <p className="mt-2 text-sm text-slate-700">
                  {project?.intakeConfig?.riskRegister?.impediments?.[0] || project?.intakeConfig?.riskRegister?.risks?.[0] || 'Sem impedimentos registrados.'}
                </p>
              </div>
              <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-rose-600">
                {riskCount} riscos · {impedimentCount} impedimentos
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">Timeline</p>
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <p><strong>Início:</strong> {formatShortDate(project?.intakeConfig?.timeline?.startDate)}</p>
              <p><strong>Meta:</strong> {formatShortDate(project?.intakeConfig?.timeline?.targetDate)}</p>
              <p><strong>Capacidade:</strong> {project?.intakeConfig?.timeline?.weeklyCapacity || 'Não definida'}</p>
            </div>
          </section>
        </>
      }
    >
      <section className="space-y-6">
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
        {successMessage && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{successMessage}</div>}

        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Planejamento</p>
            <h3 className="mt-2 text-2xl font-bold text-slate-900">Roadmap, riscos e capacidade</h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Use esta área para manter o plano executivo do projeto sem misturar com briefing, arquitetura e board operacional.
            </p>
          </div>

          <form className="grid gap-4 p-6" onSubmit={handleSavePlanning}>
            <TextAreaField
              label="Marco principal"
              value={roadmap.milestone}
              onChange={(event) => setRoadmap((prev) => ({ ...prev, milestone: event.target.value }))}
              placeholder="Ex.: liberar o fluxo completo de reembolsos com aprovação e relatório"
              rows={3}
            />

            <div className="grid gap-4 lg:grid-cols-3">
              <TextAreaField
                label="Fase 1"
                value={roadmap.phase1}
                onChange={(event) => setRoadmap((prev) => ({ ...prev, phase1: event.target.value }))}
                placeholder="Base operacional e rastreabilidade"
                rows={4}
              />
              <TextAreaField
                label="Fase 2"
                value={roadmap.phase2}
                onChange={(event) => setRoadmap((prev) => ({ ...prev, phase2: event.target.value }))}
                placeholder="Colaboração, relatórios e visões gerenciais"
                rows={4}
              />
              <TextAreaField
                label="Fase 3"
                value={roadmap.phase3}
                onChange={(event) => setRoadmap((prev) => ({ ...prev, phase3: event.target.value }))}
                placeholder="Portfólio, integrações e governança avançada"
                rows={4}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <TextAreaField
                  label="Risco 1"
                  value={riskRegister.risk1}
                  onChange={(event) => setRiskRegister((prev) => ({ ...prev, risk1: event.target.value }))}
                  placeholder="Ex.: dependência de API externa sem SLA claro"
                  rows={3}
                />
                <TextAreaField
                  label="Risco 2"
                  value={riskRegister.risk2}
                  onChange={(event) => setRiskRegister((prev) => ({ ...prev, risk2: event.target.value }))}
                  placeholder="Ex.: mudanças regulatórias no fluxo de aprovação"
                  rows={3}
                />
                <TextAreaField
                  label="Risco 3"
                  value={riskRegister.risk3}
                  onChange={(event) => setRiskRegister((prev) => ({ ...prev, risk3: event.target.value }))}
                  placeholder="Ex.: baixa cobertura de QA nos cenários críticos"
                  rows={3}
                />
              </div>

              <div className="space-y-4">
                <TextAreaField
                  label="Impedimento 1"
                  value={riskRegister.impediment1}
                  onChange={(event) => setRiskRegister((prev) => ({ ...prev, impediment1: event.target.value }))}
                  placeholder="Ex.: aguardando definição do financeiro"
                  rows={3}
                />
                <TextAreaField
                  label="Impedimento 2"
                  value={riskRegister.impediment2}
                  onChange={(event) => setRiskRegister((prev) => ({ ...prev, impediment2: event.target.value }))}
                  placeholder="Ex.: falta de acesso ao ambiente de homologação"
                  rows={3}
                />

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Resumo rápido</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Riscos</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">
                        {[riskRegister.risk1, riskRegister.risk2, riskRegister.risk3].filter(Boolean).length}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Impedimentos</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">
                        {[riskRegister.impediment1, riskRegister.impediment2].filter(Boolean).length}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <TextAreaField
                label="Início do plano"
                value={timeline.startDate}
                onChange={(event) => setTimeline((prev) => ({ ...prev, startDate: event.target.value }))}
                placeholder="AAAA-MM-DD"
                rows={2}
              />
              <TextAreaField
                label="Meta de entrega"
                value={timeline.targetDate}
                onChange={(event) => setTimeline((prev) => ({ ...prev, targetDate: event.target.value }))}
                placeholder="AAAA-MM-DD"
                rows={2}
              />
              <TextAreaField
                label="Capacidade semanal"
                value={timeline.weeklyCapacity}
                onChange={(event) => setTimeline((prev) => ({ ...prev, weeklyCapacity: event.target.value }))}
                placeholder="Ex.: 8 tasks"
                rows={2}
              />
            </div>

            <div className="flex justify-end">
              <button type="submit" disabled={loading || saving} className="dashboard-button-primary w-full sm:w-auto">
                {saving ? 'Salvando...' : 'Salvar planejamento'}
              </button>
            </div>
          </form>
        </section>
      </section>
    </AppShell>
  );
}
