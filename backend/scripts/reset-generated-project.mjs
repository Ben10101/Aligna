import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { mkdir, access, rm, writeFile, readdir } from 'fs/promises';
import { prisma } from '../src/lib/prisma.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const index = process.argv.findIndex((arg) => arg === `--${name}` || arg.startsWith(prefix));
  if (index === -1) return fallback;
  const arg = process.argv[index];
  if (arg.startsWith(prefix)) return arg.slice(prefix.length) || fallback;
  return process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[index + 1] : fallback;
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function writeText(targetPath, content) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, 'utf8');
}

async function removeFileIfExists(targetPath) {
  if (await pathExists(targetPath)) {
    await rm(targetPath, { force: true });
  }
}

async function removeDirectoryIfExists(targetPath) {
  if (await pathExists(targetPath)) {
    await rm(targetPath, { recursive: true, force: true });
  }
}

async function removeEmptyParentDirectories(filePath, stopAtPath) {
  let current = path.dirname(filePath);
  const stop = path.resolve(stopAtPath);

  while (current.startsWith(stop) && current !== stop) {
    const entries = await rmEmptyDirIfNeeded(current);
    if (!entries) break;
    current = path.dirname(current);
  }
}

async function rmEmptyDirIfNeeded(directoryPath) {
  if (!(await pathExists(directoryPath))) return false;

  const entries = await readdir(directoryPath);
  if (entries.length) return false;

  await rm(directoryPath, { recursive: true, force: true });
  return true;
}

function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

function ensurePrismaSchemaFoundation(content) {
  const normalized = String(content || '').trim();
  const withGenerator = /generator\s+client\s*\{/.test(normalized)
    ? normalized
    : `generator client {\n  provider = "prisma-client-js"\n}\n\n${normalized}`.trim();

  const withDatasource = /datasource\s+db\s*\{/.test(withGenerator)
    ? withGenerator
    : `${withGenerator}\n\ndatasource db {\n  provider = "mysql"\n  url      = env("DATABASE_URL")\n}`.trim();

  return `${withDatasource}\n`;
}

function buildResetApiServer(appSlug) {
  return `import express from 'express'
import cors from 'cors'
import pino from 'pino'

const app = express()
const logger = pino({ name: '${appSlug}-api' })
const port = Number(process.env.PORT || 3001)
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) {
        return callback(null, true)
      }

      return callback(new Error(\`Origin not allowed: \${origin}\`))
    },
    credentials: true,
  })
)
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', app: '${appSlug}' })
})

app.listen(port, () => {
  logger.info({ port }, 'API running')
})
`;
}

function buildResetWebApp(projectName) {
  return `import { AppFrame, AppHeader, SidebarNav, SurfaceCard } from '../../../packages/ui/src/index.tsx'

const routes = []

export default function App() {
  return (
    <AppFrame>
      <AppHeader
        title="${projectName}"
        routes={routes}
        activePath=""
      />
      <div style={{ display: 'grid', gridTemplateColumns: '234px minmax(0, 1fr)' }}>
        <SidebarNav routes={routes} activePath="" />
        <div style={{ padding: 18 }}>
          <SurfaceCard
            title="Projeto reiniciado"
            description="Nenhuma feature foi iniciada ainda. O workspace foi limpo e aguarda um novo backlog, RE, QA e arquitetura."
            meta="Status: nao iniciado"
          >
            <p style={{ margin: 0, color: '#475569' }}>
              O proximo passo e abrir o contexto do projeto e gerar uma nova jornada tecnica quando houver demanda.
            </p>
          </SurfaceCard>
        </div>
      </div>
    </AppFrame>
  )
}
`;
}

async function main() {
  const projectSlug = parseArgValue('project-slug', 'plataforma-de-operacoes-de-visitas-corporativas');
  const project = await prisma.project.findFirst({
    where: {
      OR: [{ slug: projectSlug }, { uuid: projectSlug }],
    },
    include: {
      generatedApps: {
        include: {
          files: {
            select: {
              filePath: true,
              taskImplementationId: true,
            },
          },
        },
      },
      tasks: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!project) {
    throw new Error(`Projeto nao encontrado para slug/uuid: ${projectSlug}`);
  }

  const generatedApps = project.generatedApps || [];
  const generatedAppIds = generatedApps.map((item) => item.id);
  const generatedApp = generatedApps[0] || null;
  const generatedAppRoot = generatedApp?.rootPath;
  if (!generatedAppRoot) {
    throw new Error('Projeto encontrado, mas sem generatedApp associado.');
  }

  const implementationFileRows = await prisma.generatedFile.findMany({
    where: {
      generatedAppId: { in: generatedAppIds },
      taskImplementationId: { not: null },
    },
    select: {
      filePath: true,
    },
  });

  const implementationFilePaths = [...new Set(implementationFileRows.map((row) => row.filePath))];
  const taskIds = project.tasks.map((task) => task.id);

  await prisma.$transaction(async (tx) => {
    await tx.taskArtifact.deleteMany({
      where: {
        taskId: { in: taskIds },
        artifactScope: 'implementation',
      },
    });

    await tx.generatedFile.deleteMany({
      where: {
        generatedAppId: { in: generatedAppIds },
        OR: [
          { taskImplementationId: { not: null } },
          { filePath: { startsWith: 'apps/api/src/modules/' } },
          { filePath: { startsWith: 'apps/web/src/features/' } },
          { filePath: { startsWith: 'packages/shared/src/contracts/' } },
          { filePath: { startsWith: 'docs/implementations/' } },
        ],
      },
    });

    await tx.generatedAppRun.deleteMany({
      where: {
        generatedAppId: { in: generatedAppIds },
      },
    });

    await tx.taskImplementation.deleteMany({
      where: {
        generatedAppId: { in: generatedAppIds },
      },
    });

    await tx.agentRun.deleteMany({
      where: {
        projectId: project.id,
      },
    });

    await tx.taskStatusHistory.deleteMany({
      where: {
        taskId: { in: taskIds },
      },
    });

    await tx.task.updateMany({
      where: {
        projectId: project.id,
      },
      data: {
        status: 'backlog',
        assigneeType: 'unassigned',
        assigneeUserId: null,
        assigneeAgentName: null,
        startedAt: null,
        completedAt: null,
        currentArtifactSummary: null,
      },
    });

    await tx.generatedApp.updateMany({
      where: {
        projectId: project.id,
      },
      data: {
        status: 'draft',
        currentVersion: 1,
      },
    });
  });

  for (const filePath of implementationFilePaths) {
    const absoluteFilePath = path.join(generatedAppRoot, filePath);
    await removeFileIfExists(absoluteFilePath);
    await removeEmptyParentDirectories(absoluteFilePath, generatedAppRoot);
  }

  await removeDirectoryIfExists(path.join(generatedAppRoot, 'apps', 'api', 'src', 'modules'));
  await removeDirectoryIfExists(path.join(generatedAppRoot, 'apps', 'web', 'src', 'features'));
  await removeDirectoryIfExists(path.join(generatedAppRoot, 'packages', 'shared', 'src', 'contracts'));
  await removeDirectoryIfExists(path.join(generatedAppRoot, 'docs', 'implementations'));

  await writeText(path.join(generatedAppRoot, 'apps', 'api', 'src', 'server.ts'), buildResetApiServer(generatedApp.slug));
  await writeText(path.join(generatedAppRoot, 'apps', 'web', 'src', 'App.tsx'), buildResetWebApp(project.name));
  await writeText(path.join(generatedAppRoot, 'packages', 'shared', 'src', 'index.ts'), 'export {}\\n');
  await writeText(path.join(generatedAppRoot, 'prisma', 'schema.prisma'), ensurePrismaSchemaFoundation(''));

  const refreshedFiles = [
    {
      relativePath: 'apps/api/src/server.ts',
      content: buildResetApiServer(generatedApp.slug),
      fileType: 'ts',
    },
    {
      relativePath: 'apps/web/src/App.tsx',
      content: buildResetWebApp(project.name),
      fileType: 'tsx',
    },
    {
      relativePath: 'packages/shared/src/index.ts',
      content: 'export {}\n',
      fileType: 'ts',
    },
    {
      relativePath: 'prisma/schema.prisma',
      content: ensurePrismaSchemaFoundation(''),
      fileType: 'prisma',
    },
  ];

  await prisma.generatedFile.deleteMany({
    where: {
      generatedAppId: { in: generatedAppIds },
      filePath: {
        in: refreshedFiles.map((file) => file.relativePath),
      },
    },
  });

  await prisma.generatedFile.createMany({
    data: refreshedFiles.map((file) => ({
      generatedAppId: generatedApp.id,
      filePath: file.relativePath,
      fileType: file.fileType,
      changeType: 'updated',
      checksum: sha(file.content),
    })),
  });

  console.log(
    JSON.stringify(
      {
        projectSlug: project.slug,
        projectUuid: project.uuid,
        generatedAppUuid: generatedApp.uuid,
        removedImplementationFiles: implementationFilePaths.length,
        reset: {
          tasks: project.tasks.length,
          generatedApps: generatedApps.length,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
