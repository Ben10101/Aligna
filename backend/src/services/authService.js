import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma.js';
import { bootstrapWorkspaceAndUser } from './projectDataService.js';
import { hashPassword, hashToken, signJwt, verifyJwt, verifyPassword } from '../utils/crypto.js';
import { parseCookies } from '../utils/cookies.js';

const ACCESS_TOKEN_TTL_SECONDS = 60 * 15;
const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 30;
const MIN_REFRESH_TOKEN_TTL_DAYS = 1;
const MAX_REFRESH_TOKEN_TTL_DAYS = 90;
const configuredRefreshTokenTtlDays = Number(process.env.AUTH_REFRESH_TOKEN_TTL_DAYS);
const REFRESH_TOKEN_TTL_DAYS = Number.isFinite(configuredRefreshTokenTtlDays)
  ? Math.min(MAX_REFRESH_TOKEN_TTL_DAYS, Math.max(MIN_REFRESH_TOKEN_TTL_DAYS, Math.floor(configuredRefreshTokenTtlDays)))
  : DEFAULT_REFRESH_TOKEN_TTL_DAYS;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * REFRESH_TOKEN_TTL_DAYS;
const REFRESH_COOKIE_NAME = 'factory_refresh_token';
const CSRF_COOKIE_NAME = 'factory_csrf_token';

function createAuthError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getAccessSecret() {
  const secret = process.env.AUTH_ACCESS_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw createAuthError('AUTH_ACCESS_SECRET ou JWT_SECRET precisa estar configurado no ambiente.', 500);
  }
  return secret;
}

function buildAccessTokenPayload(user) {
  return {
    sub: user.uuid,
    email: user.email,
    role: user.role,
    type: 'access',
  };
}

function buildRefreshCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: isProduction ? 'strict' : 'lax',
    secure: isProduction,
    path: '/api/auth',
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  };
}

function buildCsrfCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: false,
    sameSite: isProduction ? 'strict' : 'lax',
    secure: isProduction,
    path: '/api',
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  };
}

async function getDefaultWorkspaceForUser(userId) {
  const ownedWorkspace = await prisma.workspace.findFirst({
    where: { ownerUserId: userId },
    select: { uuid: true, name: true, slug: true },
    orderBy: { createdAt: 'asc' },
  });

  if (ownedWorkspace) return ownedWorkspace;

  const membership = await prisma.projectMember.findFirst({
    where: { userId },
    include: {
      project: {
        include: {
          workspace: {
            select: { uuid: true, name: true, slug: true },
          },
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  return membership?.project?.workspace || null;
}

async function buildAuthResponse(userRecord) {
  const workspace = await getDefaultWorkspaceForUser(userRecord.id);
  return {
    user: {
      uuid: userRecord.uuid,
      name: userRecord.name,
      email: userRecord.email,
      role: userRecord.role,
      status: userRecord.status,
    },
    workspace,
  };
}

function getRefreshTokenExpiry() {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
}

async function persistRefreshToken(userId, refreshToken) {
  const now = new Date();
  await prisma.$transaction([
    prisma.authSession.create({
      data: {
        userId,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: getRefreshTokenExpiry(),
        lastUsedAt: now,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: now },
    }),
  ]);
}

function createAccessToken(user) {
  return signJwt(buildAccessTokenPayload(user), getAccessSecret(), ACCESS_TOKEN_TTL_SECONDS);
}

function createRefreshToken() {
  return `${randomUUID()}.${randomUUID()}`;
}

function createCsrfToken() {
  return `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
}

export async function registerUserWithWorkspace({ name, email, password, workspaceName }) {
  if (!name?.trim() || !email?.trim() || !password?.trim()) {
    throw createAuthError('name, email e password sao obrigatorios.', 400);
  }

  if (password.length < 8) {
    throw createAuthError('A senha precisa ter pelo menos 8 caracteres.', 400);
  }

  const passwordHash = await hashPassword(password);
  const resolvedWorkspaceName = workspaceName?.trim() || 'Meu Workspace';
  const { user } = await bootstrapWorkspaceAndUser({
    userName: name,
    email,
    workspaceName: resolvedWorkspaceName,
    passwordHash,
    failIfUserExists: true,
  });

  const refreshToken = createRefreshToken();
  await persistRefreshToken(user.id, refreshToken);

  return {
    accessToken: createAccessToken(user),
    refreshToken,
    authContext: await buildAuthResponse(user),
  };
}

export async function loginUser({ email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user || !user.passwordHash) {
    throw createAuthError('Credenciais invalidas.', 401);
  }

  const validPassword = await verifyPassword(password, user.passwordHash);
  if (!validPassword) {
    throw createAuthError('Credenciais invalidas.', 401);
  }

  if (user.status !== 'active') {
    throw createAuthError('Usuário inativo.', 403);
  }

  const refreshToken = createRefreshToken();
  await persistRefreshToken(user.id, refreshToken);

  return {
    accessToken: createAccessToken(user),
    refreshToken,
    authContext: await buildAuthResponse(user),
  };
}

export async function refreshAccessToken(refreshToken) {
  if (!refreshToken) {
    throw createAuthError('Refresh token ausente.', 401);
  }

  const refreshTokenHash = hashToken(refreshToken);
  const now = new Date();
  const session = await prisma.authSession.findFirst({
    where: { refreshTokenHash, expiresAt: { gt: now } },
    include: { user: true },
  });

  // Preserve sessions issued before the auth_sessions migration. Once used,
  // they are moved to the per-device session store without forcing a logout.
  const legacyUser = session ? null : await prisma.user.findFirst({
    where: { refreshTokenHash, refreshTokenExpiresAt: { gt: now } },
  });
  const user = session?.user || legacyUser;

  if (!user) {
    throw createAuthError('Sessao invalida.', 401);
  }

  const expiresAt = getRefreshTokenExpiry();
  if (session) {
    await prisma.authSession.update({ where: { id: session.id }, data: { expiresAt, lastUsedAt: now } });
  } else {
    await prisma.$transaction([
      prisma.authSession.upsert({
        where: { refreshTokenHash },
        create: { userId: user.id, refreshTokenHash, expiresAt, lastUsedAt: now },
        update: { expiresAt, lastUsedAt: now },
      }),
      prisma.user.update({ where: { id: user.id }, data: { refreshTokenHash: null, refreshTokenExpiresAt: null } }),
    ]);
  }

  return {
    accessToken: createAccessToken(user),
    refreshToken,
    authContext: await buildAuthResponse(user),
  };
}

export async function logoutUser(userUuid, refreshToken = null) {
  if (!userUuid) return;
  const refreshTokenHash = refreshToken ? hashToken(refreshToken) : null;
  await prisma.$transaction([
    prisma.authSession.deleteMany({
      where: { user: { is: { uuid: userUuid } }, ...(refreshTokenHash ? { refreshTokenHash } : {}) },
    }),
    prisma.user.updateMany({
      where: { uuid: userUuid, ...(refreshTokenHash ? { refreshTokenHash } : {}) },
      data: { refreshTokenHash: null, refreshTokenExpiresAt: null },
    }),
  ]);
}

export async function getAuthUser(accessToken) {
  const payload = verifyJwt(accessToken, getAccessSecret());
  if (payload.type !== 'access') {
    throw createAuthError('Tipo de token invalido.', 401);
  }

  const user = await prisma.user.findUnique({
    where: { uuid: payload.sub },
  });

  if (!user || user.status !== 'active') {
    throw createAuthError('Usuário inválido.', 401);
  }

  return {
    ...user,
    authContext: await buildAuthResponse(user),
  };
}

export function readRefreshTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[REFRESH_COOKIE_NAME] || null;
}

export function getRefreshCookieName() {
  return REFRESH_COOKIE_NAME;
}

export function getRefreshCookieOptions() {
  return buildRefreshCookieOptions();
}

export function getRefreshTokenTtlDays() {
  return REFRESH_TOKEN_TTL_DAYS;
}

export function getCsrfCookieName() {
  return CSRF_COOKIE_NAME;
}

export function getCsrfCookieOptions() {
  return buildCsrfCookieOptions();
}

export function issueCsrfToken() {
  return createCsrfToken();
}
