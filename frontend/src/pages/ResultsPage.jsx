import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import ResultTabs from '../components/ResultTabs';
import BacklogKanban from './BacklogKanban';

export default function ResultsPage() {
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (location.state?.data) {
      setData(location.state.data);

      const backlogLines = (location.state.data.backlog || '').split('\n').length;
      const requirementsLines = (location.state.data.requirements || '').split('\n').length;
      const testsLines = (location.state.data.tests || '').split('\n').length;

      setStats({
        backlogLines,
        requirementsLines,
        testsLines,
        totalLines: backlogLines + requirementsLines + testsLines,
        timestamp: location.state.data.timestamp,
      });
      return;
    }

    navigate('/');
  }, [location, navigate]);

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-4 text-slate-600 shadow-sm">
          Carregando resultado do projeto...
        </div>
      </div>
    );
  }

  return (
    <AppShell
      eyebrow="Central de Resultados"
      title="Central de Artefatos do Projeto"
      description={`Projeto ${projectId} consolidado com backlog, requisitos e QA na mesma visão operacional.`}
      actions={
        <>
          <button onClick={() => navigate('/')} className="dashboard-button-secondary w-full sm:w-auto">
            Voltar ao workspace
          </button>
        </>
      }
      sidebar={
        <>
          {stats && (
            <section className="dashboard-panel">
              <div className="dashboard-panel-header">
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Métricas do projeto</p>
              </div>
              <div className="grid grid-cols-2 gap-3 p-4">
                {[
                  [stats.backlogLines, 'Backlog'],
                  [stats.requirementsLines, 'Requisitos'],
                  [stats.testsLines, 'Testes'],
                  [stats.totalLines, 'Total'],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="text-2xl font-semibold text-slate-900">{value}</div>
                    <div className="mt-1 text-xs text-slate-500">{label}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Operação</p>
            </div>
            <div className="space-y-3 p-5 text-sm text-slate-700">
              <p>Os artefatos já estão organizados por etapa e prontos para versionamento.</p>
              <p>O próximo passo natural é ligar backlog, comentários e status ao board persistido.</p>
              <p>Você pode usar esse resultado como documentação viva da task.</p>
            </div>
          </section>
        </>
      }
    >
      <section className="space-y-6">
        <div className="dashboard-panel p-4 sm:p-6">
          <ResultTabs data={data} />
        </div>

        <div className="dashboard-panel">
          <div className="dashboard-panel-header">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Board do projeto refinado</p>
                <h3 className="mt-2 text-xl font-bold text-slate-900">Visão operacional do backlog</h3>
              </div>
              <span className="w-fit rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
                Projeto {projectId}
              </span>
            </div>
          </div>
          <div className="p-6">
            <BacklogKanban
              backlogMarkdown={data.backlog}
              projectId={projectId}
              stageName="results"
              contextLabel="projeto refinado"
              title="Board de Refinamento"
              subtitle="As histórias ficam organizadas dentro do contexto deste projeto antes de seguir para a próxima etapa."
            />
          </div>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-center shadow-sm">
          <p className="text-sm text-slate-700">
            Projeto gerado em {stats?.timestamp ? new Date(stats.timestamp).toLocaleString('pt-BR') : 'data desconhecida'}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Este painel já funciona como uma base de documentação para o workspace de tarefas.
          </p>
        </div>
      </section>
    </AppShell>
  );
}
