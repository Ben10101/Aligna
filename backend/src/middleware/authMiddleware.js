import { getAuthUser, getCsrfCookieName, readRefreshTokenFromRequest } from '../services/authService.js';
import { parseCookies } from '../utils/cookies.js';

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

export async function attachAuthUser(req, _res, next) {
  try {
    const accessToken = getBearerToken(req);
    if (!accessToken) {
      req.authUser = null;
      return next();
    }

    const user = await getAuthUser(accessToken);
    req.authUser = user;
    req.authToken = accessToken;
    next();
  } catch (_error) {
    req.authUser = null;
    next();
  }
}

export async function requireAuth(req, res, next) {
  try {
    const accessToken = getBearerToken(req);
    if (!accessToken) {
      return res.status(401).json({ message: 'Autenticacao obrigatoria.' });
    }

    const user = await getAuthUser(accessToken);
    req.authUser = user;
    req.authToken = accessToken;
    next();
  } catch (error) {
    res.status(401).json({ message: error.message || 'Sessao invalida.' });
  }
}

export function clearRefreshCookie(res) {
  res.clearCookie('factory_refresh_token', {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth',
  });
}

export function getRefreshTokenFromReq(req) {
  return readRefreshTokenFromRequest(req);
}

function getAllowedOrigins() {
  return new Set(
    ['http://localhost:5173', 'http://127.0.0.1:5173', process.env.FRONTEND_ORIGIN, process.env.VITE_FRONTEND_URL]
      .filter(Boolean)
      .flatMap((value) => String(value).split(','))
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function extractRequestOrigin(req) {
  const originHeader = String(req.headers.origin || '').trim();
  if (originHeader) return originHeader;

  const refererHeader = String(req.headers.referer || '').trim();
  if (!refererHeader) return '';

  try {
    return new URL(refererHeader).origin;
  } catch {
    return '';
  }
}

export function requireCsrfForCookieSession(req, res, next) {
  const requestOrigin = extractRequestOrigin(req);
  const allowedOrigins = getAllowedOrigins();

  if (requestOrigin && !allowedOrigins.has(requestOrigin)) {
    return res.status(403).json({ message: 'Origem da requisicao nao autorizada.' });
  }

  if (process.env.NODE_ENV === 'production' && !requestOrigin) {
    return res.status(403).json({ message: 'Origem da requisicao ausente.' });
  }

  const cookies = parseCookies(req.headers.cookie);
  const csrfCookie = cookies[getCsrfCookieName()];
  const csrfHeader = String(req.headers['x-csrf-token'] || '').trim();

  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return res.status(403).json({ message: 'Validacao CSRF falhou.' });
  }

  return next();
}
