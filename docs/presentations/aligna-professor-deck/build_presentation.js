const path = require("path");
const PptxGenJS = require("../aligna-commercial-deck/node_modules/pptxgenjs");
const {
  imageSizingContain,
} = require("./pptxgenjs_helpers/image");
const {
  warnIfSlideHasOverlaps,
  warnIfSlideElementsOutOfBounds,
} = require("./pptxgenjs_helpers/layout");

const OUT_DIR = __dirname;
const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "OpenAI Codex";
pptx.company = "AI Software Factory";
pptx.subject = "Apresentacao academica do produto Aligna";
pptx.title = "Aligna - Plataforma AI-assisted para alinhamento e preparacao de software";
pptx.lang = "pt-BR";
pptx.theme = {
  headFontFace: "Arial",
  bodyFontFace: "Arial",
  lang: "pt-BR",
};

const COLORS = {
  navy: "0F172A",
  blue: "1D4ED8",
  teal: "0F766E",
  amber: "B45309",
  slate: "475569",
  ink: "111827",
  white: "FFFFFF",
  soft: "F8FAFC",
  line: "D9E2EC",
  mint: "ECFDF5",
  ice: "EFF6FF",
  sand: "FFF7ED",
  violet: "6D28D9",
};

const SCREENSHOTS = {
  auth: path.resolve(__dirname, "../../screenshots/auth-page.png"),
  project: path.resolve(__dirname, "../../screenshots/project-overview.png"),
  board: path.resolve(__dirname, "../../screenshots/projects-board.png"),
  ai: path.resolve(__dirname, "../../screenshots/ai-governance.png"),
};

function calcTextBoxHeightSimple(fontSize, lines = 1, leading = 1.15, padding = 0.3) {
  const lineHeightIn = (fontSize / 72) * leading;
  return lines * lineHeightIn + padding;
}

function addBg(slide, color = COLORS.white) {
  slide.background = { color };
}

function addHeaderBand(slide, title, kicker) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.6,
    line: { color: COLORS.navy, transparency: 100 },
    fill: { color: COLORS.navy },
  });
  slide.addText(kicker, {
    x: 0.55,
    y: 0.2,
    w: 3.2,
    h: 0.18,
    fontFace: "Arial",
    fontSize: 11,
    bold: true,
    color: "D1FAE5",
    charSpace: 1.5,
  });
  slide.addText(title, {
    x: 0.55,
    y: 0.82,
    w: 8.9,
    h: 0.45,
    fontFace: "Arial",
    fontSize: 24,
    bold: true,
    color: COLORS.ink,
  });
}

function addFooter(slide, page) {
  slide.addText(`Aligna | apresentacao academica | ${page}`, {
    x: 0.55,
    y: 7.06,
    w: 4.0,
    h: 0.16,
    fontFace: "Arial",
    fontSize: 9,
    color: "64748B",
  });
}

function addBullets(slide, items, x, y, w, opts = {}) {
  const fontSize = opts.fontSize || 17;
  const lineGap = opts.lineGap || 1.18;
  const runs = [];
  items.forEach((item) => {
    runs.push({
      text: item,
      options: {
        bullet: { indent: 16 },
        breakLine: true,
      },
    });
  });
  slide.addText(runs, {
    x,
    y,
    w,
    h: calcTextBoxHeightSimple(fontSize, items.length * 2.1, lineGap, 0.06),
    fontFace: "Arial",
    fontSize,
    color: COLORS.slate,
    breakLine: false,
    margin: 0,
    paraSpaceAfterPt: 10,
    valign: "top",
  });
}

function addStatCard(slide, x, y, w, h, label, value, fill, accent = COLORS.blue) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    line: { color: COLORS.line, pt: 1.2 },
    fill: { color: fill },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: x + 0.18,
    y: y + 0.18,
    w: 0.08,
    h: h - 0.36,
    line: { color: accent, transparency: 100 },
    fill: { color: accent },
  });
  slide.addText(label, {
    x: x + 0.38,
    y: y + 0.18,
    w: w - 0.55,
    h: 0.18,
    fontFace: "Arial",
    fontSize: 10,
    bold: true,
    color: "64748B",
    charSpace: 1.1,
  });
  slide.addText(value, {
    x: x + 0.38,
    y: y + 0.44,
    w: w - 0.55,
    h: 0.34,
    fontFace: "Arial",
    fontSize: 22,
    bold: true,
    color: COLORS.ink,
  });
}

function addPanel(slide, x, y, w, h, title, body, fill = COLORS.white) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    line: { color: COLORS.line, pt: 1.1 },
    fill: { color: fill },
  });
  slide.addText(title, {
    x: x + 0.24,
    y: y + 0.2,
    w: w - 0.48,
    h: 0.22,
    fontFace: "Arial",
    fontSize: 14,
    bold: true,
    color: COLORS.ink,
  });
  if (Array.isArray(body)) {
    addBullets(slide, body, x + 0.22, y + 0.55, w - 0.4, { fontSize: 13, lineGap: 1.1 });
  } else {
    slide.addText(body, {
      x: x + 0.24,
      y: y + 0.55,
      w: w - 0.48,
      h: h - 0.7,
      fontFace: "Arial",
      fontSize: 13,
      color: COLORS.slate,
      valign: "top",
      margin: 0,
    });
  }
}

function addImageCard(slide, x, y, w, h, label, imagePath) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    line: { color: COLORS.line, pt: 1.1 },
    fill: { color: COLORS.white },
  });
  slide.addImage({
    path: imagePath,
    ...imageSizingContain(imagePath, x + 0.12, y + 0.12, w - 0.24, h - 0.46),
  });
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y: y + h - 0.34,
    w,
    h: 0.34,
    line: { color: COLORS.line, transparency: 100 },
    fill: { color: "F8FAFC" },
  });
  slide.addText(label, {
    x: x + 0.14,
    y: y + h - 0.23,
    w: w - 0.28,
    h: 0.12,
    fontFace: "Arial",
    fontSize: 10,
    bold: true,
    color: COLORS.ink,
  });
}

function finalizeSlide(slide, page) {
  addFooter(slide, page);
  warnIfSlideHasOverlaps(slide, pptx);
  warnIfSlideElementsOutOfBounds(slide, pptx);
}

// Slide 1
{
  const slide = pptx.addSlide();
  addBg(slide, COLORS.navy);
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.6,
    y: 0.7,
    w: 2.1,
    h: 0.42,
    rectRadius: 0.08,
    line: { color: "1E293B", transparency: 100 },
    fill: { color: "0B5FFF" },
  });
  slide.addText("AI SOFTWARE FACTORY", {
    x: 0.78,
    y: 0.83,
    w: 1.8,
    h: 0.12,
    fontFace: "Arial",
    fontSize: 10,
    bold: true,
    color: COLORS.white,
    charSpace: 1.4,
  });
  slide.addText("Aligna", {
    x: 0.6,
    y: 1.45,
    w: 4.2,
    h: 0.65,
    fontFace: "Arial",
    fontSize: 28,
    bold: true,
    color: COLORS.white,
  });
  slide.addText("Plataforma AI-assisted para transformar briefing em backlog, requisitos, QA, arquitetura e handoff tecnico governado.", {
    x: 0.6,
    y: 2.15,
    w: 6.3,
    h: 1.0,
    fontFace: "Arial",
    fontSize: 20,
    color: "DCE7F3",
    valign: "mid",
    margin: 0,
  });
  slide.addText("Apresentacao para contexto academico: produto, arquitetura, agentes, governanca e evidencia de evolucao tecnica.", {
    x: 0.6,
    y: 3.45,
    w: 5.7,
    h: 0.5,
    fontFace: "Arial",
    fontSize: 13,
    color: "94A3B8",
  });
  addStatCard(slide, 0.65, 5.1, 2.1, 1.05, "Fluxo central", "Ideia -> codigo", "10223A", "2DD4BF");
  addStatCard(slide, 2.95, 5.1, 2.1, 1.05, "Diferencial", "Gates + agentes", "10223A", "60A5FA");
  addStatCard(slide, 5.25, 5.1, 2.1, 1.05, "Foco", "Menos retrabalho", "10223A", "F59E0B");
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 7.45,
    y: 0.85,
    w: 5.2,
    h: 5.9,
    rectRadius: 0.12,
    line: { color: "334155", pt: 1.1 },
    fill: { color: "0B1220" },
  });
  slide.addImage({
    path: SCREENSHOTS.project,
    ...imageSizingContain(SCREENSHOTS.project, 7.65, 1.08, 4.8, 5.1),
  });
  finalizeSlide(slide, 1);
}

// Slide 2
{
  const slide = pptx.addSlide();
  addBg(slide);
  addHeaderBand(slide, "O problema que o produto resolve", "CONTEXTO");
  slide.addText("Grande parte do retrabalho em software nasce antes do codigo, quando ainda existem ambiguidades sobre o que sera construido.", {
    x: 0.55,
    y: 1.35,
    w: 7.2,
    h: 0.55,
    fontFace: "Arial",
    fontSize: 19,
    color: COLORS.ink,
    bold: true,
  });
  addPanel(slide, 0.55, 2.0, 4.0, 3.8, "Sintomas comuns", [
    "requisitos vagos e criterios de aceite incompletos",
    "desalinhamento entre produto, engenharia e QA",
    "arquitetura iniciada cedo demais",
    "retrabalho caro por descoberta tardia",
    "baixa confianca para iniciar implementacao",
  ], COLORS.soft);
  addPanel(slide, 4.8, 2.0, 4.0, 3.8, "Impactos praticos", [
    "atrasos e correcoes recorrentes",
    "mudancas de interpretacao no meio da entrega",
    "testes chegando tarde ao fluxo",
    "dificuldade de auditar decisoes tecnicas",
    "baixa previsibilidade para squads e software houses",
  ], COLORS.soft);
  addPanel(slide, 9.05, 2.0, 3.7, 3.8, "Hipotese do Aligna", "Se o time ganha um fluxo operacional unico entre briefing, backlog, requisitos, QA e arquitetura, a qualidade do handoff sobe e o retrabalho antes da implementacao cai.", COLORS.ice);
  finalizeSlide(slide, 2);
}

// Slide 3
{
  const slide = pptx.addSlide();
  addBg(slide);
  addHeaderBand(slide, "Proposta de valor", "TESE DO PRODUTO");
  slide.addText("O Aligna organiza o que precisa ficar claro antes da implementacao comecar.", {
    x: 0.55,
    y: 1.42,
    w: 8.0,
    h: 0.4,
    fontFace: "Arial",
    fontSize: 24,
    bold: true,
    color: COLORS.ink,
  });
  slide.addText("Nao e apenas um chat nem apenas um gerador de texto: e uma plataforma com fluxo, persistencia, gates e governanca.", {
    x: 0.55,
    y: 1.95,
    w: 8.4,
    h: 0.35,
    fontFace: "Arial",
    fontSize: 14,
    color: COLORS.slate,
  });
  addStatCard(slide, 0.55, 2.45, 2.9, 1.1, "Entrada", "briefing de produto", COLORS.ice, COLORS.blue);
  addStatCard(slide, 3.62, 2.45, 2.9, 1.1, "Saida", "handoff governado", COLORS.mint, COLORS.teal);
  addStatCard(slide, 6.69, 2.45, 2.9, 1.1, "Valor", "menos ambiguidade", COLORS.sand, COLORS.amber);
  addPanel(slide, 0.55, 3.9, 3.9, 2.55, "O que entrega hoje", [
    "backlog inicial com epicos, stories e tasks",
    "refinamento de requisitos por historia",
    "QA por historia",
    "gate de arquitetura",
    "Code Studio para implementacao",
  ], COLORS.white);
  addPanel(slide, 4.7, 3.9, 3.9, 2.55, "Para quem faz sentido", [
    "software houses",
    "squads de produto",
    "consultorias de tecnologia",
    "operacoes com backlog crescente",
    "times que querem discovery mais governado",
  ], COLORS.white);
  addPanel(slide, 8.85, 3.9, 3.9, 2.55, "Regra central do produto", "IA acelera rascunhos e estrutura. Humanos aprovam o que e critico. Isso posiciona a plataforma como apoio a decisao, nao substituicao cega de julgamento.", COLORS.ice);
  finalizeSlide(slide, 3);
}

// Slide 4
{
  const slide = pptx.addSlide();
  addBg(slide);
  addHeaderBand(slide, "Fluxo operacional ponta a ponta", "WORKFLOW");
  const steps = [
    ["1", "Ideia", COLORS.blue],
    ["2", "Backlog", COLORS.teal],
    ["3", "Requisitos", COLORS.violet],
    ["4", "QA", "DB2777"],
    ["5", "Arquitetura", COLORS.amber],
    ["6", "Implementacao", "0F766E"],
  ];
  steps.forEach(([n, label, color], idx) => {
    const x = 0.7 + idx * 2.05;
    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y: 2.4,
      w: 1.55,
      h: 1.15,
      rectRadius: 0.1,
      line: { color, pt: 1.1 },
      fill: { color: "FFFFFF" },
    });
    slide.addText(n, {
      x: x + 0.16,
      y: 2.67,
      w: 0.28,
      h: 0.24,
      fontFace: "Arial",
      fontSize: 22,
      bold: true,
      color,
    });
    slide.addText(label, {
      x: x + 0.48,
      y: 2.72,
      w: 0.9,
      h: 0.18,
      fontFace: "Arial",
      fontSize: 14,
      bold: true,
      color: COLORS.ink,
    });
    if (idx < steps.length - 1) {
      slide.addShape(pptx.ShapeType.chevron, {
        x: x + 1.62,
        y: 2.74,
        w: 0.34,
        h: 0.28,
        line: { color: "CBD5E1", pt: 1.0 },
        fill: { color: "E2E8F0" },
      });
    }
  });
  addPanel(slide, 0.75, 4.25, 4.0, 1.8, "Logica do produto", "A plataforma obriga clareza progressiva. Cada etapa gera artefatos persistidos, visiveis no board e rastreaveis por projeto e por task.", COLORS.soft);
  addPanel(slide, 4.95, 4.25, 3.9, 1.8, "Gate critico", "A arquitetura so deve avancar quando as historias relevantes ja foram refinadas e receberam QA. Isso reduz aceleracao prematura.", COLORS.soft);
  addPanel(slide, 9.05, 4.25, 3.55, 1.8, "Extensao atual", "O Code Studio transforma o handoff tecnico em plano, impacto, workstreams, review, risco e integracao incremental.", COLORS.ice);
  finalizeSlide(slide, 4);
}

// Slide 5
{
  const slide = pptx.addSlide();
  addBg(slide);
  addHeaderBand(slide, "Superficies do produto", "INTERFACE");
  addImageCard(slide, 0.55, 1.45, 3.0, 2.25, "Autenticacao e workspace", SCREENSHOTS.auth);
  addImageCard(slide, 3.75, 1.45, 3.0, 2.25, "Visao do projeto", SCREENSHOTS.project);
  addImageCard(slide, 6.95, 1.45, 3.0, 2.25, "Board operacional", SCREENSHOTS.board);
  addImageCard(slide, 10.15, 1.45, 2.65, 2.25, "Governanca de IA", SCREENSHOTS.ai);
  addPanel(slide, 0.55, 4.0, 4.0, 2.2, "Interface como processo", [
    "workspace e autenticacao",
    "catalogo de projetos",
    "board com status por task",
    "detalhe da task com artefatos",
    "governanca operacional e de IA",
  ], COLORS.white);
  addPanel(slide, 4.8, 4.0, 4.0, 2.2, "Leitura importante para a banca", [
    "o sistema ja e navegavel",
    "ha persistencia por projeto e historia",
    "as etapas sao observaveis",
    "o produto nao depende de uma unica chamada de IA",
  ], COLORS.white);
  addPanel(slide, 9.05, 4.0, 3.7, 2.2, "Mensagem-chave", "A interface nao existe apenas para exibir texto gerado. Ela estrutura a operacao do fluxo e a transicao entre agentes, gate e implementacao.", COLORS.ice);
  finalizeSlide(slide, 5);
}

// Slide 6
{
  const slide = pptx.addSlide();
  addBg(slide);
  addHeaderBand(slide, "Camada de agentes", "ORQUESTRACAO");
  const agents = [
    ["Project Manager", "gera backlog inicial e organiza epicos, stories e tasks", 0.75, 2.0, COLORS.blue],
    ["Requirements Analyst", "refina fluxos, regras, excecoes e criterios de aceite", 3.45, 2.0, COLORS.teal],
    ["QA Engineer", "gera estrategia, cenarios, dados e casos de teste", 6.15, 2.0, COLORS.violet],
    ["Architect", "define stack, modulos, contratos e arquitetura tecnica", 8.85, 2.0, COLORS.amber],
    ["Developer Backend", "pensa dominio, API, persistencia e contratos", 2.1, 4.25, COLORS.blue],
    ["Developer Frontend", "pensa tela, estados, produto e integracao de UI", 5.05, 4.25, COLORS.teal],
    ["Implementation Review", "faz review, risco, diff e validacao final", 8.0, 4.25, COLORS.violet],
  ];
  agents.forEach(([title, body, x, y, color]) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y,
      w: 2.35,
      h: 1.2,
      rectRadius: 0.08,
      line: { color, pt: 1.1 },
      fill: { color: "FFFFFF" },
    });
    slide.addText(title, {
      x: x + 0.16,
      y: y + 0.18,
      w: 2.0,
      h: 0.22,
      fontFace: "Arial",
      fontSize: 13,
      bold: true,
      color: COLORS.ink,
    });
    slide.addText(body, {
      x: x + 0.16,
      y: y + 0.46,
      w: 2.0,
      h: 0.52,
      fontFace: "Arial",
      fontSize: 10.5,
      color: COLORS.slate,
      valign: "top",
      margin: 0,
    });
  });
  slide.addText("Hoje a camada de implementacao ja evoluiu de um pipeline unico para um fluxo mais senior, com workstreams, lanes, repair por vertente e review por risco.", {
    x: 0.75,
    y: 6.25,
    w: 12.0,
    h: 0.45,
    fontFace: "Arial",
    fontSize: 15,
    color: COLORS.ink,
    bold: true,
  });
  finalizeSlide(slide, 6);
}

// Slide 7
{
  const slide = pptx.addSlide();
  addBg(slide);
  addHeaderBand(slide, "Arquitetura tecnica da plataforma", "ENGINEERING");
  addPanel(slide, 0.7, 1.7, 3.6, 3.7, "Frontend", [
    "React + Vite",
    "pages, componentes e services",
    "board, projetos, governanca, code studio",
    "experiencia de operacao por projeto e por task",
  ], COLORS.ice);
  addPanel(slide, 4.85, 1.7, 3.6, 3.7, "Backend", [
    "Node.js + Express",
    "controllers, routes, services e middleware",
    "persistencia de artefatos, runs e governanca",
    "gate de arquitetura e superficie de implementacao",
  ], COLORS.white);
  addPanel(slide, 9.0, 1.7, 3.6, 3.7, "Processamento", [
    "orquestrador Python",
    "agentes especializados por etapa",
    "runtime multi-provider",
    "fallback e politicas de execucao",
  ], COLORS.sand);
  slide.addShape(pptx.ShapeType.chevron, {
    x: 4.3,
    y: 3.15,
    w: 0.32,
    h: 0.28,
    line: { color: "CBD5E1", pt: 1.0 },
    fill: { color: "CBD5E1" },
  });
  slide.addShape(pptx.ShapeType.chevron, {
    x: 8.45,
    y: 3.15,
    w: 0.32,
    h: 0.28,
    line: { color: "CBD5E1", pt: 1.0 },
    fill: { color: "CBD5E1" },
  });
  addPanel(slide, 0.7, 5.8, 11.9, 0.95, "Leitura para o professor", "A arquitetura separa interface, aplicacao e processamento especializado. Isso facilita manutencao, observabilidade, extensao de agentes e futura evolucao para produto multi-tenant mais robusto.", COLORS.soft);
  finalizeSlide(slide, 7);
}

// Slide 8
{
  const slide = pptx.addSlide();
  addBg(slide);
  addHeaderBand(slide, "Governanca de IA e confiabilidade", "RUNTIME");
  addStatCard(slide, 0.7, 1.5, 2.45, 1.05, "Providers suportados", "7+", COLORS.ice, COLORS.blue);
  addStatCard(slide, 3.4, 1.5, 2.45, 1.05, "Politica", "preferencia + fallback", COLORS.mint, COLORS.teal);
  addStatCard(slide, 6.1, 1.5, 2.45, 1.05, "Objetivo", "continuidade operacional", COLORS.sand, COLORS.amber);
  addStatCard(slide, 8.8, 1.5, 3.0, 1.05, "Governanca", "execucao observavel", "F5F3FF", COLORS.violet);
  addPanel(slide, 0.7, 2.95, 5.65, 3.1, "Capacidades atuais", [
    "provider preferencial configuravel",
    "habilitar e desabilitar providers",
    "modelos locais e remotos",
    "teste de chave e conexao",
    "fallback para continuidade de execucao",
  ], COLORS.white);
  addImageCard(slide, 6.65, 2.95, 5.55, 3.1, "Tela de governanca de IA", SCREENSHOTS.ai);
  slide.addText("Mensagem importante: o produto assume que IA e infraestrutura instavel fazem parte do mundo real. Por isso ha governanca e estrategia de runtime, nao so chamadas ad hoc.", {
    x: 0.7,
    y: 6.35,
    w: 11.5,
    h: 0.38,
    fontFace: "Arial",
    fontSize: 14,
    color: COLORS.ink,
    bold: true,
  });
  finalizeSlide(slide, 8);
}

// Slide 9
{
  const slide = pptx.addSlide();
  addBg(slide);
  addHeaderBand(slide, "Code Studio e handoff tecnico", "IMPLEMENTACAO");
  slide.addText("A camada de implementacao foi evoluida para parecer mais um agente de engenharia de alto nivel do que um simples gerador de codigo.", {
    x: 0.55,
    y: 1.42,
    w: 10.8,
    h: 0.44,
    fontFace: "Arial",
    fontSize: 18,
    bold: true,
    color: COLORS.ink,
  });
  addPanel(slide, 0.55, 1.95, 3.95, 4.4, "O que ja faz hoje", [
    "objetivo explicito de implementacao",
    "impact analysis antes de codar",
    "workstreams e execution phases",
    "review de diff e risco",
    "memoria de projeto e padrões por dominio",
    "lanes de backend, frontend e shared",
  ], COLORS.soft);
  addPanel(slide, 4.7, 1.95, 3.95, 4.4, "Evolucao recente", [
    "developer dividido em backend e frontend",
    "repair scope por vertente",
    "review e observabilidade por lane",
    "execucao paralela backend/frontend quando possivel",
    "product modes para telas",
    "polish e review visual de UI",
  ], COLORS.white);
  addPanel(slide, 8.85, 1.95, 3.95, 4.4, "Por que isso importa", [
    "reduz falso positivo e falhas estruturais",
    "torna a esteira mais previsivel",
    "aproxima o sistema de engenharia assistida real",
    "abre caminho para geracao de produto mais intencional",
  ], COLORS.ice);
  finalizeSlide(slide, 9);
}

// Slide 10
{
  const slide = pptx.addSlide();
  addBg(slide);
  addHeaderBand(slide, "Estudo de caso: Central de Chamados Internos", "DEMONSTRACAO");
  slide.addText("Caso usado para validar a esteira de implementacao e a evolucao visual das interfaces geradas.", {
    x: 0.55,
    y: 1.42,
    w: 9.2,
    h: 0.34,
    fontFace: "Arial",
    fontSize: 17,
    color: COLORS.ink,
    bold: true,
  });
  addPanel(slide, 0.55, 1.85, 3.85, 4.9, "Historias trabalhadas", [
    "abertura de chamado",
    "controle de acesso por perfil",
    "notificacoes por e-mail",
    "anexos e comprovantes",
    "painel gerencial de suporte",
  ], COLORS.white);
  addPanel(slide, 4.65, 1.85, 3.85, 4.9, "Aprendizados tecnicos", [
    "mapeamento semantico de dominio importa muito",
    "review e specialist precisavam evoluir",
    "front vazava contexto tecnico demais",
    "workbenches genericos deixavam tudo parecido",
    "regeneracao com bypass de cache era necessaria",
  ], COLORS.soft);
  addPanel(slide, 8.75, 1.85, 4.0, 4.9, "Resultado para a demonstracao", [
    "pipeline mais robusto",
    "menos contaminacao entre features",
    "telas com menos vazamento de requisitos e QA",
    "base mais limpa para novas geracoes",
    "evidencia concreta de evolucao do produto",
  ], COLORS.ice);
  finalizeSlide(slide, 10);
}

// Slide 11
{
  const slide = pptx.addSlide();
  addBg(slide);
  addHeaderBand(slide, "Diferenciais e contribuicao academica", "ANALISE");
  addPanel(slide, 0.55, 1.45, 4.0, 4.9, "Diferenciais do produto", [
    "nao e apenas texto gerado: ha processo, estado e persistencia",
    "integra backlog, requisitos, QA, arquitetura e implementacao",
    "traz governanca de runtime de IA",
    "permite observabilidade de artefatos e execucoes",
    "usa gates para reduzir aceleracao prematura",
  ], COLORS.white);
  addPanel(slide, 4.8, 1.45, 4.0, 4.9, "Valor academico", [
    "exemplo de sistema sociotecnico com agentes especializados",
    "discute governanca e confiabilidade de IA aplicada",
    "mostra separacao entre automacao e aprovacao humana",
    "permite estudar handoff entre produto e engenharia",
    "serve como caso de evolucao incremental de arquitetura",
  ], COLORS.soft);
  addPanel(slide, 9.05, 1.45, 3.7, 4.9, "Pergunta que o produto ajuda a responder", "Como transformar briefing, refinamento, validacao e implementacao em um fluxo operacional governado, observavel e menos ambiguo usando agentes de IA?", COLORS.ice);
  finalizeSlide(slide, 11);
}

// Slide 12
{
  const slide = pptx.addSlide();
  addBg(slide);
  addHeaderBand(slide, "Status de maturidade do produto", "LEITURA EXECUTIVA");
  slide.addText("Hoje o Aligna ja saiu da fase experimental e entrou em uma fase de produto operacional, mas ainda nao esta em maturidade plena de producao.", {
    x: 0.55,
    y: 1.35,
    w: 10.7,
    h: 0.46,
    fontFace: "Arial",
    fontSize: 19,
    bold: true,
    color: COLORS.ink,
    margin: 0,
  });
  addStatCard(slide, 0.55, 2.0, 2.35, 1.08, "Maturidade geral", "7 / 10", COLORS.ice, COLORS.blue);
  addStatCard(slide, 3.1, 2.0, 2.7, 1.08, "Fabrica de agentes", "forte", COLORS.mint, COLORS.teal);
  addStatCard(slide, 6.0, 2.0, 2.55, 1.08, "Prontidao de producao", "parcial", COLORS.sand, COLORS.amber);
  addStatCard(slide, 8.75, 2.0, 3.05, 1.08, "Principal proximo salto", "convergencia do runtime", "F5F3FF", COLORS.violet);
  addPanel(slide, 0.55, 3.45, 3.9, 2.65, "Forcas atuais", [
    "backlog, requisitos e arquitetura mais maduros",
    "geracao ja guiada por IR e composicao",
    "evals e comparabilidade reais",
    "seguranca basica e governanca mais fortes",
  ], COLORS.white);
  addPanel(slide, 4.7, 3.45, 3.9, 2.65, "Fragilidades atuais", [
    "alguns fluxos ainda exigem reconciliacao manual",
    "readiness de producao ainda nao esta fechado",
    "runtime legado e moderno ainda convivem",
    "generalizacao ainda precisa de mais prova em casos novos",
  ], COLORS.soft);
  addPanel(slide, 8.85, 3.45, 3.95, 2.65, "Leitura executiva", "O produto ja demonstra valor real, fluxo consistente e evolucao arquitetural clara. O risco atual nao e mais viabilidade, e sim robustez operacional para escala e producao.", COLORS.ice);
  slide.addText("Sintese: o Aligna hoje pode ser apresentado como plataforma operacional em maturacao avancada, com base tecnica forte e pendencias concentradas em robustez final de runtime e readiness.", {
    x: 0.7,
    y: 6.42,
    w: 12.0,
    h: 0.35,
    fontFace: "Arial",
    fontSize: 13.5,
    color: COLORS.ink,
    bold: true,
    margin: 0,
  });
  finalizeSlide(slide, 12);
}

// Slide 13
{
  const slide = pptx.addSlide();
  addBg(slide, COLORS.navy);
  slide.addText("Fechamento", {
    x: 0.7,
    y: 0.95,
    w: 2.5,
    h: 0.35,
    fontFace: "Arial",
    fontSize: 20,
    bold: true,
    color: "A7F3D0",
  });
  slide.addText("O Aligna demonstra que IA pode ser usada para organizar a preparacao da entrega de software com mais clareza, governanca e continuidade operacional.", {
    x: 0.7,
    y: 1.6,
    w: 7.2,
    h: 0.95,
    fontFace: "Arial",
    fontSize: 24,
    bold: true,
    color: COLORS.white,
    margin: 0,
  });
  addBullets(slide, [
    "fluxo completo entre ideia e handoff tecnico",
    "arquitetura em camadas com agentes especializados",
    "governanca de runtime de IA",
    "caso pratico de evolucao no Central de Chamados Internos",
    "base pronta para futuras pesquisas e evolucao do produto",
  ], 0.78, 3.15, 6.2, { fontSize: 17, lineGap: 1.16 });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 8.45,
    y: 1.45,
    w: 4.15,
    h: 4.7,
    rectRadius: 0.1,
    line: { color: "334155", pt: 1.1 },
    fill: { color: "10223A" },
  });
  slide.addText("Sugestao de fala final", {
    x: 8.72,
    y: 1.78,
    w: 2.6,
    h: 0.22,
    fontFace: "Arial",
    fontSize: 12,
    bold: true,
    color: "A7F3D0",
    charSpace: 1.2,
  });
  slide.addText("Este produto nao tenta substituir pensamento de produto, arquitetura ou QA. Ele tenta organizar melhor essas camadas com apoio de IA, para que a implementacao comece com mais clareza e menos retrabalho.", {
    x: 8.72,
    y: 2.15,
    w: 3.45,
    h: 2.1,
    fontFace: "Arial",
    fontSize: 18,
    color: COLORS.white,
    margin: 0,
    valign: "mid",
  });
  slide.addText("Obrigado.", {
    x: 8.72,
    y: 5.35,
    w: 2.0,
    h: 0.3,
    fontFace: "Arial",
    fontSize: 20,
    bold: true,
    color: "FDE68A",
  });
  finalizeSlide(slide, 13);
}

(async () => {
  const outPath = path.join(OUT_DIR, "Aligna_Apresentacao_Professor.pptx");
  await pptx.writeFile({ fileName: outPath });
  console.log(`Wrote ${outPath}`);
})();
