import { PrismaClient } from '../../backend/node_modules/@prisma/client/index.js';

const prisma = new PrismaClient();

function normalize(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function extractSection(content, title) {
  const text = String(content || '');
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`##+\\s+${escaped}\\s*([\\s\\S]*?)(?=\\n##+\\s+|$)`, 'i');
  const match = text.match(regex);
  return match ? String(match[1] || '').trim() : '';
}

function extractStoryLines(content) {
  return String(content || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(?:[-*]\s*)?(?:(?:US|STORY)-\d+\s*\|\s*|\d+[\.\)]\s*)?Como\b/i.test(line));
}

function similarityKey(title = '') {
  return normalize(title)
    .replace(/^\s*(?:[-*]\s*)?(?:(?:us|story)-\d+\s*\|\s*|\d+[\.\)]\s*)?/i, '')
    .replace(/\b(como|eu quero|para|um|uma|o|a|de|do|da|dos|das)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 8)
    .join(' ');
}

function hasFoundationCoverage(stories = []) {
  const signals = [
    /\bcriar\b/i,
    /\bcadastrar\b/i,
    /\bregistrar\b/i,
    /\bconfigurar\b/i,
    /\bvisualizar\b/i,
    /\bacompanhar\b/i,
    /\baprovar\b/i,
  ];

  return signals.filter((pattern) => stories.some((story) => pattern.test(story))).length;
}

function parseBullets(section = '') {
  return String(section)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

function analyzeBacklog(content = '') {
  const normalized = normalize(content);
  const stories = extractStoryLines(content);
  const personas = stories
    .map((story) => {
      const match = story.match(/como\s+([^,|]+)/i);
      return match ? normalize(match[1]).trim() : null;
    })
    .filter(Boolean);
  const capabilities = parseBullets(extractSection(content, 'Capacidades do Produto'));
  const epics = parseBullets(extractSection(content, 'Epicos Recomendados'));
  const releaseSlices = parseBullets(extractSection(content, 'Fatias de Release'));
  const duplicateCount = stories.length - new Set(stories.map((story) => similarityKey(story))).size;
  const truncatedStories = stories.filter((story) => !/\bpara\b.+/i.test(story) || story.trim().length < 30);
  const foundationCoverage = hasFoundationCoverage(stories);
  const laneSignals = {
    fundacao: [/\bcriar\b/i, /\bcadastrar\b/i, /\bregistrar\b/i, /\bconfigurar\b/i, /\bplanejar\b/i],
    operacao: [/\bacompanhar\b/i, /\batualizar\b/i, /\bexecut/i, /\bmonitorar\b/i, /\bstatus\b/i],
    gestao: [/\bvisualizar\b/i, /\bconsultar\b/i, /\bdashboard\b/i, /\brelatorio\b/i, /\bpainel\b/i, /\bresumo\b/i],
    governanca: [/\baprovar\b/i, /\bvalidar\b/i, /\bautorizar\b/i, /\bauditor/i, /\bpermiss/i, /\bgovernan/i],
  };
  const coveredLanes = Object.values(laneSignals).filter((patterns) =>
    patterns.some((pattern) => stories.some((story) => pattern.test(normalize(story))))
  ).length;

  const issues = [];
  if (!normalized.includes('## visao geral')) issues.push('missing_overview');
  if (capabilities.length < 4) issues.push('weak_capabilities');
  if (epics.length < 4) issues.push('weak_epics');
  if (!releaseSlices.some((item) => /mvp/i.test(item))) issues.push('missing_mvp_slice');
  if (!releaseSlices.some((item) => /fase 2/i.test(item))) issues.push('missing_phase2_slice');
  if (!releaseSlices.some((item) => /fase 3/i.test(item))) issues.push('missing_phase3_slice');
  if (stories.length < 15) issues.push('too_few_stories');
  if (duplicateCount > 0) issues.push('duplicate_stories');
  if (truncatedStories.length > 0) issues.push('truncated_stories');
  if (personas.length >= 3 && new Set(personas).size < 2) issues.push('low_persona_diversity');
  if (foundationCoverage < 4) issues.push('weak_foundation_coverage');
  if (coveredLanes < 4) issues.push('weak_lane_coverage');

  const score =
    (normalized.includes('## visao geral') ? 10 : 0) +
    Math.min(20, capabilities.length * 4) +
    Math.min(20, epics.length * 4) +
    (releaseSlices.some((item) => /mvp/i.test(item)) ? 7 : 0) +
    (releaseSlices.some((item) => /fase 2/i.test(item)) ? 7 : 0) +
    (releaseSlices.some((item) => /fase 3/i.test(item)) ? 6 : 0) +
    Math.min(15, foundationCoverage * 3) +
    Math.min(10, coveredLanes * 2.5) +
    (duplicateCount === 0 ? 3 : 0) +
    (truncatedStories.length === 0 ? 2 : 0);

  return {
    valid: issues.length === 0,
    issues,
    metrics: {
      storyCount: stories.length,
      uniquePersonaCount: new Set(personas).size,
      capabilitiesCount: capabilities.length,
      epicsCount: epics.length,
      releaseSliceCount: releaseSlices.length,
      foundationCoverage,
      coveredLanes,
      duplicateCount,
      truncatedStoryCount: truncatedStories.length,
      score,
    },
  };
}

async function main() {
  const project = await prisma.project.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true, uuid: true, name: true, slug: true },
  });

  if (!project) {
    throw new Error('Nenhum projeto encontrado para validar backlog do PM.');
  }

  const backlogTask = await prisma.task.findFirst({
    where: {
      projectId: project.id,
      title: '[SYSTEM] Backlog Master',
    },
    select: { id: true, uuid: true, title: true },
  });

  if (!backlogTask) {
    throw new Error('Task [SYSTEM] Backlog Master nao encontrada.');
  }

  const artifact = await prisma.taskArtifact.findFirst({
    where: {
      taskId: backlogTask.id,
      artifactType: 'backlog',
      isCurrent: true,
    },
    orderBy: { createdAt: 'desc' },
    select: { title: true, content: true, createdAt: true },
  });

  if (!artifact?.content) {
    throw new Error('Artefato de backlog atual nao encontrado.');
  }

  const analysis = analyzeBacklog(artifact.content);

  console.log(
    JSON.stringify(
      {
        valid: analysis.valid,
        issues: analysis.issues,
        metrics: analysis.metrics,
        project: {
          uuid: project.uuid,
          name: project.name,
          slug: project.slug,
        },
        artifact: {
          title: artifact.title,
          createdAt: artifact.createdAt,
        },
      },
      null,
      2
    )
  );

  if (!analysis.valid) {
    process.exit(2);
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
