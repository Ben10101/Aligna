import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import PipelineExecutor from '../components/PipelineExecutor';
import { getProject } from '../services/api';

export default function PipelinePage() {
  const { projectUuid } = useParams();
  const location = useLocation();
  const [projectData, setProjectData] = useState(null);
  const [loading, setLoading] = useState(Boolean(projectUuid && !location.state?.idea));

  const idea = location.state?.idea || projectData?.intakeConfig?.idea || projectData?.description;
  const answers = location.state?.answers || projectData?.intakeConfig?.answers;
  const projectName = location.state?.projectName || projectData?.name || 'Projeto';

  useEffect(() => {
    let active = true;

    async function loadProject() {
      if (!projectUuid || location.state?.idea) {
        setLoading(false);
        return;
      }

      try {
        const response = await getProject(projectUuid);
        if (active) {
          setProjectData(response);
        }
      } catch {
        if (active) {
          setProjectData(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadProject();

    return () => {
      active = false;
    };
  }, [location.state?.idea, projectUuid]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-4 text-slate-600 shadow-sm">
          Carregando esteira RE e QA...
        </div>
      </div>
    );
  }

  if (!idea) {
    return <Navigate to={projectUuid ? `/projects/${projectUuid}` : '/'} replace />;
  }

  return (
    <AppShell
      eyebrow="Projeto refinado"
      title="Esteira RE e QA"
      description="Acompanhe backlog, requisitos e QA dentro do contexto do projeto refinado, com foco em clareza funcional e cobertura."
      sidebar={
        <>
          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Resumo do projeto</p>
            </div>
            <div className="p-5">
              <p className="text-sm leading-6 text-slate-700">{idea}</p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{projectName}</p>
            </div>
          </section>

          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Agentes no fluxo</p>
            </div>
            <div className="space-y-3 p-4">
              {[
                ['PM', 'Converte ideia em backlog acionavel'],
                ['REQ', 'Refina criterios, regras de negocio e clareza funcional'],
                ['QA', 'Define cenarios, riscos, usabilidade e cobertura de teste'],
              ].map(([tag, text]) => (
                <div key={tag} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#102a72] text-xs font-bold text-white">
                      {tag}
                    </span>
                    <p className="text-sm text-slate-700">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {answers && (
            <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Briefing complementar</p>
              <p className="mt-3 text-sm leading-6 text-slate-700">
                As respostas adicionais já estão anexadas ao fluxo para enriquecer backlog, requisitos e QA.
              </p>
            </section>
          )}
        </>
      }
    >
      <PipelineExecutor idea={idea} answers={answers} />
    </AppShell>
  );
}
