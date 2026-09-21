import { prisma } from '../lib/prisma.js';

const MAX_WORKBENCH_ARTIFACTS_PER_USER = 20;
const MAX_TEXT_LENGTH = 20000;
const MAX_OUTPUT_JSON_LENGTH = 40000;

function normalizeText(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value || '').replace(/\r/g, '').trim().slice(0, maxLength);
}

function normalizeStoredOutput(output) {
  if (typeof output === 'string') {
    return normalizeText(output, MAX_OUTPUT_JSON_LENGTH);
  }

  if (output == null) return '';

  try {
    const cloned = JSON.parse(JSON.stringify(output));
    const serialized = JSON.stringify(cloned);
    if (serialized.length <= MAX_OUTPUT_JSON_LENGTH) {
      return cloned;
    }

    return normalizeText(serialized, MAX_OUTPUT_JSON_LENGTH);
  } catch {
    return normalizeText(String(output), MAX_OUTPUT_JSON_LENGTH);
  }
}

function normalizeWorkbenchArtifactEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const id = normalizeText(entry.id, 120);
  const agent = normalizeText(entry.agent, 100);
  const story = normalizeText(entry.story, MAX_TEXT_LENGTH);
  const storyPreview = normalizeText(entry.storyPreview || story.slice(0, 120), 160);
  const context = normalizeText(entry.context, MAX_TEXT_LENGTH);
  const projectId = normalizeText(entry.projectId, 120);
  const timestamp = normalizeText(entry.timestamp, 80) || new Date().toISOString();
  const output = normalizeStoredOutput(entry.output);

  if (!id || !agent || !story || !timestamp) {
    return null;
  }

  return {
    id,
    agent,
    story,
    storyPreview,
    context,
    projectId,
    timestamp,
    output,
  };
}

function normalizeWorkbenchArtifactState(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const artifactsSource = Array.isArray(source.artifacts) ? source.artifacts : [];
  const artifacts = [];
  const seenIds = new Set();

  for (const item of artifactsSource) {
    const normalized = normalizeWorkbenchArtifactEntry(item);
    if (!normalized || seenIds.has(normalized.id)) continue;
    seenIds.add(normalized.id);
    artifacts.push(normalized);
  }

  return {
    artifacts: artifacts.slice(0, MAX_WORKBENCH_ARTIFACTS_PER_USER),
  };
}

async function readStoredWorkbenchArtifactsForUser(userUuid) {
  const user = await prisma.user.findUnique({
    where: { uuid: userUuid },
    select: { workbenchArtifacts: true },
  });

  return normalizeWorkbenchArtifactState(user?.workbenchArtifacts || {});
}

export async function getWorkbenchArtifactsForUser(userUuid) {
  return readStoredWorkbenchArtifactsForUser(userUuid);
}

export async function appendWorkbenchArtifactForUser(userUuid, artifactInput) {
  const current = await readStoredWorkbenchArtifactsForUser(userUuid);
  const normalizedArtifact = normalizeWorkbenchArtifactEntry(artifactInput);

  if (!normalizedArtifact) {
    throw new Error('Nao foi possivel salvar o refinamento da bancada.');
  }

  const next = normalizeWorkbenchArtifactState({
    artifacts: [normalizedArtifact, ...current.artifacts],
  });

  await prisma.user.update({
    where: { uuid: userUuid },
    data: { workbenchArtifacts: next },
  });

  return next;
}
