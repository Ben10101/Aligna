import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate } from 'react-router-dom';
import { apiClient, getApiErrorMessage, listProjectTasks } from '../services/api';
import BacklogKanban from '../pages/BacklogKanban';

const PIPELINE_STAGES = [
  { name: 'Gerente de Produto', agent: 'project_manager', outputKey: 'backlog', dependsOn: [] },
  { name: 'Analista de Requisitos', agent: 'requirements_analyst', outputKey: 'requirements', dependsOn: ['backlog'] },
  { name: 'Engenheiro de QA', agent: 'qa_engineer', outputKey: 'tests', dependsOn: ['requirements'] },
];

export default function PipelineExecutor({ idea, answers }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [artifacts, setArtifacts] = useState({});
  const [projectId, setProjectId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [runMode, setRunMode] = useState(null);
  const [stagePendingCounts, setStagePendingCounts] = useState({ requirements: 0, qa: 0 });
  const [persistedTasks, setPersistedTasks] = useState([]);
  const navigate = useNavigate();

  const getStageName = (agent) => (agent === 'qa_engineer' ?'qa' : 'requirements');
  const isInteractiveStage = (agent) => agent === 'requirements_analyst' || agent === 'qa_engineer';

  useEffect(() => {
    if (runMode === 'mock_to_req') {
      const mockProjectId = `mock-proj-${crypto.randomUUID().slice(0, 8)}`;
      const mockBacklog =
        '# Backlog do projeto: Mock E-commerce\n\n- Como um cliente, eu quero adicionar um produto ao carrinho de compras, para que possa continuar com a compra.';

      setProjectId(mockProjectId);
      setArtifacts({ backlog: mockBacklog });
      setCurrentStep(1);
      return;
    }

    if (runMode === 'mock_to_qa') {
      const mockProjectId = `mock-proj-${crypto.randomUUID().slice(0, 8)}`;
      const mockBacklog =
        '# Backlog do projeto: Mock E-commerce\n\n- Como um cliente, eu quero adicionar um produto ao carrinho de compras, para que possa continuar com a compra.';

      const stories = mockBacklog
        .split('\n')
        .filter((line) => line.trim().match(/^[-*]?\s*\d*\.?\s*(?:\*\*)?Como\b/i));

      const mockRequirementsStories = stories.map((storyText, index) => ({
        id: `story-${index}`,
        text: storyText.replace(/^[-*]?\s*\d*\.?\s*(?:\*\*)?/, '').replace(/\*\*/g, '').trim(),
        status: 'done',
        requirement: `## Requisitos para "${storyText.replace(/^[-*]?\s*\d*\.?\s*/, '').trim()}"\n\n- **Criterio de aceite:** O sistema deve permitir a acao descrita na historia.\n- **Regra de negocio:** A acao so e valida para usuarios autenticados.\n- **Excecao:** Se o item estiver fora de estoque, o sistema deve informar o impedimento.`,
      }));

      const reqStorageKey = `kanban_stories_${mockProjectId}_requirements`;
      localStorage.setItem(reqStorageKey, JSON.stringify(mockRequirementsStories));

      const combinedRequirements = mockRequirementsStories
        .map((story) => `## Requisitos para "${story.text}"\n\n${story.requirement}`)
        .join('\n\n---\n\n');

      setProjectId(mockProjectId);
      setArtifacts({ backlog: mockBacklog, requirements: combinedRequirements });
      setCurrentStep(2);
      return;
    }

    if (runMode === 'full') {
      setCurrentStep(0);
    }
  }, [runMode]);

  useEffect(() => {
    if (!projectId) {
      setStagePendingCounts({ requirements: 0, qa: 0 });
      setPersistedTasks([]);
      return;
    }

    const readTaskState = async () => {
      try {
        const tasks = await listProjectTasks(projectId);
        setPersistedTasks(tasks);

        const requirementsPending = tasks.filter(
          (task) => !task.artifacts?.some((artifact) => artifact.artifactType === 'requirements' && artifact.isCurrent)
        ).length;

        const qaEligibleTasks = tasks.filter((task) =>
          task.artifacts?.some((artifact) => artifact.artifactType === 'requirements' && artifact.isCurrent)
        );

        const qaPending = qaEligibleTasks.filter(
          (task) => !task.artifacts?.some((artifact) => ['qa_validation_cases', 'test_plan'].includes(artifact.artifactType) && artifact.isCurrent)
        ).length;

        setStagePendingCounts({ requirements: requirementsPending, qa: qaPending });
      } catch {
        setStagePendingCounts({ requirements: 0, qa: 0 });
      }
    };

    readTaskState();
    const intervalId = setInterval(readTaskState, 1500);
    return () => clearInterval(intervalId);
  }, [projectId, currentStep]);

  const handleRunStep = async (stepIndex) => {
    if (loading) return;

    const stage = PIPELINE_STAGES[stepIndex];
    setLoading(true);
    setError(null);

    try {
      const payload = {
        project_id: projectId,
        idea,
        answers,
      };

      stage.dependsOn.forEach((depKey) => {
        payload[depKey] = artifacts[depKey];
      });

      if (stage.agent === 'qa_engineer' && !payload.code) {
        payload.code = artifacts.requirements || 'Modo TDD: gerando QA a partir dos requisitos.';
        payload.developer_output = { code: payload.code };
      }

      const response = await apiClient.post('/agents/run', {
        agent: stage.agent,
        payload,
      });

      const { data, project_id: newProjectId } = response.data;

      if (!projectId && newProjectId) {
        setProjectId(newProjectId);
      }

      setArtifacts((prev) => ({ ...prev, [stage.outputKey]: data }));
      setCurrentStep(stepIndex + 1);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Ocorreu um erro desconhecido.'));
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteKanbanStep = (stepIndex, bypassValidation = false, selectedStory = null) => {
    const currentStage = PIPELINE_STAGES[stepIndex];
    const stageName = getStageName(currentStage.agent);
    const relevantTasks =
      stageName === 'requirements'
        ?persistedTasks
        : persistedTasks.filter((task) =>
            task.artifacts?.some((artifact) => artifact.artifactType === 'requirements' && artifact.isCurrent && artifact.isApproved)
          );

    const completedTasks = relevantTasks.filter((task) =>
      task.artifacts?.some((artifact) =>
        (stageName === 'requirements'
          ? artifact.artifactType === 'requirements'
          : ['qa_validation_cases', 'test_plan'].includes(artifact.artifactType)) && artifact.isCurrent && artifact.isApproved
      )
    );

    const isReady = relevantTasks.length > 0 && completedTasks.length === relevantTasks.length;

    if (!isReady && !bypassValidation) {
      const pendingCount = relevantTasks.length - completedTasks.length;
      setError(
        `Voce ainda tem ${pendingCount > 0 ?pendingCount : 'algumas'} historias pendentes na coluna "A Fazer". Processe todas antes de avancar.`
      );
      return;
    }

    let tasksToAdvance = completedTasks;
    if (bypassValidation && selectedStory) {
      tasksToAdvance = completedTasks.filter(
        (task) => task.uuid === selectedStory.id || task.title.trim() === selectedStory.text.trim()
      );
    }

    const header = stageName === 'qa' ?'## Casos de validação para:' : '## Requisitos para:';
    const artifactType = stageName === 'qa' ?'qa_validation_cases' : 'requirements';

    const combinedOutput = tasksToAdvance
      .map((task) => {
        const artifact = task.artifacts?.find((item) => (stageName === 'qa'
          ? ['qa_validation_cases', 'test_plan'].includes(item.artifactType)
          : item.artifactType === artifactType) && item.isCurrent);
        return artifact ?`${header} "${task.title}"\n\n${artifact.content}` : null;
      })
      .filter(Boolean)
      .join('\n\n---\n\n');

    setArtifacts((prev) => ({ ...prev, [currentStage.outputKey]: combinedOutput }));
    if (stepIndex === currentStep) {
      setCurrentStep(stepIndex + 1);
    }
    setError(null);
  };

  const qaPredecessorStories = useMemo(() => {
    if (runMode === 'mock_to_qa') {
      const reqKey = `kanban_stories_${projectId}_requirements`;
      const savedReqsRaw = localStorage.getItem(reqKey);
      return savedReqsRaw ?JSON.parse(savedReqsRaw) : [];
    }

    if (projectId) {
      return persistedTasks.map((task) => ({
        id: task.uuid,
        text: task.title,
        status: task.artifacts?.some((artifact) => artifact.artifactType === 'requirements' && artifact.isCurrent)
          ?'done'
          : 'todo',
        requirement:
          task.artifacts?.find((artifact) => artifact.artifactType === 'requirements' && artifact.isCurrent)?.content ||
          null,
      }));
    }

    return [];
  }, [projectId, runMode, persistedTasks]);

  const getKanbanConfig = (agentType) => {
    if (agentType === 'qa_engineer') {
      return {
        stageName: 'qa',
        agent: 'qa_engineer',
        title: 'Kanban de Qualidade (QA)',
        subtitle: 'Arraste as historias para o Engenheiro de QA gerar cenarios de teste, riscos e validacoes.',
        agentColumnTitle: 'Engenheiro de QA',
        processingMessage: 'Criando cenarios de teste...',
        promptInstruction:
          'Atue como um Engenheiro de QA Senior. Baseado na historia de usuario e nos REQUISITOS TECNICOS fornecidos, gere uma resposta em Markdown, profissional, critica e detalhista, usando listas numeradas com titulos em negrito. Inclua obrigatoriamente: 1. Estrategia de Testes, 2. Dados de Teste Sugeridos, 3. Metricas de Qualidade, 4. Cenarios de Testes com exatamente 5 cenarios de caminho feliz e 5 cenarios de caminho de excecao, 5. Casos de Teste Funcionais com Acao e Resultado Esperado, 6. Analise de Usabilidade e Acessibilidade com Heuristicas de Nielsen, Leis de UX (Fitts, Miller e Jakob) e criterios WCAG com contraste minimo 4.5:1, legibilidade e areas de toque de 44x44px.',
        predecessorStories: qaPredecessorStories,
      };
    }

    return {
      stageName: 'requirements',
      agent: 'requirements_analyst',
      title: 'Kanban de Historias',
    };
  };

  const handleFinishPipeline = () => {
    const finalData = {
      ...artifacts,
      timestamp: new Date().toISOString(),
    };
    navigate(`/results/${projectId}`, { state: { data: finalData } });
  };

  const shouldRenderKanban = (stage, index) => {
    if (!isInteractiveStage(stage.agent)) return false;
    const stageName = getStageName(stage.agent);
    return currentStep === index || (currentStep > index && stagePendingCounts[stageName] > 0);
  };

  if (!runMode) {
    return (
      <div className="dashboard-panel">
        <div className="dashboard-panel-header">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Modo do fluxo</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">Escolha como este workspace vai começar</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Você pode iniciar no fluxo completo ou abrir o board já posicionado na etapa de requisitos ou QA.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 p-8 md:grid-cols-3">
          <button
            onClick={() => setRunMode('full')}
            className="flex flex-col items-center justify-center rounded-2xl bg-[#102a72] p-6 font-semibold text-white transition hover:bg-[#0c205a]"
          >
            <span className="mb-2 text-4xl">PM</span>
            Fluxo completo
          </button>
          <button
            onClick={() => setRunMode('mock_to_req')}
            className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 font-semibold text-slate-800 transition hover:border-[#102a72]/20 hover:bg-slate-50"
          >
            <span className="mb-2 text-4xl">REQ</span>
            Iniciar em Requisitos
          </button>
          <button
            onClick={() => setRunMode('mock_to_qa')}
            className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 font-semibold text-slate-800 transition hover:border-[#102a72]/20 hover:bg-slate-50"
          >
            <span className="mb-2 text-4xl">QA</span>
            Iniciar em Qualidade
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="dashboard-panel mb-6">
        <div className="dashboard-panel-header">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Contexto da task</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">Fluxo operacional da task</h1>
        </div>
        <div className="p-6">
          <p className="text-sm leading-6 text-slate-600">
            <strong>Ideia:</strong> "{idea}"
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700" role="alert">
          <p className="font-bold">Erro na execu??o</p>
          <p>{error}</p>
        </div>
      )}

      <div className="space-y-6">
        {PIPELINE_STAGES.map((stage, index) => (
          <div key={stage.agent} className="dashboard-panel">
            <div className="dashboard-panel-header flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold text-slate-800">
                  {index + 1}. {stage.name}
                </h2>
                <p className="text-sm text-slate-500">
                  Gera o artefato: <strong>{stage.outputKey}</strong>
                </p>
              </div>
              {currentStep === index && (
                <>
                  {isInteractiveStage(stage.agent) ?(
                    <span className="rounded-full bg-blue-50 px-5 py-2 text-sm font-semibold text-[#102a72]">
                      Ação pendente no board abaixo
                    </span>
                  ) : (
                    <button onClick={() => handleRunStep(index)} disabled={loading} className="dashboard-button-primary">
                      {loading ?'Executando...' : `Executar ${stage.name}`}
                    </button>
                  )}
                </>
              )}
              {currentStep > index && isInteractiveStage(stage.agent) && stagePendingCounts[getStageName(stage.agent)] > 0 && (
                <span className="rounded-full bg-amber-50 px-5 py-2 text-sm font-semibold text-amber-700">
                  Pendências restantes
                </span>
              )}
              {currentStep > index &&
                (!isInteractiveStage(stage.agent) || stagePendingCounts[getStageName(stage.agent)] === 0) && (
                  <span className="rounded-full bg-emerald-50 px-5 py-2 text-sm font-semibold text-emerald-700">
                    Concluído
                  </span>
                )}
            </div>

            {shouldRenderKanban(stage, index) && (
              <div className="border-t border-slate-200 p-6">
                <BacklogKanban
                  key={`${stage.agent}-${projectId}`}
                  backlogMarkdown={artifacts.backlog || ''}
                  projectId={projectId}
                  onAllStoriesDone={() => handleCompleteKanbanStep(index, false)}
                  onAdvance={(story) => handleCompleteKanbanStep(index, true, story)}
                  {...getKanbanConfig(stage.agent)}
                />
              </div>
            )}

            {artifacts[stage.outputKey] && (
              <div className="px-6 pb-6">
                <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="prose prose-slate max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {typeof artifacts[stage.outputKey] === 'string'
                        ?artifacts[stage.outputKey]
                        : `\`\`\`json\n${JSON.stringify(artifacts[stage.outputKey], null, 2)}\n\`\`\``}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {currentStep === PIPELINE_STAGES.length && (
        <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
          <h2 className="text-3xl font-bold text-emerald-800">Fluxo concluído</h2>
          <p className="mt-2 text-emerald-700">Backlog, requisitos e QA foram consolidados com sucesso.</p>
          <button onClick={handleFinishPipeline} className="dashboard-button-primary mt-4">
            Ver central de artefatos
          </button>
        </div>
      )}
    </div>
  );
}
