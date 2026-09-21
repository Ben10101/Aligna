import { getProjectDocumentationBundle } from '../services/api';

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('pt-BR');
}

function renderInline(value = '') {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function renderArtifactMarkdown(content = '') {
  const lines = String(content || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let listItems = [];
  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`);
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length + 2, 6);
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    const listItem = line.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      listItems.push(listItem[1]);
      continue;
    }
    const field = line.match(/^([^:]{2,48}):\s+(.+)$/);
    if (field) {
      flushList();
      blocks.push(`<div class="artifact-field"><span>${renderInline(field[1])}</span><p>${renderInline(field[2])}</p></div>`);
      continue;
    }
    flushList();
    blocks.push(`<p>${renderInline(line)}</p>`);
  }
  flushList();
  return blocks.join('') || '<p class="muted">Sem conteúdo registrado.</p>';
}

function artifactBlock(title, content) {
  if (!content) return '';
  return `
    <section class="artifact-block">
      <div class="artifact-title"><span>Artefato</span><h3>${escapeHtml(title)}</h3></div>
      <div class="artifact-content">${renderArtifactMarkdown(content)}</div>
    </section>
  `;
}

function buildDocumentationHtml(bundle) {
  const epics = bundle.tasks.filter((task) => task.taskType === 'epic');
  const stories = bundle.tasks.filter((task) => task.taskType === 'story');
  const technicalTasks = bundle.tasks.filter((task) => task.taskType === 'task');

  const storySections = stories
    .map((task, index) => {
      const requirements = task.artifacts.find((artifact) => artifact.artifactType === 'requirements');
      const testPlan = task.artifacts.find((artifact) => ['qa_validation_cases', 'test_plan'].includes(artifact.artifactType));

      return `
        <section class="story-card">
          <div class="story-head">
            <div>
              <p class="eyebrow">Story ${index + 1}</p>
              <h2>${escapeHtml(task.title)}</h2>
            </div>
            <div class="story-meta">
              <span>${escapeHtml(task.status || '-')}</span>
              <span>${escapeHtml(task.priority || '-')}</span>
            </div>
          </div>
          ${task.description ? `<p class="story-description">${escapeHtml(task.description)}</p>` : ''}
          ${artifactBlock('Requisitos refinados', requirements?.content || '')}
          ${artifactBlock('Casos de validação', testPlan?.content || '')}
        </section>
      `;
    })
    .join('');

  const simpleList = (items) =>
    items.length
      ? `<ul>${items.map((item) => `<li>${escapeHtml(item.title)}</li>`).join('')}</ul>`
      : '<p class="muted">Nenhum item registrado.</p>';

  return `<!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(bundle.project.name)} - documentação</title>
      <style>
        @page { size: A4; margin: 18mm; }
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; background: white; }
        .container { max-width: 1024px; margin: 0 auto; }
        .hero { border-radius: 18px; padding: 34px; color: #fff; background: linear-gradient(135deg, #071b4b, #123685 65%, #2556b9); box-shadow: 0 16px 32px rgba(15, 43, 104, .16); }
        .eyebrow { margin: 0 0 8px; font-size: 10px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; color: #3972e6; }
        .hero .eyebrow { color: #bfdbfe; }
        h1 { margin: 0; font-size: 32px; line-height: 1.15; letter-spacing: -.03em; }
        h2 { margin: 0 0 10px; font-size: 22px; letter-spacing: -.02em; }
        h3 { margin: 0; font-size: 16px; }
        p { line-height: 1.65; }
        .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 24px; }
        .stat { border: 1px solid rgba(255,255,255,.2); border-radius: 12px; padding: 14px; background: rgba(255,255,255,.1); }
        .stat strong { display: block; font-size: 22px; margin-top: 6px; }
        .section { margin-top: 32px; }
        .artifact-block, .story-card, .panel { border: 1px solid #dbe4f0; border-radius: 14px; padding: 18px; margin-top: 16px; background: #fff; break-inside: avoid; }
        .artifact-title { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
        .artifact-title span { border-radius: 999px; padding: 4px 9px; background: #eaf1ff; color: #1745a0; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
        .artifact-content { border-left: 3px solid #c7d7fa; padding-left: 16px; }
        .artifact-content h3, .artifact-content h4, .artifact-content h5 { margin: 18px 0 8px; color: #102f73; }
        .artifact-content h3:first-child, .artifact-content h4:first-child { margin-top: 0; }
        .artifact-content p { margin: 7px 0; font-size: 13px; }
        .artifact-content ul { margin: 10px 0; }
        .artifact-field { display: grid; grid-template-columns: 150px 1fr; gap: 12px; border-top: 1px solid #edf2f7; padding: 9px 0; font-size: 13px; }
        .artifact-field span { color: #475569; font-weight: 700; }
        .artifact-field p { margin: 0; }
        .story-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
        .story-meta { display: flex; gap: 8px; flex-wrap: wrap; }
        .story-meta span { border: 1px solid #cbd5e1; border-radius: 999px; padding: 4px 10px; font-size: 11px; text-transform: uppercase; }
        .story-description { margin-top: 12px; }
        ul { margin: 8px 0 0; padding-left: 22px; }
        li { margin: 6px 0; line-height: 1.5; }
        .muted { color: #64748b; }
        .footer { margin-top: 30px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; }
        @media (max-width: 680px) { .grid { grid-template-columns: repeat(2, 1fr); } .artifact-field { grid-template-columns: 1fr; gap: 2px; } }
        @media print { .print-note { display: none; } }
      </style>
      <script>
        window.addEventListener('load', () => {
          setTimeout(() => {
            window.focus();
            window.print();
          }, 500);
        });
      </script>
    </head>
    <body>
      <div class="container">
        <div class="hero">
          <p class="eyebrow">Dossiê de Engenharia de Requisitos & QA</p>
          <h1>${escapeHtml(bundle.project.name)}</h1>
          <p>${escapeHtml(bundle.project.description || 'Sem descrição consolidada.')}</p>
          <p><strong>Visão:</strong> ${escapeHtml(bundle.project.vision || 'Não informada.')}</p>
          <p class="muted">Gerado em ${escapeHtml(formatDateTime(bundle.generatedAt))}</p>
          <div class="grid">
            <div class="stat">Tasks<strong>${bundle.summary.totalTasks}</strong></div>
            <div class="stat">Stories<strong>${bundle.summary.totalStories}</strong></div>
            <div class="stat">Refinadas<strong>${bundle.summary.refinedStories}</strong></div>
            <div class="stat">Com QA<strong>${bundle.summary.storiesWithTestPlan}</strong></div>
          </div>
        </div>

        <section class="section panel">
          <p class="eyebrow">Estrutura</p>
          <h2>Mapa do projeto</h2>
          <div><strong>Epics</strong>${simpleList(epics)}</div>
          <div style="margin-top: 16px;"><strong>Tarefas técnicas</strong>${simpleList(technicalTasks)}</div>
        </section>

        ${bundle.backlogArtifact?.content ? `
          <section class="section">
            <p class="eyebrow">Backlog</p>
            ${artifactBlock(bundle.backlogArtifact.title || 'Backlog consolidado', bundle.backlogArtifact.content)}
          </section>
        ` : ''}

        ${bundle.architectureArtifact?.content ? `
          <section class="section">
            <p class="eyebrow">Arquitetura</p>
            ${artifactBlock(bundle.architectureArtifact.title || 'Arquitetura do projeto', bundle.architectureArtifact.content)}
          </section>
        ` : ''}

        <section class="section">
          <p class="eyebrow">Stories</p>
          <h2>Requisitos e QA por história</h2>
          ${storySections || '<p class="muted">Nenhuma story encontrada.</p>'}
        </section>

        <p class="footer print-note">Use “Salvar como PDF” na janela de impressão do navegador.</p>
      </div>
    </body>
  </html>`;
}

export async function exportProjectDocumentationPdf(projectUuid) {
  const printWindow = window.open('about:blank', '_blank');

  if (!printWindow) {
    throw new Error('Não foi possível abrir a janela de impressão do navegador.');
  }

  printWindow.document.open();
  printWindow.document.write(`
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <title>Preparando documentação...</title>
        <style>
          body { font-family: Arial, sans-serif; color: #0f172a; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; background: #f8fafc; }
          .box { border: 1px solid #cbd5e1; border-radius: 16px; background: white; padding: 24px 28px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
          h1 { margin: 0 0 8px; font-size: 20px; }
          p { margin: 0; color: #475569; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>Preparando documentação</h1>
          <p>Aguarde enquanto o PDF é montado.</p>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();

  try {
    const bundle = await getProjectDocumentationBundle(projectUuid);
    const html = buildDocumentationHtml(bundle);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    printWindow.location.replace(objectUrl);
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 60_000);
  } catch (error) {
    printWindow.close();
    throw error;
  }
}
