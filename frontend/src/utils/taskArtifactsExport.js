function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(value = '') {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function renderMarkdown(content = '') {
  const html = [];
  let list = [];
  const flushList = () => {
    if (!list.length) return;
    html.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`);
    list = [];
  };

  for (const raw of String(content || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) { flushList(); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length + 2, 6);
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) { list.push(bullet[1]); continue; }
    const field = line.match(/^([^:]{2,48}):\s+(.+)$/);
    if (field) {
      flushList();
      html.push(`<div class="field"><span>${renderInline(field[1])}</span><p>${renderInline(field[2])}</p></div>`);
      continue;
    }
    flushList();
    html.push(`<p>${renderInline(line)}</p>`);
  }
  flushList();
  return html.join('') || '<p class="muted">Nenhum conteúdo disponível.</p>';
}

function artifactLabel(type = '') {
  const labels = {
    requirements: 'Requisitos refinados',
    qa_validation_cases: 'Casos de validação',
    test_plan: 'Casos de validação',
    architecture: 'Arquitetura',
    review: 'Revisão',
  };
  return labels[type] || 'Artefato';
}

function exportableArtifacts(task) {
  return (task?.artifacts || [])
    .filter((artifact) => artifact.isCurrent && !artifact.title?.startsWith('[SYSTEM]') && artifact.content)
    // Revisões de readiness registram o processo interno; não são entrega da task.
    .filter((artifact) => ['requirements', 'qa_validation_cases', 'test_plan', 'architecture'].includes(artifact.artifactType));
}

function buildTaskDocument(task) {
  const artifacts = exportableArtifacts(task);
  const status = task?.status || '—';
  const projectName = task?.project?.name || 'Projeto';
  const sections = artifacts.map((artifact) => `
    <section class="artifact">
      <div class="artifact-header"><span>${escapeHtml(artifactLabel(artifact.artifactType))}</span><small>Versão ${escapeHtml(artifact.version || 1)} · ${artifact.isApproved ? 'Aprovado' : 'Pendente de aprovação'}</small></div>
      <h2>${escapeHtml(artifact.title || artifactLabel(artifact.artifactType))}</h2>
      <div class="artifact-content">${renderMarkdown(artifact.content)}</div>
    </section>
  `).join('');

  return `<!doctype html>
  <html lang="pt-BR"><head><meta charset="utf-8" /><title>${escapeHtml(task?.title || 'Task')} - artefatos</title>
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; } body { margin: 0; color: #172033; font-family: Arial, sans-serif; background: #fff; }
    .cover { border-radius: 18px; padding: 34px; color: #fff; background: linear-gradient(135deg,#071b4b,#17429c 68%,#3972e6); }
    .eyebrow { margin: 0 0 9px; color: #bfdbfe; font-size: 10px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 28px; line-height: 1.18; letter-spacing: -.03em; } h2 { margin: 0 0 12px; font-size: 19px; line-height: 1.3; } h3,h4,h5 { color: #102f73; }
    .cover p { max-width: 680px; margin: 14px 0 0; line-height: 1.6; color: #e5edff; }
    .meta { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 22px; }.pill { border: 1px solid rgba(255,255,255,.24); border-radius: 999px; padding: 6px 10px; background: rgba(255,255,255,.1); font-size: 11px; }
    .section-title { margin: 30px 0 10px; font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: #2854ad; }
    .artifact { margin-top: 16px; border: 1px solid #dbe4f0; border-radius: 14px; padding: 18px; break-inside: avoid; }.artifact-header { display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom:12px; }.artifact-header span { border-radius:999px; padding:4px 9px; background:#eaf1ff; color:#1745a0; font-size:10px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }.artifact-header small { color:#64748b; font-size:11px; }
    .artifact-content { border-left: 3px solid #c7d7fa; padding-left: 16px; }.artifact-content p { margin: 7px 0; font-size: 13px; line-height: 1.6; }.artifact-content ul { margin: 9px 0; padding-left: 22px; }.artifact-content li { margin: 5px 0; font-size:13px; line-height:1.5; }.artifact-content h3:first-child,.artifact-content h4:first-child { margin-top: 0; }
    .field { display:grid; grid-template-columns:150px 1fr; gap:12px; border-top:1px solid #edf2f7; padding:9px 0; font-size:13px; }.field span { color:#475569; font-weight:700; }.field p { margin:0; }.muted { color:#64748b; }.footer { margin-top:28px; padding-top:14px; border-top:1px solid #e2e8f0; color:#64748b; font-size:11px; }
    @media print { .no-print { display:none; } } @media (max-width:680px) { .field { grid-template-columns:1fr; gap:2px; } }
  </style></head><body>
    <main><section class="cover"><p class="eyebrow">Dossiê de artefatos · ${escapeHtml(projectName)}</p><h1>${escapeHtml(task?.title || 'Task')}</h1>${task?.description ? `<p>${escapeHtml(task.description)}</p>` : ''}<div class="meta"><span class="pill">Status: ${escapeHtml(status)}</span><span class="pill">${artifacts.length} artefato(s) incluído(s)</span><span class="pill">Gerado em ${new Date().toLocaleString('pt-BR')}</span></div></section><p class="section-title">Documentação da task</p>${sections || '<p class="muted">Não há artefatos exportáveis nesta task.</p>'}<p class="footer">Documento gerado pela AI Software Factory. As versões e os estados exibidos refletem o momento da exportação.</p></main>
    <script>window.addEventListener('load',()=>setTimeout(()=>{window.focus();window.print();},450));</script>
  </body></html>`;
}

export function exportTaskArtifactsPdf(task) {
  const printWindow = window.open('about:blank', '_blank');
  if (!printWindow) throw new Error('Não foi possível abrir a janela de exportação. Verifique o bloqueio de pop-ups.');
  const html = buildTaskDocument(task);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  printWindow.location.replace(url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
