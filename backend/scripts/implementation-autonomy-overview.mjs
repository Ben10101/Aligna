import dotenv from 'dotenv';
import { getProjectImplementationOverview } from '../src/services/implementationService.js';

dotenv.config();

const projectUuid = process.argv[2] || '2ac8b772-1960-4138-bfd1-1a30dd71fe2c';
const userUuid = process.argv[3] || '7abeaba1-deba-4323-abd5-0b62eac53e0e';

function safeStringify(value) {
  return JSON.stringify(value, (_, current) => (typeof current === 'bigint' ? current.toString() : current), 2);
}

async function main() {
  const overview = await getProjectImplementationOverview(projectUuid, userUuid);

  const report = {
    projectUuid: overview.projectUuid,
    totalTasks: overview.totalTasks,
    totalImplementations: overview.totalImplementations,
    statusCounts: overview.statusCounts,
    autonomySummary: overview.autonomySummary,
    specialistSummary: overview.specialistSummary,
    generationSourceMix: overview.generationSourceMix,
    topAutonomousRejections: overview.topAutonomousRejections,
    topSpecialistCodes: overview.topSpecialistCodes,
    repairSummary: overview.repairSummary,
    topRootCauses: overview.topRootCauses,
    operationalFocus: overview.operationalFocus,
  };

  console.log(safeStringify(report));
}

main().catch((error) => {
  console.error('implementation-autonomy-overview falhou.');
  console.error(error);
  process.exit(1);
});
