import { prisma } from '../src/lib/prisma.js';
import { getPipelineCoherenceOverview } from '../src/services/observabilityService.js';

const original = {
  projectFindMany: prisma.project.findMany,
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function installMocks() {
  prisma.project.findMany = async () => [
    {
      uuid: 'project-1',
      name: 'Operacoes de Eventos',
      status: 'active',
      templateKey: 'react-express-prisma',
      updatedAt: new Date('2026-04-06T18:00:00Z'),
      intakeConfig: {
        projectDna: { product_mode: 'operational-workspace' },
        backlogContract: { stories: [{ id: 'story-1' }] },
        solutionBlueprint: { modules: ['event-schedules'] },
      },
      tasks: [
        {
          uuid: 'task-1',
          title: 'Montar cronograma inicial',
          status: 'done',
          updatedAt: new Date('2026-04-06T18:10:00Z'),
          artifacts: [
            {
              title: '[SYSTEM] Requirement Spec',
              content: '{"objective":"Montar cronograma"}',
              contentFormat: 'json',
              createdAt: new Date('2026-04-06T18:11:00Z'),
            },
            {
              title: '[SYSTEM] Test Spec',
              content: '{"strategy":{"smoke":["abrir pagina"]}}',
              contentFormat: 'json',
              createdAt: new Date('2026-04-06T18:12:00Z'),
            },
          ],
          implementations: [
            {
              uuid: 'impl-1',
              status: 'integrated',
              buildStatus: 'completed',
              testStatus: 'completed',
              updatedAt: new Date('2026-04-06T18:30:00Z'),
              artifacts: [
                {
                  title: 'Implementation Manifest - Montar cronograma inicial',
                  content: '{"featureKey":"event-schedules"}',
                  contentFormat: 'json',
                  createdAt: new Date('2026-04-06T18:20:00Z'),
                },
                {
                  title: 'Coherence Report - Montar cronograma inicial',
                  content: '{"status":"approved","driftFlags":[]}',
                  contentFormat: 'json',
                  createdAt: new Date('2026-04-06T18:21:00Z'),
                },
              ],
            },
          ],
        },
        {
          uuid: 'task-2',
          title: 'Cadastrar fornecedores',
          status: 'in_progress',
          updatedAt: new Date('2026-04-06T18:15:00Z'),
          artifacts: [
            {
              title: '[SYSTEM] Requirement Spec',
              content: '{"objective":"Cadastrar fornecedores"}',
              contentFormat: 'json',
              createdAt: new Date('2026-04-06T18:16:00Z'),
            },
          ],
          implementations: [
            {
              uuid: 'impl-2',
              status: 'failed',
              buildStatus: 'failed',
              testStatus: 'failed',
              updatedAt: new Date('2026-04-06T18:40:00Z'),
              artifacts: [
                {
                  title: 'Implementation Manifest - Cadastrar fornecedores',
                  content: '{"featureKey":"event-suppliers"}',
                  contentFormat: 'json',
                  createdAt: new Date('2026-04-06T18:31:00Z'),
                },
                {
                  title: 'Coherence Report - Cadastrar fornecedores',
                  content: '{"status":"blocked","driftFlags":["missing_requirement_contract"]}',
                  contentFormat: 'json',
                  createdAt: new Date('2026-04-06T18:32:00Z'),
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}

function restoreMocks() {
  prisma.project.findMany = original.projectFindMany;
}

try {
  installMocks();

  const overview = await getPipelineCoherenceOverview('user-1');

  assert(overview.summary.projects === 1, 'O overview deveria consolidar um projeto.');
  assert(overview.summary.stories === 2, 'O overview deveria contar as stories do projeto.');
  assert(overview.summary.implementations === 2, 'O overview deveria contar implementacoes.');
  assert(overview.contractCoverage.projectDnaPercent === 100, 'O DNA do projeto deveria estar coberto.');
  assert(overview.contractCoverage.requirementSpecPercent === 100, 'Todas as stories deveriam ter requirement spec.');
  assert(overview.contractCoverage.testSpecPercent === 50, 'A cobertura de test spec deveria refletir a story pendente.');
  assert(overview.summary.blockedImplementations === 1, 'Uma implementacao deveria aparecer bloqueada.');
  assert(
    overview.topDriftFlags.some((item) => item.flag === 'missing_requirement_contract' && item.count === 1),
    'Os drift flags deveriam ser agregados.'
  );
  assert(
    overview.alerts.some((alert) => alert.code === 'pipeline_coherence_blocked'),
    'O overview deveria emitir alerta para bloqueios de coerencia.'
  );

  console.log('pipeline-coherence-smoke: ok');
} finally {
  restoreMocks();
}
