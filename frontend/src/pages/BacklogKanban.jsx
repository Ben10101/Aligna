import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Copy,
  FileText,
  GripVertical,
  Rocket,
  X,
} from 'lucide-react';
import {
  apiClient,
  createTaskArtifact,
  ensurePipelineProject,
  getApiErrorMessage,
  importBacklogTasks,
  listAllTasks,
  listProjectTasks,
} from '../services/api';

const MOCK_STORIES = [
  'Como um cliente, eu quero adicionar um produto ao carrinho de compras, para que possa continuar com a compra.',
  'Como um cliente, eu quero atualizar a quantidade de um produto no carrinho de compras, para que possa fazer altera??es caso necess?rio.',
  'Como um cliente, eu quero remover um produto do carrinho de compras, para que possa excluir itens que nao necessito mais.',
];

const EMPTY_ARRAY = [];

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.28, delay, ease: 'easeOut' },
});

const PRIORITY_STYLE = {
  HIGH: {
    dot: 'bg-rose-500',
    badge: 'bg-rose-50 text-rose-700',
    label: 'Alta',
  },
  MEDIUM: {
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-700',
    label: 'M?dia',
  },
  LOW: {
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700',
    label: 'Baixa',
  },
};

const SORT_OPTIONS = {
  suggested: 'Sequencia sugerida',
  priority: 'Prioridade',
  status: 'Status',
};

const PRIORITY_RANK = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

const STATUS_RANK = {
  processing: 0,
  todo: 1,
  done: 2,
};

function getSuggestedOrder(story) {
  const rawPosition = story?.task?.position ?? story?.order ?? story?.position ?? Number.MAX_SAFE_INTEGER;
  const numeric = Number(rawPosition);
  return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}

function compareStories(left, right, sortMode) {
  if (sortMode === 'priority') {
    const priorityDiff =
      (PRIORITY_RANK[left.priority] ?? PRIORITY_RANK.MEDIUM) -
      (PRIORITY_RANK[right.priority] ?? PRIORITY_RANK.MEDIUM);
    if (priorityDiff !== 0) return priorityDiff;
  }

  if (sortMode === 'status') {
    const statusDiff =
      (STATUS_RANK[left.status] ?? STATUS_RANK.todo) -
      (STATUS_RANK[right.status] ?? STATUS_RANK.todo);
    if (statusDiff !== 0) return statusDiff;
  }

  const suggestedDiff = getSuggestedOrder(left) - getSuggestedOrder(right);
  if (suggestedDiff !== 0) return suggestedDiff;

  return (left.title || left.text || '').localeCompare(right.title || right.text || '', 'pt-BR');
}

function parseBacklogLines(backlogMarkdown) {
  const storyLines = backlogMarkdown
    ?backlogMarkdown.split('\n').filter((line) => line.trim().match(/^[-*]?\s*\d*\.?\s*(?:\*\*)?Como\b/i))
    : MOCK_STORIES;

  return storyLines.map((text, index) => {
    const cleanText = text.replace(/^[-*]?\s*\d*\.?\s*(?:\*\*)?/, '').replace(/\*\*/g, '').trim();

    let priority = 'MEDIUM';
    const lowKeywords = ['melhoria', 'low', 'baixa', 'estetico', 'non-critical'];
    const highKeywords = ['urgente', 'fix', 'urgency', 'critico', 'critical', 'erro', 'bug'];
    const textLower = cleanText.toLowerCase();
    if (highKeywords.some((keyword) => textLower.includes(keyword))) priority = 'HIGH';
    else if (lowKeywords.some((keyword) => textLower.includes(keyword))) priority = 'LOW';

    return {
      id: `story-${index}`,
      text: cleanText,
      title: cleanText.split(' - ')[0] || cleanText,
      status: 'todo',
      priority,
      requirement: null,
      isReady: true,
    };
  });
}

function mapTasksToStories(tasks, stageName) {
  return tasks
    .map((task) => {
      const requirementsArtifact = task.artifacts?.find(
        (artifact) => artifact.artifactType === 'requirements' && artifact.isCurrent && artifact.isApproved
      );
      const qaArtifact = task.artifacts?.find(
        (artifact) => ['qa_validation_cases', 'test_plan'].includes(artifact.artifactType) && artifact.isCurrent && artifact.isApproved
      );

      if (stageName === 'qa' && !requirementsArtifact) {
        return null;
      }

      let priority = 'MEDIUM';
      const lowKeywords = ['melhoria', 'low', 'baixa', 'estetico', 'non-critical'];
      const highKeywords = ['urgente', 'fix', 'urgency', 'critico', 'critical', 'erro', 'bug'];
      const textToSearch = `${task.title} ${task.description || ''}`.toLowerCase();
      if (highKeywords.some((keyword) => textToSearch.includes(keyword))) priority = 'HIGH';
      else if (lowKeywords.some((keyword) => textToSearch.includes(keyword))) priority = 'LOW';

      return {
        id: task.uuid,
        text: task.title,
        title: task.title,
        status: stageName === 'requirements' ?(requirementsArtifact ?'done' : 'todo') : qaArtifact ?'done' : 'todo',
        priority: (task.priority || priority || 'MEDIUM').toUpperCase(),
        requirement:
          stageName === 'requirements'
            ?requirementsArtifact?.content || null
            : qaArtifact?.content || null,
        predecessorRequirement: requirementsArtifact?.content || null,
        isReady: stageName !== 'qa' || Boolean(requirementsArtifact),
        task,
      };
    })
    .filter(Boolean);
}

function StoryCard({ story, canDrag, onDragStart, onOpenModal, index }) {
  const priority = PRIORITY_STYLE[story.priority] || PRIORITY_STYLE.MEDIUM;

  return (
    <motion.div
      {...fade(index * 0.04)}
      draggable={canDrag}
      onDragStart={(event) => canDrag && onDragStart(event, story)}
      className={`group rounded-xl border px-4 py-4 transition-all ${
        canDrag
          ?'cursor-grab border-slate-200 bg-white shadow-sm hover:border-[#102a72]/30 hover:shadow-md active:cursor-grabbing'
          : 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`dashboard-badge ${priority.badge}`}>
              <span className={`h-2 w-2 rounded-full ${priority.dot}`} />
              {priority.label}
            </span>
            {!story.isReady && (
              <span className="dashboard-badge bg-slate-100 text-slate-500">Aguardando requisito anterior</span>
            )}
          </div>
          <h4 className="mt-3 text-sm font-semibold text-slate-900">{story.title}</h4>
          <p className="mt-2 text-sm leading-6 text-slate-500">{story.text}</p>
        </div>
        {canDrag && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400 transition group-hover:bg-[#102a72]/10 group-hover:text-[#102a72]">
            <GripVertical className="h-4 w-4" />
          </div>
        )}
      </div>

      {story.predecessorRequirement && (
        <button
          type="button"
          onClick={() => onOpenModal({ ...story, requirement: story.predecessorRequirement })}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#102a72]/5 px-3 py-2 text-xs font-semibold text-[#102a72] transition hover:bg-[#102a72]/10"
        >
          <FileText className="h-3.5 w-3.5" />
          Ver requisito vinculado
        </button>
      )}
    </motion.div>
  );
}

function ProcessedCard({ story, stageName, processingMessage, onOpenModal, onAdvance }) {
  const priority = PRIORITY_STYLE[story.priority] || PRIORITY_STYLE.MEDIUM;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`dashboard-badge ${priority.badge}`}>
              <span className={`h-2 w-2 rounded-full ${priority.dot}`} />
              {priority.label}
            </span>
            <span className="dashboard-badge bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {story.status === 'processing' ?'Em execução' : 'Artefato pronto'}
            </span>
          </div>
          <h4 className="mt-3 text-sm font-semibold text-slate-900">{story.title}</h4>
          <p className="mt-2 text-sm leading-6 text-slate-500">{story.text}</p>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
        {story.status === 'processing' ?(
          <div className="flex items-center gap-3 text-sm font-medium text-[#102a72]">
            <Clock3 className="h-4 w-4 animate-pulse" />
            {processingMessage}
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={() => onOpenModal(story)} className="dashboard-button-primary">
              <FileText className="h-4 w-4" />
              Visualizar artefato
            </button>
            {stageName === 'requirements' && (
              <button type="button" onClick={() => onAdvance(story)} className="dashboard-button-secondary">
                <Rocket className="h-4 w-4" />
                Avancar para QA
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function BacklogKanban({
  backlogMarkdown,
  projectId: propProjectId,
  stageName = 'requirements',
  agent = 'requirements_analyst',
  title = 'Kanban de Historias',
  subtitle = 'Arraste uma historia para o agente gerar o artefato correspondente.',
  agentColumnTitle = 'Agente de Requisitos',
  contextLabel = 'Projeto',
  processingMessage = 'Gerando artefato...',
  promptInstruction = 'Atue como um Analista de Requisitos Senior. Refine esta historia de usuario gerando uma especificacao tecnica detalhada.',
  predecessorStories = EMPTY_ARRAY,
  onAllStoriesDone = () => {},
  onAdvance = () => {},
  global = false,
}) {
  const { projectId: paramProjectId } = useParams();
  const projectId = propProjectId || paramProjectId;
  const [stories, setStories] = useState([]);
  const [draggedStory, setDraggedStory] = useState(null);
  const [processingStoryId, setProcessingStoryId] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState({ title: '', content: '', priority: 'MEDIUM' });
  const [syncError, setSyncError] = useState(null);
  const [sortMode, setSortMode] = useState('suggested');

  const isMockMode = projectId?.startsWith('mock-proj-');
  const isPersistentStage = !isMockMode && (stageName === 'requirements' || stageName === 'qa');

  async function loadStoriesFromApi() {
    if (global) {
      const tasks = await listAllTasks();
      setStories(mapTasksToStories(tasks, stageName));
      return;
    }

    if (!projectId) return;

    await ensurePipelineProject({ projectUuid: projectId, idea: backlogMarkdown || title });
    await importBacklogTasks(projectId, backlogMarkdown || '');
    const tasks = await listProjectTasks(projectId);
    setStories(mapTasksToStories(tasks, stageName));
  }

  useEffect(() => {
    let active = true;

    async function initializeStories() {
      setSyncError(null);

      if (!isPersistentStage) {
        let extractedStories = parseBacklogLines(backlogMarkdown);
        if (stageName === 'qa' && predecessorStories?.length > 0) {
          extractedStories = extractedStories
            .map((story) => {
              const match = predecessorStories.find(
                (item) => item.id === story.id || item.text.trim() === story.text.trim()
              );
              return {
                ...story,
                isReady: !!(match && match.status === 'done' && match.requirement),
                predecessorRequirement: match?.requirement || null,
              };
            })
            .filter((story) => story.isReady);
        }
        if (active) setStories(extractedStories);
        return;
      }

      try {
        await loadStoriesFromApi();
      } catch (error) {
        if (!active) return;
        setSyncError(getApiErrorMessage(error, 'Não foi poss?vel carregar o kanban do banco.'));
        setStories([]);
      }
    }

    initializeStories();

    return () => {
      active = false;
    };
  }, [backlogMarkdown, global, isPersistentStage, predecessorStories, projectId, stageName, title]);

  const processing = Boolean(processingStoryId);

  const handleDragStart = (event, story) => {
    setDraggedStory(story);
    event.dataTransfer.setData('text/plain', story.id);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    if (!draggedStory || processing) return;

    const storyId = draggedStory.id;
    setProcessingStoryId(storyId);
    setDraggedStory(null);
    setStories((prev) => prev.map((story) => (story.id === storyId ?{ ...story, status: 'processing' } : story)));

    try {
      let backlogPayload = `Historia de Usuario:\n${draggedStory.text}`;
      const inheritedRequirement = draggedStory.predecessorRequirement;
      if (inheritedRequirement) {
        backlogPayload += `\n\nREQUISITOS TECNICOS ESTRUTURADOS:\n${inheritedRequirement}`;
      }

      const payloadData = {
        project_id: projectId,
        idea: promptInstruction,
        backlog: backlogPayload,
      };

      if (isPersistentStage) {
        payloadData.task_uuid = storyId;
      }

      if (agent === 'qa_engineer') {
        payloadData.code = backlogPayload;
        payloadData.developer_output = { code: backlogPayload };
      }

      const response = await apiClient.post('/agents/run', {
        agent,
        payload: payloadData,
      });

      const result = response.data.data || response.data;
      const content = typeof result === 'string' ?result : JSON.stringify(result);

      if (isPersistentStage) {
        await createTaskArtifact(storyId, {
          artifactType: stageName === 'requirements' ?'requirements' : 'qa_validation_cases',
          title: stageName === 'requirements' ?`Requisitos - ${draggedStory.text}` : `Casos de validação - ${draggedStory.text}`,
          content,
          createdByAgentName: agent,
          contentFormat: 'markdown',
        });
        await loadStoriesFromApi();
      } else {
        setStories((prev) =>
          prev.map((story) =>
            story.id === storyId ?{ ...story, status: 'done', requirement: content } : story
          )
        );
      }
    } catch (error) {
      setStories((prev) => prev.map((story) => (story.id === storyId ?{ ...story, status: 'todo' } : story)));
      setSyncError(getApiErrorMessage(error, 'Erro ao processar a historia com o agente.'));
    } finally {
      setProcessingStoryId(null);
    }
  };

  const handleOpenModal = (story) => {
    setModalContent({
      title: story.text,
      content: story.requirement || story.predecessorRequirement || '',
      priority: story.priority || 'MEDIUM',
    });
    setIsModalOpen(true);
  };

  const handleSyncToQA = (story) => {
    if (
      window.confirm(
        `Deseja avancar imediatamente para o QA com este requisito?\n\n"${story.text.substring(0, 40)}..."\n\nAs outras historias pendentes ficarao para depois.`
      )
    ) {
      onAdvance(story);
    }
  };

  const sortedStories = [...stories].sort((left, right) => compareStories(left, right, sortMode));
  const todoStories = sortedStories.filter((story) => story.status === 'todo');
  const processedStories = sortedStories.filter((story) => story.status === 'done' || story.status === 'processing');
  const allStoriesProcessed = stories.length > 0 && todoStories.length === 0;
  const priority = PRIORITY_STYLE[modalContent.priority] || PRIORITY_STYLE.MEDIUM;

  return (
    <div className="space-y-6">
      <motion.section {...fade()} className="dashboard-panel">
        <div className="dashboard-panel-header">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#102a72]">Board do {contextLabel}</p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{title}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{subtitle}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="dashboard-badge bg-white text-slate-600">
                <span>Ordenar por</span>
                <select
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value)}
                  className="ml-2 bg-transparent text-xs font-semibold outline-none"
                >
                  {Object.entries(SORT_OPTIONS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <span className="dashboard-badge bg-slate-100 text-slate-600">
                <ClipboardCheck className="h-3.5 w-3.5" />
                {stories.length} itens
              </span>
              <span className="dashboard-badge bg-emerald-50 text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {processedStories.length} processados
              </span>
            </div>
          </div>
        </div>
      </motion.section>

      {syncError && (
        <motion.div {...fade(0.04)} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {syncError}
          </div>
        </motion.div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <motion.section {...fade(0.08)} className="dashboard-panel">
          <div className="dashboard-panel-header">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Backlog disponível</h3>
                <p className="mt-1 text-xs text-slate-500">{todoStories.length} historias aguardando processamento</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#102a72]/10 text-[#102a72]">
                <FileText className="h-4.5 w-4.5" />
              </div>
            </div>
          </div>

          <div className="space-y-4 p-4">
            {allStoriesProcessed ?(
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
                <h4 className="mt-4 text-base font-semibold text-emerald-900">Fluxo concluido</h4>
                <p className="mt-2 text-sm text-emerald-700">Todas as historias desta etapa foram processadas.</p>
                <button type="button" onClick={onAllStoriesDone} className="dashboard-button-primary mt-5">
                  Continuar fluxo
                </button>
              </div>
            ) : (
              <div className="max-h-[720px] space-y-3 overflow-y-auto pr-1">
                {todoStories.map((story, index) => (
                  <StoryCard
                    key={story.id}
                    story={story}
                    canDrag={!processing && story.isReady}
                    onDragStart={handleDragStart}
                    onOpenModal={handleOpenModal}
                    index={index}
                  />
                ))}
              </div>
            )}
          </div>
        </motion.section>

        <motion.section
          {...fade(0.12)}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`dashboard-panel min-h-[520px] transition-all ${
            processing ?'ring-2 ring-[#102a72]/10' : ''
          }`}
        >
          <div className="dashboard-panel-header">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                  <Rocket className="h-4.5 w-4.5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{agentColumnTitle}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {processing ?'O agente esta processando uma historia agora.' : 'Arraste uma historia para iniciar.'}
                  </p>
                </div>
              </div>
              {processing && <span className="dashboard-badge bg-blue-50 text-blue-700">Em execução</span>}
            </div>
          </div>

          <div className="space-y-4 p-4">
            {!processedStories.length && !processing && (
              <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-center">
                <div className="max-w-sm px-6">
                  <Rocket className="mx-auto h-10 w-10 text-slate-300" />
                  <h4 className="mt-4 text-base font-semibold text-slate-800">Zona de processamento</h4>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Use o mesmo fluxo visual do Dashboard: cards limpos, ação direta e feedback claro por etapa.
                  </p>
                </div>
              </div>
            )}

            <AnimatePresence>
              {processedStories.map((story) => (
                <ProcessedCard
                  key={story.id}
                  story={story}
                  stageName={stageName}
                  processingMessage={processingMessage}
                  onOpenModal={handleOpenModal}
                  onAdvance={handleSyncToQA}
                />
              ))}
            </AnimatePresence>
          </div>
        </motion.section>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
            onClick={() => setIsModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
                <div className="min-w-0">
                  <div className={`dashboard-badge ${priority.badge}`}>
                    <span className={`h-2 w-2 rounded-full ${priority.dot}`} />
                    Prioridade {priority.label}
                  </div>
                  <h3 className="mt-3 text-xl font-bold text-slate-900">{modalContent.title}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(modalContent.content || '')}
                    className="dashboard-button-secondary px-3"
                    title="Copiar conteudo"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="dashboard-button-secondary px-3"
                    title="Fechar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto bg-slate-50 p-6">
                <div className="dashboard-surface p-6">
                  <div className="prose prose-slate max-w-none">
                    <ReactMarkdown>{modalContent.content || '*Aguardando geracao do conteudo pelo agente...*'}</ReactMarkdown>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
