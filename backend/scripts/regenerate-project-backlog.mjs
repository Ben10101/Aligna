import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env'), override: true });

import { prisma } from '../src/lib/prisma.js';
import { buildRuntimeAiEnvForUser } from '../src/services/aiSettingsService.js';
import { runSingleAgent } from '../src/services/orchestratorService.js';
import { persistAgentResult } from '../src/services/projectDataService.js';
import { withAiRuntimeMeta } from '../src/utils/aiRunMetrics.js';

const projectIdArg = process.argv.find((value) => value.startsWith('--project-id='));
const projectId = String(projectIdArg || '').replace('--project-id=', '');
if (!/^\d+$/.test(projectId)) throw new Error('Use --project-id=<id numérico>.');

const project = await prisma.project.findUnique({
  where: { id: BigInt(projectId) },
  include: { creator: { select: { uuid: true } } },
});
if (!project?.creator?.uuid) throw new Error(`Projeto ${projectId} não encontrado ou sem proprietário.`);

const intake = project.intakeConfig && typeof project.intakeConfig === 'object' ? project.intakeConfig : {};
const answers = intake.answers && typeof intake.answers === 'object' ? intake.answers : {};
const idea = String(intake.idea || project.description || project.vision || '').trim();
if (!idea) throw new Error('O projeto não possui briefing salvo para regenerar o backlog.');

const context = [
  idea,
  answers.objective ? `Objetivo: ${answers.objective}` : null,
  answers.audience ? `Público: ${answers.audience}` : null,
  project.description ? `Descrição: ${project.description}` : null,
  project.vision ? `Visão: ${project.vision}` : null,
].filter(Boolean).join('\n\n');

const envOverrides = await buildRuntimeAiEnvForUser(project.creator.uuid, { agentName: 'project_manager' });
const payload = withAiRuntimeMeta({
  project_id: project.uuid,
  idea: context,
  answers: {},
  elicitation: intake.pmElicitation || null,
  elicitation_answers: answers.elicitationAnswers || {},
}, envOverrides);

const result = await runSingleAgent('project_manager', payload, { envOverrides });
if (result?.clarification_required || result?.elicitation_required) {
  console.log(JSON.stringify({ regenerated: false, clarificationRequired: true, clarifications: result.clarifications || [] }, null, 2));
  await prisma.$disconnect();
  process.exit(0);
}

await persistAgentResult(project.uuid, 'project_manager', payload, result);
const stories = result?.backlog_contract?.stories || [];
console.log(JSON.stringify({
  regenerated: true,
  projectId: project.id.toString(),
  projectUuid: project.uuid,
  storyCount: stories.length,
  qualityDecision: result?.backlog_contract?.qualityReview?.decision || result?.backlog_contract?.quality_review?.decision || null,
  stories: stories.map((story) => ({ id: story.id, title: story.title, priority: story.priority, release: story.release })),
}, null, 2));

await prisma.$disconnect();
