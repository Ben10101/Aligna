function escapeHtml(value = '') {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function asText(value) { return String(value || '').trim(); }

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('pt-BR');
}

function criteriaFor(story) {
  const context = story?.refinementContext || story?.refinement_context || {};
  const criteria = context.acceptanceCriteria || context.acceptance_criteria || story?.acceptanceCriteria || story?.acceptance_criteria || [];
  if (!Array.isArray(criteria) || !criteria.length) return '';
  const items = criteria.map((criterion, index) => {
    if (typeof criterion === 'string') return `<li>${escapeHtml(criterion)}</li>`;
    const given = asText(criterion?.given); const when = asText(criterion?.when); const then = asText(criterion?.then);
    if (!given && !when && !then) return '';
    return `<li><strong>Cenário ${index + 1}</strong><br /><b>Dado:</b> ${escapeHtml(given || '—')}<br /><b>Quando:</b> ${escapeHtml(when || '—')}<br /><b>Então:</b> ${escapeHtml(then || '—')}</li>`;
  }).filter(Boolean);
  return items.length ? `<section class="criteria"><h3>Critérios de aceite</h3><ul>${items.join('')}</ul></section>` : '';
}

export function buildPublishedBacklogStoriesDocument(project, stories, publishedAt) {
  const projectName = asText(project?.name) || 'Projeto';
  const storyCards = (Array.isArray(stories) ? stories : []).map((story, index) => {
    const id = asText(story?.id) || `US-${index + 1}`; const title = asText(story?.title || story?.goal) || 'Story sem título';
    const description = asText(story?.description || story?.benefit); const actor = asText(story?.actor); const benefit = asText(story?.benefit);
    return `<section class="story-card"><header class="story-head"><div><p class="eyebrow">${escapeHtml(id)}</p><h2>${escapeHtml(title)}</h2></div><span class="pill">Publicada</span></header>${description ? `<p class="description">${escapeHtml(description)}</p>` : '<p class="description muted">Sem descrição disponível.</p>'}<dl>${actor ? `<div><dt>Ator</dt><dd>${escapeHtml(actor)}</dd></div>` : ''}${benefit && benefit !== description ? `<div><dt>Benefício</dt><dd>${escapeHtml(benefit)}</dd></div>` : ''}</dl>${criteriaFor(story)}</section>`;
  }).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>User Stories publicadas — ${escapeHtml(projectName)}</title><style>
    @page { size: A4; margin: 16mm; } * { box-sizing: border-box; } body { margin: 0; color: #172033; font-family: Arial, sans-serif; background: #fff; }.cover { border-radius: 18px; padding: 34px; color: #fff; background: linear-gradient(135deg,#071b4b,#17429c 68%,#3972e6); }.eyebrow { margin: 0 0 9px; color: #bfdbfe; font-size: 10px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; } h1 { margin: 0; font-size: 28px; line-height: 1.18; letter-spacing: -.03em; }.cover p { margin: 14px 0 0; color: #e5edff; line-height: 1.6; }.meta { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 22px; }.pill { border: 1px solid rgba(255,255,255,.24); border-radius: 999px; padding: 6px 10px; background: rgba(255,255,255,.1); font-size: 11px; font-weight: 700; }.section-title { margin: 30px 0 10px; color: #2854ad; font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
    .story-card { margin-top: 16px; border: 1px solid #dbe4f0; border-radius: 14px; padding: 18px; break-inside: avoid; }.story-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }.story-head .eyebrow { color: #2854ad; margin-bottom: 5px; }.story-head h2 { margin: 0; font-size: 19px; line-height: 1.3; }.story-head .pill { border-color: #b7e3c8; background: #ecfdf3; color: #187a43; white-space: nowrap; }.description { margin: 14px 0; color: #334155; font-size: 13px; line-height: 1.6; white-space: pre-wrap; }.muted { color: #64748b; } dl { display: grid; gap: 8px; margin: 14px 0 0; } dl div { display: grid; grid-template-columns: 115px 1fr; gap: 12px; border-top: 1px solid #edf2f7; padding-top: 9px; font-size: 13px; } dt { color: #475569; font-weight: 700; } dd { margin: 0; }.criteria { margin-top: 17px; border-left: 3px solid #c7d7fa; padding-left: 16px; }.criteria h3 { margin: 0 0 9px; color: #102f73; font-size: 14px; }.criteria ul { margin: 0; padding-left: 20px; }.criteria li { margin: 8px 0; font-size: 13px; line-height: 1.55; }.footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 11px; } @media print { .print-note { display: none; } }
  </style></head><body><main><section class="cover"><p class="eyebrow">Backlog publicado · ${escapeHtml(projectName)}</p><h1>User Stories</h1><p>Documento consolidado das stories aprovadas e publicadas no board.</p><div class="meta"><span class="pill">${Array.isArray(stories) ? stories.length : 0} story(s)</span><span class="pill">Publicado em: ${escapeHtml(formatDateTime(publishedAt))}</span><span class="pill">Gerado em: ${escapeHtml(new Date().toLocaleString('pt-BR'))}</span></div></section><p class="section-title">Stories publicadas</p>${storyCards || '<p class="muted">Nenhuma story publicada.</p>'}<p class="footer print-note">Documento gerado pela AI Software Factory. Use “Salvar como PDF” na janela de impressão.</p></main><script>window.addEventListener('load',()=>setTimeout(()=>{window.focus();window.print();},450));</script></body></html>`;
}

export function exportPublishedBacklogStoriesPdf(project, stories, publishedAt) {
  const printWindow = window.open('about:blank', '_blank');
  if (!printWindow) throw new Error('Não foi possível abrir a janela de exportação. Verifique o bloqueio de pop-ups.');
  const url = URL.createObjectURL(new Blob([buildPublishedBacklogStoriesDocument(project, stories, publishedAt)], { type: 'text/html;charset=utf-8' }));
  printWindow.location.replace(url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
