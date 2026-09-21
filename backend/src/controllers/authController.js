import {
  getCsrfCookieName,
  getCsrfCookieOptions,
  getRefreshCookieName,
  getRefreshCookieOptions,
  getAuthUser,
  loginUser,
  logoutUser,
  readRefreshTokenFromRequest,
  refreshAccessToken,
  registerUserWithWorkspace,
  issueCsrfToken,
} from '../services/authService.js';

function attachSessionCookies(res, refreshToken) {
  const csrfToken = issueCsrfToken();
  res.cookie(getRefreshCookieName(), refreshToken, getRefreshCookieOptions());
  res.cookie(getCsrfCookieName(), csrfToken, getCsrfCookieOptions());
}

export async function registerController(req, res, next) {
  try {
    const result = await registerUserWithWorkspace(req.body || {});
    attachSessionCookies(res, result.refreshToken);
    res.status(201).json({
      accessToken: result.accessToken,
      ...result.authContext,
    });
  } catch (error) {
    next(error);
  }
}

export async function loginController(req, res, next) {
  try {
    const result = await loginUser(req.body || {});
    attachSessionCookies(res, result.refreshToken);
    res.status(200).json({
      accessToken: result.accessToken,
      ...result.authContext,
    });
  } catch (error) {
    next(error);
  }
}

export async function refreshController(req, res, next) {
  try {
    const refreshToken = readRefreshTokenFromRequest(req);
    const result = await refreshAccessToken(refreshToken);
    attachSessionCookies(res, result.refreshToken);
    res.status(200).json({
      accessToken: result.accessToken,
      ...result.authContext,
    });
  } catch (error) {
    next(error);
  }
}

export async function logoutController(req, res, next) {
  try {
    await logoutUser(req.authUser?.uuid, readRefreshTokenFromRequest(req));
    res.clearCookie(getRefreshCookieName(), {
      ...getRefreshCookieOptions(),
      maxAge: undefined,
    });
    res.clearCookie(getCsrfCookieName(), {
      ...getCsrfCookieOptions(),
      maxAge: undefined,
    });
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
}

export async function meController(req, res, next) {
  try {
    const user = await getAuthUser(req.authToken);
    res.status(200).json(user.authContext);
  } catch (error) {
    next(error);
  }
}
