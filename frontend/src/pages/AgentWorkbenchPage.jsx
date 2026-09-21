import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowRight,
  Bot,
  Copy,
  History,
  Play,
  RefreshCcw,
  RotateCcw,
  Sparkles,
  FileText,
  ShieldCheck,
  ListChecks,
  Upload,
} from 'lucide-react';
import AppShell from '../components/AppShell';
import {
  getApiErrorMessage,
  getRequirementModels,
  getWorkbenchArtifacts,
  importRequirementModelFile,
  runAgent,
  updateRequirementModels,
} from '../services/api';
import { getAgentLabel } from '../utils/agentLabels';

const HISTORY_KEY = 'agent_workbench_history_v1';
const MAX_HISTORY_ITEMS = 6;

const AGENT_MODES = [
  {
    value: 'project_manager',
    runnerAgent: 'project_manager',
    shortLabel: 'PM',
    title: 'Refino de produto',
    description: 'Use o PM para transformar direção de negócio em backlog, épicos, riscos e próximos passos.',
    accent: 'from-emerald-500/15 to-emerald-500/5 border-emerald-200 text-emerald-800',
    chip: 'bg-emerald-50 text-emerald-700',
    icon: FileText,
    prompt:
      'Atue como Product Manager senior. A partir da story abaixo, refine a oportunidade em backlog acionável, priorize o que importa, explicite riscos, dependências e próximos passos. Responda em Markdown, com seções claras e listas objetivas.',
    contextLabel: 'Contexto de produto',
    contextPlaceholder:
      'Descreva visão, problema, público, restrições, metas de negócio, dores do usuário ou qualquer informação de apoio.',
    examples: [
      'Transformar essa ideia em backlog priorizado com épicos e riscos.',
      'Refinar este pedido em visão de produto com próximas decisões.',
    ],
    payloadHint: 'Ideal para abrir o trabalho e organizar o que precisa acontecer depois.',
  },
  {
    value: 'project_manager_single_story',
    runnerAgent: 'project_manager',
    shortLabel: 'PM+',
    title: 'PM Story única',
    description: 'Use esse modo para refinar somente uma user story, sem abrir espaço para múltiplas histórias no retorno.',
    accent: 'from-emerald-500/15 to-emerald-500/5 border-emerald-200 text-emerald-800',
    chip: 'bg-emerald-50 text-emerald-700',
    icon: FileText,
    prompt:
      'Atue como Product Manager senior. Refine somente a user story informada abaixo. Não crie novas user stories, não divida em várias histórias e não amplie o escopo. Se houver múltiplas histórias misturadas, selecione apenas a principal que foi colada e ignore o restante. Responda em Markdown com uma única história refinada, backlog acionável, riscos, dependências e próximos passos.',
    contextLabel: 'Contexto da story',
    contextPlaceholder:
      'Cole a user story exata que você quer refinar. Se precisar, adicione apenas contexto de apoio que ajude a entender a mesma story.',
    examples: [
      'Refinar somente esta user story, sem criar outras.',
      'Pegar esta única story e devolver backlog, riscos e próximos passos.',
    ],
    payloadHint: 'Ideal quando você quer precisão em uma única story, sem expansão para várias.',
  },
  {
    value: 'requirements_analyst',
    shortLabel: 'REQ',
    title: 'Refino de requisitos',
    description: 'Use o Analista de Requisitos para detalhar histórias, critérios de aceite, regras e fluxos.',
    accent: 'from-sky-500/15 to-sky-500/5 border-sky-200 text-sky-800',
    chip: 'bg-sky-50 text-sky-700',
    icon: ListChecks,
    prompt:
      'Atue como Analista de Requisitos. A partir do material abaixo, refaça a necessidade com clareza funcional, critérios de aceite, regras de negócio, fluxos principal/alternativos/exceção e pontos de ambiguidade. Responda em Markdown detalhado.',
    contextLabel: 'Base de requisitos',
    contextPlaceholder:
      'Cole a user story, backlog, observações de refinamento, regras já existentes ou qualquer texto que ajude a fechar o requisito.',
    examples: [
      'Refinar esta user story em critérios de aceite e regras de negócio.',
      'Converter esse backlog em requisito mais claro e testável.',
    ],
    payloadHint: 'Ideal para sair com uma história fechada e pronta para validar com QA.',
  },
  {
    value: 'qa_engineer',
    shortLabel: 'QA',
    title: 'Refino de QA',
    description: 'Use o QA para gerar estratégia de teste, cenários, casos funcionais e riscos de qualidade.',
    accent: 'from-amber-500/15 to-amber-500/5 border-amber-200 text-amber-800',
    chip: 'bg-amber-50 text-amber-700',
    icon: ShieldCheck,
    prompt:
      'Atue como Engenheiro de QA senior. A partir do material abaixo, produza um plano de testes completo com estratégia, dados de teste, métricas, cenários, casos funcionais, qualidade não funcional, usabilidade e acessibilidade. Responda em Markdown profissional e crítico.',
    contextLabel: 'Base de QA',
    contextPlaceholder:
      'Cole requisitos, resumo técnico, código, fluxos, observações de risco ou qualquer contexto necessário para planejar os testes.',
    examples: [
      'Criar um plano de testes completo a partir destes requisitos.',
      'Gerar cenários funcionais e riscos de qualidade para esta tarefa.',
    ],
    payloadHint: 'Ideal para transformar requisito em cobertura de teste prática.',
  },
];

function loadHistory() {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatOutput(output) {
  if (typeof output === 'string') return output;
  if (output == null) return '';
  return `\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\``;
}

function sanitizeTemplateText(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

function composeRequirementModelBlock(model, prompt, context) {
  const parts = [];
  if (model?.name) {
    parts.push(`Nome do modelo: ${model.name}`);
  }
  if (model?.content) {
    parts.push(`Estrutura do documento:\n${sanitizeTemplateText(model.content)}`);
  }
  if (prompt.trim()) {
    parts.push(`Story atual:\n${prompt.trim()}`);
  }
  if (context.trim()) {
    parts.push(`Contexto adicional:\n${context.trim()}`);
  }

  return parts.join('\n\n---\n\n');
}

function buildPayload({ agent, prompt, context, projectId, requirementModel }) {
  const payload = {
    agent_focus: agent,
    idea: prompt.trim(),
    request_mode: 'freeform_workbench',
    project_context: {
      mode: agent,
      briefing: prompt.trim(),
      context: context.trim() || null,
      requirementModelName: requirementModel?.name || null,
    },
  };

  if (projectId.trim()) {
    payload.project_id = projectId.trim();
  }

  const normalizedContext = context.trim();
  if (normalizedContext) {
    payload.context = normalizedContext;
  }

  if (agent === 'requirements_analyst') {
    payload.backlog = composeRequirementModelBlock(requirementModel, prompt, normalizedContext) || prompt.trim();
    payload.project_context = {
      ...payload.project_context,
      requirement_document_model: requirementModel?.content || null,
      requirement_document_name: requirementModel?.name || null,
    };
  }

  if (agent === 'qa_engineer') {
    const sourceText = composeRequirementModelBlock(requirementModel, prompt, normalizedContext) || prompt.trim();
    payload.developer_output = { code: sourceText };
    payload.requirement_spec = requirementModel?.content || normalizedContext || prompt.trim();
    payload.code_structure = sourceText;
    payload.project_context = {
      ...payload.project_context,
      requirement_document_model: requirementModel?.content || null,
      requirement_document_name: requirementModel?.name || null,
    };
  }

  return payload;
}

function ModeCard({ mode, active, onClick }) {
  const Icon = mode.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`group rounded-3xl border px-5 py-5 text-left transition-all duration-150 ${
        active
          ? `bg-gradient-to-br ${mode.accent} shadow-sm`
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`inline-flex rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.28em] ${mode.chip}`}>
            {mode.shortLabel}
          </div>
          <h3 className="mt-3 text-lg font-bold text-slate-900">{mode.title}</h3>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${active ? 'bg-white/70' : 'bg-slate-100 text-slate-600'}`}>
          <Icon className="h-5 w-5" strokeWidth={2} />
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{mode.description}</p>
    </button>
  );
}

function HistoryItem({ item, onRestore }) {
  return (
    <button
      type="button"
      onClick={onRestore}
      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left transition hover:border-[#102a72]/20 hover:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{item.agentLabel}</p>
          <p className="mt-1 truncate text-sm font-semibold text-slate-900">{item.storyPreview}</p>
        </div>
        <History className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={2} />
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        {new Date(item.timestamp).toLocaleString('pt-BR')}
        {item.projectId ? ` · ${item.projectId}` : ''}
      </p>
    </button>
  );
}

function RequirementModelModal({
  open,
  onClose,
  loading,
  importLoading,
  notice,
  error,
  requirementModelName,
  onRequirementModelNameChange,
  requirementModelDraft,
  onRequirementModelDraftChange,
  onImportFile,
  onSave,
  requirementModels,
  activeRequirementModelId,
  onApply,
  onRemove,
}) {
  const modalRef = useRef(null);
  const nameInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTarget = nameInputRef.current || modalRef.current;

    window.requestAnimationFrame(() => {
      focusTarget?.focus?.();
    });

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusableSelector = [
        'button:not([disabled])',
        'input:not([disabled])',
        'textarea:not([disabled])',
        'select:not([disabled])',
        'a[href]',
        '[tabindex]:not([tabindex="-1"])',
      ].join(', ');
      const focusableElements = Array.from(modalRef.current?.querySelectorAll(focusableSelector) || []).filter(
        (element) => element instanceof HTMLElement
      );

      if (!focusableElements.length) return;

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus?.();
      previousFocusRef.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="requirement-model-modal-title"
        tabIndex={-1}
        className="w-full max-w-3xl overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#102a72]">Modelo de requisito</p>
              <h3 id="requirement-model-modal-title" className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                Gerenciar modelos salvos
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Os modelos ficam salvos no banco da sua conta e podem ser reutilizados em qualquer rodada da bancada.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Fechar
            </button>
          </div>
        </div>

        <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-6 py-5">
          <div className="space-y-4">
            {loading ? (
              <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-[#102a72]">
                Carregando modelos salvos na sua conta...
              </div>
            ) : null}
            {notice ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
                {notice}
              </div>
            ) : null}
            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
                {error}
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-[1fr_0.95fr]">
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Nome do modelo
                  </label>
                  <input
                    ref={nameInputRef}
                    value={requirementModelName}
                    onChange={(event) => onRequirementModelNameChange(event.target.value)}
                    placeholder="Ex.: Requisito de cadastro com validações"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#102a72]/40 focus:bg-white focus:ring-2 focus:ring-[#102a72]/10"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Importar modelo
                  </label>
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={onImportFile}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click?.()}
                      disabled={loading || importLoading}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Upload className="h-4 w-4" strokeWidth={2.2} />
                      {importLoading ? 'Importando arquivo...' : 'Enviar PDF ou DOCX'}
                    </button>
                    <p className="mt-3 text-xs leading-5 text-slate-500">
                      O arquivo preenche a estrutura do documento para voce revisar e salvar como modelo reutilizavel.
                    </p>
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Estrutura do documento
                  </label>
                  <textarea
                    value={requirementModelDraft}
                    onChange={(event) => onRequirementModelDraftChange(event.target.value)}
                    placeholder={`## User Story Refinada\n\n## Requisitos Funcionais\n\n## Fluxo Principal\n\n## Regras de Negocio\n\n## Criterios de Aceite (BDD)`}
                    className="min-h-[220px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#102a72]/40 focus:bg-white focus:ring-2 focus:ring-[#102a72]/10"
                  />
                </div>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={loading || importLoading}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#102a72] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c205a] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Sparkles className="h-4 w-4" strokeWidth={2.2} />
                  Salvar modelo
                </button>
              </div>

              <div className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#102a72]">Modelos salvos</p>
                    <p className="mt-1 text-sm text-slate-500">Toque em um item para ativar e reutilizar a estrutura.</p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                    {requirementModels.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {requirementModels.length ? (
                    requirementModels.map((model) => (
                      <div
                        key={model.id}
                        className={`rounded-2xl border px-4 py-3 ${
                          activeRequirementModelId === model.id
                            ? 'border-[#102a72]/30 bg-[#102a72]/5'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => onApply(model)}
                            disabled={loading}
                            className="min-w-0 text-left disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <p className="truncate text-sm font-semibold text-slate-900">{model.name}</p>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                              {model.content.slice(0, 120)}
                            </p>
                            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                              Salvo na conta
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemove(model.id)}
                            disabled={loading}
                            className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
                      Nenhum modelo salvo ainda. Salve uma estrutura de documento para reutilizar nos próximos refinamentos.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultModal({ open, onClose, result, copyState, onCopy, onReuse, onSendToQa, formatOutput, loading }) {
  const modalRef = useRef(null);
  const closeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTarget = closeButtonRef.current || modalRef.current;

    window.requestAnimationFrame(() => {
      focusTarget?.focus?.();
    });

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusableSelector = [
        'button:not([disabled])',
        'input:not([disabled])',
        'textarea:not([disabled])',
        'select:not([disabled])',
        'a[href]',
        '[tabindex]:not([tabindex="-1"])',
      ].join(', ');
      const focusableElements = Array.from(modalRef.current?.querySelectorAll(focusableSelector) || []).filter(
        (element) => element instanceof HTMLElement
      );

      if (!focusableElements.length) return;

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus?.();
      previousFocusRef.current = null;
    };
  }, [open, onClose]);

  if (!open || !result) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-modal-title"
        tabIndex={-1}
        className="w-full max-w-5xl overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-6 py-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#102a72]">Resultado</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="result-modal-title" className="text-2xl font-bold tracking-tight text-slate-900">Saida do agente</h2>
              <p className="mt-2 text-sm text-slate-500">
                {getAgentLabel(result.agent)} · {new Date(result.timestamp).toLocaleString('pt-BR')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                {result.projectId ? `Project ID: ${result.projectId}` : 'Artefato livre sem projeto'}
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <Copy className="h-4 w-4" strokeWidth={2.2} />
              {copyState === 'copied' ? 'Copiado' : copyState === 'failed' ? 'Falha ao copiar' : 'Copiar saida'}
            </button>
            <button
              type="button"
              onClick={onReuse}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <RefreshCcw className="h-4 w-4" strokeWidth={2.2} />
              Reusar como story
            </button>
            {result.agent === 'requirements_analyst' ? (
              <button
                type="button"
                onClick={onSendToQa}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl bg-[#102a72] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0c205a] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ArrowRight className="h-4 w-4" strokeWidth={2.2} />
                {loading ? 'Enviando para QA...' : 'Enviar para QA'}
              </button>
            ) : null}
          </div>
        </div>
        <div className="max-h-[calc(100vh-12rem)] overflow-y-auto p-6">
          <div className="prose prose-slate max-w-none rounded-3xl border border-slate-200 bg-slate-50 px-5 py-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{formatOutput(result.output)}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AgentWorkbenchPage() {
  const [selectedAgent, setSelectedAgent] = useState('requirements_analyst');
  const [storyText, setStoryText] = useState('');
  const [context, setContext] = useState('');
  const [projectId, setProjectId] = useState('');
  const [requirementModels, setRequirementModels] = useState([]);
  const [requirementModelName, setRequirementModelName] = useState('');
  const [requirementModelDraft, setRequirementModelDraft] = useState('');
  const [activeRequirementModelId, setActiveRequirementModelId] = useState('');
  const [isRequirementModelModalOpen, setIsRequirementModelModalOpen] = useState(false);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const [savedWorkbenchArtifacts, setSavedWorkbenchArtifacts] = useState([]);
  const [savedWorkbenchArtifactsLoading, setSavedWorkbenchArtifactsLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsActionPending, setModelsActionPending] = useState(false);
  const [modelImportPending, setModelImportPending] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelsNotice, setModelsNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(() => loadHistory());
  const [copyState, setCopyState] = useState('idle');

  const currentMode = useMemo(
    () => AGENT_MODES.find((mode) => mode.value === selectedAgent) || AGENT_MODES[0],
    [selectedAgent]
  );

  const suggestedPrompt = currentMode.prompt;
  const activeRequirementModel = useMemo(
    () => requirementModels.find((model) => model.id === activeRequirementModelId) || null,
    [activeRequirementModelId, requirementModels]
  );
  const requirementModelSource = requirementModelDraft.trim()
    ? {
        name: requirementModelName.trim() || activeRequirementModel?.name || 'Modelo sem nome',
        content: requirementModelDraft.trim(),
      }
    : activeRequirementModel;

  useEffect(() => {
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)));
    } catch {
      // Ignore localStorage failures.
    }
  }, [history]);

  useEffect(() => {
    let active = true;

    async function loadRequirementModelsFromServer() {
      try {
        setModelsLoading(true);
        setModelsError('');
        const response = await getRequirementModels();
        if (!active) return;

        setRequirementModels(Array.isArray(response?.models) ? response.models : []);
        setActiveRequirementModelId(String(response?.activeModelId || '').trim());
        setModelsNotice('Modelos carregados da sua conta e prontos para reutilizacao.');
      } catch (loadError) {
        if (!active) return;
        setRequirementModels([]);
        setActiveRequirementModelId('');
        setModelsError(getApiErrorMessage(loadError, 'Nao foi possivel carregar os modelos de requisito.'));
        setModelsNotice('');
      } finally {
        if (active) {
          setModelsLoading(false);
        }
      }
    }

    loadRequirementModelsFromServer();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadWorkbenchArtifactsFromServer() {
      try {
        setSavedWorkbenchArtifactsLoading(true);
        const response = await getWorkbenchArtifacts();
        if (!active) return;
        setSavedWorkbenchArtifacts(Array.isArray(response?.artifacts) ? response.artifacts : []);
      } catch {
        if (!active) return;
        setSavedWorkbenchArtifacts([]);
      } finally {
        if (active) {
          setSavedWorkbenchArtifactsLoading(false);
        }
      }
    }

    loadWorkbenchArtifactsFromServer();

    return () => {
      active = false;
    };
  }, []);

  async function persistRequirementModels(nextModels, nextActiveModelId) {
    const response = await updateRequirementModels({
      models: nextModels,
      activeModelId: nextActiveModelId,
    });

    setRequirementModels(Array.isArray(response?.models) ? response.models : nextModels);
    setActiveRequirementModelId(String(response?.activeModelId || '').trim());
    setModelsNotice('Alteracoes salvas no banco da sua conta.');
  }

  function handleLoadExample(example) {
    setStoryText(example);
    setError('');
  }

  function handleReset() {
    setStoryText('');
    setContext('');
    setProjectId('');
    setError('');
    setModelsError('');
    setModelsNotice('');
    setResult(null);
    setIsResultModalOpen(false);
    setCopyState('idle');
  }

  function handleSaveRequirementModel() {
    const content = sanitizeTemplateText(requirementModelDraft);
    const name = sanitizeTemplateText(requirementModelName) || `Modelo ${requirementModels.length + 1}`;

    if (!content) {
      setModelsError('Escreva a estrutura do documento antes de salvar o modelo.');
      return;
    }

    setModelsError('');
    setModelsNotice('');
    setModelsActionPending(true);
    const nextModel = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      content,
      createdAt: new Date().toISOString(),
    };

    const nextModels = [nextModel, ...requirementModels].slice(0, 20);
    persistRequirementModels(nextModels, nextModel.id)
      .then(() => {
        setActiveRequirementModelId(nextModel.id);
        setRequirementModelName(nextModel.name);
        setRequirementModelDraft(nextModel.content);
        setModelsNotice('Modelo salvo no banco e pronto para reutilizacao em outros refinamentos.');
      })
      .catch((saveError) => {
        setModelsError(getApiErrorMessage(saveError, 'Nao foi possivel salvar o modelo de requisito.'));
      })
      .finally(() => {
        setModelsActionPending(false);
      });
  }

  async function handleImportRequirementModelFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setModelsError('');
    setModelsNotice('');
    setModelImportPending(true);

    try {
      const importedModel = await importRequirementModelFile(file);
      setRequirementModelName(importedModel?.name || file.name.replace(/\.[^.]+$/, ''));
      setRequirementModelDraft(importedModel?.content || '');
      setModelsNotice(
        importedModel?.truncated
          ? 'Arquivo importado com sucesso. O conteudo foi reduzido para caber no limite do modelo salvo.'
          : 'Arquivo importado com sucesso. Revise o conteudo e salve o modelo se quiser reutilizar depois.'
      );
    } catch (importError) {
      setModelsError(getApiErrorMessage(importError, 'Nao foi possivel importar o arquivo do modelo.'));
    } finally {
      setModelImportPending(false);
    }
  }

  function handleApplyRequirementModel(model) {
    if (!model) return;
    setModelsError('');
    setModelsNotice('');
    setModelsActionPending(true);

    const previousState = {
      selectedAgent,
      requirementModelName,
      requirementModelDraft,
      storyText,
      context,
      activeRequirementModelId,
    };

    setSelectedAgent('requirements_analyst');
    setRequirementModelName(model.name);
    setRequirementModelDraft(model.content);
    setStoryText(`Refine o documento abaixo seguindo a estrutura salva: ${model.name}`);
    setContext(model.content);

    persistRequirementModels(requirementModels, model.id)
      .then(() => {
        setModelsNotice(`Modelo "${model.name}" ativado a partir dos dados salvos na conta.`);
      })
      .catch((applyError) => {
        setSelectedAgent(previousState.selectedAgent);
        setRequirementModelName(previousState.requirementModelName);
        setRequirementModelDraft(previousState.requirementModelDraft);
        setStoryText(previousState.storyText);
        setContext(previousState.context);
        setActiveRequirementModelId(previousState.activeRequirementModelId);
        setModelsError(getApiErrorMessage(applyError, 'Nao foi possivel ativar o modelo selecionado.'));
      })
      .finally(() => {
        setModelsActionPending(false);
      });
  }

  function handleRemoveRequirementModel(modelId) {
    const nextModels = requirementModels.filter((model) => model.id !== modelId);
    const nextActiveModelId = activeRequirementModelId === modelId ? '' : activeRequirementModelId;

    setModelsError('');
    setModelsNotice('');
    setModelsActionPending(true);

    const previousState = {
      requirementModels,
      activeRequirementModelId,
      requirementModelName,
      requirementModelDraft,
    };

    persistRequirementModels(nextModels, nextActiveModelId)
      .then(() => {
        setModelsNotice('Modelo removido da conta.');
      })
      .catch((removeError) => {
        setRequirementModels(previousState.requirementModels);
        setActiveRequirementModelId(previousState.activeRequirementModelId);
        setRequirementModelName(previousState.requirementModelName);
        setRequirementModelDraft(previousState.requirementModelDraft);
        setModelsError(getApiErrorMessage(removeError, 'Nao foi possivel remover o modelo.'));
      })
      .finally(() => {
        setModelsActionPending(false);
      });

    if (activeRequirementModelId === modelId) {
      setRequirementModelDraft('');
      setRequirementModelName('');
    }
  }

  function handleRestoreHistory(item) {
    setSelectedAgent(item.agent);
    setStoryText(item.story || item.briefing || '');
    setContext(item.context || '');
    setProjectId(item.projectId || '');
    const restoredOutput = item.result || item.output || null;
    setResult(
      restoredOutput
        ? {
            projectId: item.projectId || '',
            output: restoredOutput,
            agent: item.agent,
            timestamp: item.timestamp || new Date().toISOString(),
          }
        : null
    );
    setIsResultModalOpen(Boolean(restoredOutput));
    setError('');
    setCopyState('idle');
  }

  function handleUseResultAsStory() {
    if (!result?.output) return;
    setStoryText(formatOutput(result.output));
    setError('');
  }

  async function handleCopyResult() {
    if (!result?.output) return;

    const textToCopy = formatOutput(result.output);

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    } finally {
      window.setTimeout(() => setCopyState('idle'), 1800);
    }
  }

  async function executeWorkbenchRun({
    modeValue,
    prompt,
    contextValue,
    projectIdValue,
    requirementModel,
  }) {
    if (!prompt) {
      setError('Escreva uma story antes de executar o agente.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const targetMode = AGENT_MODES.find((mode) => mode.value === modeValue) || currentMode;
      const runnerAgent = targetMode?.runnerAgent || modeValue;

      const response = await runAgent({
        agent: runnerAgent,
        payload: buildPayload({
          agent: modeValue,
          prompt,
          context: contextValue,
          projectId: projectIdValue,
          requirementModel,
        }),
      });
      const normalizedResult = response?.data ?? null;
      const nextProjectId = response?.project_id || projectIdValue.trim();
      const timestamp = new Date().toISOString();

      if (!projectIdValue.trim() && response?.project_id) {
        setProjectId(response.project_id);
      }

      const historyItem = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        agent: modeValue,
        agentLabel: getAgentLabel(modeValue),
        story: prompt,
        context: contextValue.trim(),
        projectId: nextProjectId,
        storyPreview: prompt.slice(0, 120),
        result: normalizedResult,
        timestamp,
      };
      const savedArtifactItem = {
        id: historyItem.id,
        agent: modeValue,
        story: prompt,
        context: contextValue.trim(),
        projectId: response?.project_id || '',
        storyPreview: prompt.slice(0, 120),
        output: normalizedResult,
        timestamp,
      };

      setResult({
        projectId: response?.project_id || nextProjectId || '',
        output: normalizedResult,
        agent: modeValue,
        timestamp,
      });
      setIsResultModalOpen(true);
      setHistory((current) => [historyItem, ...current].slice(0, MAX_HISTORY_ITEMS));
      if (!response?.project_id) {
        setSavedWorkbenchArtifacts((current) => [savedArtifactItem, ...current].slice(0, 20));
      }
    } catch (agentError) {
      setError(getApiErrorMessage(agentError, 'Não foi possível executar o agente livre.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleRun() {
    await executeWorkbenchRun({
      modeValue: selectedAgent,
      prompt: storyText.trim(),
      contextValue: context,
      projectIdValue: projectId,
      requirementModel: requirementModelSource,
    });
  }

  async function handleSendResultToQa() {
    if (!result?.output) return;

    const qaPrompt = storyText.trim() || 'Avalie este refinamento de requisitos e gere o plano de QA.';
    const qaContext = typeof result.output === 'string' ? result.output : formatOutput(result.output);

    setSelectedAgent('qa_engineer');
    setStoryText(qaPrompt);
    setContext(qaContext);
    setIsResultModalOpen(false);

    await executeWorkbenchRun({
      modeValue: 'qa_engineer',
      prompt: qaPrompt,
      contextValue: qaContext,
      projectIdValue: projectId,
      requirementModel: null,
    });
  }

  return (
    <AppShell
      eyebrow="Agentes livres"
      title="Bancada de Agentes"
      description="Use PM, Requirements e QA em modo livre para refinar direção de produto, requisitos e cobertura de testes sem seguir um fluxo fechado."
      actions={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleLoadExample(suggestedPrompt)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Sparkles className="h-4 w-4" strokeWidth={2.2} />
            Usar exemplo
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <RotateCcw className="h-4 w-4" strokeWidth={2.2} />
            Limpar bancada
          </button>
        </div>
      }
      sidebar={
        <>
          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm hidden">
            <div className="border-b border-slate-200 px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#102a72]">Como usar</p>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm leading-6 text-slate-600">
              <p>1. Escolha o agente que você quer usar livremente.</p>
              <p>2. Cole a user story ou o contexto e acrescente mais detalhes se precisar.</p>
              <p>3. Rode a rodada e use o `project_id` apenas se quiser continuar a mesma story depois.</p>
            </div>
          </section>

          {false ? (
          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#102a72]">Exemplos rápidos</p>
            </div>
            <div className="space-y-2 px-4 py-4">
              {currentMode.examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => handleLoadExample(example)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs leading-5 text-slate-600 transition hover:border-[#102a72]/20 hover:bg-white hover:text-slate-900"
                >
                  {example}
                </button>
              ))}
            </div>
          </section>
          ) : null}

          <section className="hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#102a72]">Modelo de requisito</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Os modelos ficam salvos no banco da sua conta e podem ser reutilizados em qualquer sessao da bancada.
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              {modelsLoading ? (
                <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-[#102a72]">
                  Carregando modelos salvos na sua conta...
                </div>
              ) : null}
              {modelsNotice ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
                  {modelsNotice}
                </div>
              ) : null}
              {modelsError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
                  {modelsError}
                </div>
              ) : null}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Nome do modelo
                </label>
                <input
                  value={requirementModelName}
                  onChange={(event) => setRequirementModelName(event.target.value)}
                  placeholder="Ex.: Requisito de cadastro com validações"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#102a72]/40 focus:bg-white focus:ring-2 focus:ring-[#102a72]/10"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Estrutura do documento
                </label>
                <textarea
                  value={requirementModelDraft}
                  onChange={(event) => setRequirementModelDraft(event.target.value)}
                  placeholder={`## User Story Refinada\n\n## Requisitos Funcionais\n\n## Fluxo Principal\n\n## Regras de Negocio\n\n## Criterios de Aceite (BDD)`}
                  className="min-h-[160px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#102a72]/40 focus:bg-white focus:ring-2 focus:ring-[#102a72]/10"
                />
              </div>
              <button
                type="button"
                onClick={handleSaveRequirementModel}
                disabled={modelsLoading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#102a72] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c205a] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4" strokeWidth={2.2} />
                Salvar modelo
              </button>

              <div className="space-y-2">
                {requirementModels.length ? (
                  requirementModels.map((model) => (
                    <div
                      key={model.id}
                      className={`rounded-2xl border px-4 py-3 ${
                        activeRequirementModelId === model.id
                          ? 'border-[#102a72]/30 bg-[#102a72]/5'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button type="button" onClick={() => handleApplyRequirementModel(model)} className="min-w-0 text-left">
                          <p className="truncate text-sm font-semibold text-slate-900">{model.name}</p>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                            {model.content.slice(0, 120)}
                          </p>
                          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            Salvo na conta
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveRequirementModel(model.id)}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                    Nenhum modelo salvo ainda. Salve uma estrutura de documento para reutilizar nos próximos refinamentos.
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#102a72]">Últimas execuções</p>
            </div>
            <div className="space-y-3 px-4 py-4">
              {history.length ? (
                history.map((item) => (
                  <HistoryItem key={item.id} item={item} onRestore={() => handleRestoreHistory(item)} />
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  Nenhuma execução ainda. O histórico vai aparecer aqui após o primeiro run.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#102a72]">Refinamentos salvos</p>
            </div>
            <div className="space-y-3 px-4 py-4">
              {savedWorkbenchArtifactsLoading ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  Carregando refinamentos salvos da sua conta...
                </div>
              ) : savedWorkbenchArtifacts.length ? (
                savedWorkbenchArtifacts.map((item) => (
                  <HistoryItem key={item.id} item={item} onRestore={() => handleRestoreHistory(item)} />
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  Nenhum refinamento livre salvo ainda. Os proximos runs sem projeto vao aparecer aqui.
                </div>
              )}
            </div>
          </section>

          {result ? (
            <section className="rounded-3xl border border-emerald-200 bg-emerald-50/70 shadow-sm">
              <div className="border-b border-emerald-200 px-5 py-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-emerald-700">Última saída</p>
              </div>
              <div className="space-y-3 px-5 py-4 text-sm leading-6 text-emerald-900">
                <p className="font-semibold">{getAgentLabel(result.agent)}</p>
                <p className="text-emerald-800/80">
                  Resultado pronto para copiar ou usar como base de uma nova rodada da mesma story.
                </p>
                {activeRequirementModel ? (
                  <p className="text-xs text-emerald-800/70">
                    Modelo ativo salvo na conta: {activeRequirementModel.name}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={handleUseResultAsStory}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
                >
                  <RefreshCcw className="h-3.5 w-3.5" strokeWidth={2.2} />
                  Reusar como story
                </button>
              </div>
            </section>
          ) : null}
        </>
      }
    >
      <div className="space-y-8">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-[radial-gradient(circle_at_top_right,_rgba(16,42,114,0.12),_transparent_30%),linear-gradient(180deg,_#ffffff_0%,_#f8fafc_100%)] shadow-sm">
          <div className="grid gap-8 px-6 py-6 xl:grid-cols-[1.25fr_0.9fr]">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">
                <Bot className="h-3.5 w-3.5 text-[#102a72]" strokeWidth={2.4} />
                Bancada livre de agentes
              </div>
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-slate-900">Refine user stories, requisitos e QA sem amarrar isso a um projeto.</h2>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                  Essa bancada serve para pegar uma story ou ideia solta e passar pelos agentes de forma rápida, com contexto opcional e continuidade apenas quando fizer sentido.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  { label: '1. Escolha', value: 'PM, REQ ou QA' },
                  { label: '2. Escreva', value: 'User story + contexto' },
                  { label: '3. Execute', value: 'Saída pronta para lapidar' },
                ].map((step) => (
                  <div key={step.label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#102a72]">{step.label}</p>
                    <p className="mt-2 text-sm font-semibold text-slate-800">{step.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#102a72]">Modo ativo</p>
              <div className="mt-3 flex items-start gap-4">
                <div className={`flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br ${currentMode.accent}`}>
                  <currentMode.icon className="h-6 w-6" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xl font-bold text-slate-900">{currentMode.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{currentMode.description}</p>
                </div>
              </div>
              <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                <span className="font-semibold text-slate-900">Saída esperada:</span> {currentMode.payloadHint}
              </div>
              <button
                type="button"
                onClick={() => handleLoadExample(currentMode.prompt)}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#102a72] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c205a]"
              >
                <ArrowRight className="h-4 w-4" strokeWidth={2.2} />
            Usar exemplo
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          {AGENT_MODES.filter((mode) => ['requirements_analyst', 'qa_engineer'].includes(mode.value)).map((mode) => (
            <ModeCard
              key={mode.value}
              mode={mode}
              active={mode.value === selectedAgent}
              onClick={() => setSelectedAgent(mode.value)}
            />
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
          <div className="space-y-6">
            <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-6 py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#102a72]">Entrada livre</p>
                    <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{currentMode.title}</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{currentMode.payloadHint}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                    {getAgentLabel(selectedAgent)}
                  </span>
                </div>
              </div>

              <div className="space-y-5 p-6">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">User story ou contexto</label>
                  <textarea
                    value={storyText}
                    onChange={(event) => setStoryText(event.target.value)}
                    placeholder={suggestedPrompt}
                    className="min-h-[220px] w-full rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm leading-7 text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#102a72]/40 focus:bg-white focus:ring-2 focus:ring-[#102a72]/10"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-[1fr_260px]">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">{currentMode.contextLabel}</label>
                    <textarea
                      value={context}
                      onChange={(event) => setContext(event.target.value)}
                      placeholder={currentMode.contextPlaceholder}
                      className="min-h-[170px] w-full rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm leading-7 text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#102a72]/40 focus:bg-white focus:ring-2 focus:ring-[#102a72]/10"
                    />
                  </div>

                  <div className="space-y-4">
                    <details className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <summary className="cursor-pointer list-none text-sm font-semibold text-slate-700">
                        Continuidade opcional
                      </summary>
                      <div className="mt-4">
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Project UUID opcional
                        </label>
                        <input
                          value={projectId}
                          onChange={(event) => setProjectId(event.target.value)}
                          placeholder="uuid do projeto"
                          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#102a72]/40 focus:bg-white focus:ring-2 focus:ring-[#102a72]/10"
                        />
                        <p className="mt-2 text-xs leading-5 text-slate-500">
                          Deixe em branco para começar uma rodada independente. Preencha só se quiser continuar a mesma story depois.
                        </p>
                      </div>
                    </details>

                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#102a72]">O que este modo ajuda</p>
                      <p className="mt-3 text-sm leading-6 text-slate-600">{currentMode.description}</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleRun}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-2xl bg-[#102a72] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0c205a] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Play className="h-4 w-4" strokeWidth={2.2} />
                    {loading ? 'Executando...' : 'Executar agente'}
                  </button>
                  <button
                    type="button"
                  onClick={handleUseResultAsStory}
                    disabled={!result?.output}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCcw className="h-4 w-4" strokeWidth={2.2} />
                    Reusar saída
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <RotateCcw className="h-4 w-4" strokeWidth={2.2} />
                    Limpar campos
                  </button>
                </div>

                {loading ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-[#102a72]">
                    Executando o agente. A resposta pode levar alguns segundos dependendo do contexto.
                  </div>
                ) : null}

                {error ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
                    {error}
                  </div>
                ) : null}
              </div>
            </div>

            {result ? (
              <section className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-6 py-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#102a72]">Resultado</p>
                  <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight text-slate-900">Saída do agente</h2>
                      <p className="mt-2 text-sm text-slate-500">
                        {getAgentLabel(result.agent)} · {new Date(result.timestamp).toLocaleString('pt-BR')}
                      </p>
                    </div>
                    <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      {result.projectId ? `Project ID: ${result.projectId}` : 'Projeto criado automaticamente'}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleCopyResult}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <Copy className="h-4 w-4" strokeWidth={2.2} />
                      {copyState === 'copied' ? 'Copiado' : copyState === 'failed' ? 'Falha ao copiar' : 'Copiar saída'}
                    </button>
                    <button
                      type="button"
                      onClick={handleUseResultAsStory}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <RefreshCcw className="h-4 w-4" strokeWidth={2.2} />
                      Reusar como story
                    </button>
                  </div>
                </div>
                <div className="p-6">
                  <div className="prose prose-slate max-w-none rounded-3xl border border-slate-200 bg-slate-50 px-5 py-5">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{formatOutput(result.output)}</ReactMarkdown>
                  </div>
                </div>
              </section>
            ) : (
              <section className="rounded-[28px] border border-dashed border-slate-200 bg-white/70 p-6 text-sm text-slate-500 shadow-sm">
                Execute um agente para ver a saída renderizada aqui. A bancada foi desenhada para refinar uma ideia por vez, sem bloquear a experimentação.
              </section>
            )}
          </div>

          <aside className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#102a72]">Modo selecionado</p>
              </div>
              <div className="space-y-4 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#102a72]/10 text-[#102a72]">
                    <Bot className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{getAgentLabel(selectedAgent)}</p>
                    <p className="text-xs text-slate-500">{currentMode.title}</p>
                  </div>
                </div>
                <p className="text-sm leading-6 text-slate-600">{currentMode.description}</p>
                <button
                  type="button"
                  onClick={() => setIsRequirementModelModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <Sparkles className="h-4 w-4" strokeWidth={2.2} />
                  Abrir editor de modelo
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#102a72]">Dica prática</p>
              </div>
              <div className="space-y-3 px-5 py-4 text-sm leading-6 text-slate-600">
                <p>• Para refino de PM, cole a oportunidade e as restrições do produto.</p>
                <p>• Para requisitos, cole a story e qualquer regra já acordada.</p>
                <p>• Para QA, cole requisitos, fluxos ou código de referência para ampliar a cobertura.</p>
              </div>
            </section>
          </aside>
        </section>
      </div>

      <RequirementModelModal
        open={isRequirementModelModalOpen}
        onClose={() => setIsRequirementModelModalOpen(false)}
        loading={modelsLoading || modelsActionPending}
        importLoading={modelImportPending}
        notice={modelsNotice}
        error={modelsError}
        requirementModelName={requirementModelName}
        onRequirementModelNameChange={setRequirementModelName}
        requirementModelDraft={requirementModelDraft}
        onRequirementModelDraftChange={setRequirementModelDraft}
        onImportFile={handleImportRequirementModelFile}
        onSave={handleSaveRequirementModel}
        requirementModels={requirementModels}
        activeRequirementModelId={activeRequirementModelId}
        onApply={handleApplyRequirementModel}
        onRemove={handleRemoveRequirementModel}
      />
      <ResultModal
        open={isResultModalOpen}
        onClose={() => setIsResultModalOpen(false)}
        result={result}
        copyState={copyState}
        onCopy={handleCopyResult}
        onReuse={handleUseResultAsStory}
        onSendToQa={handleSendResultToQa}
        formatOutput={formatOutput}
        loading={loading}
      />
    </AppShell>
  );
}
