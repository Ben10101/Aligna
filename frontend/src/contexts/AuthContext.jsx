import axios from 'axios'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  API_URL,
  clearApiAccessToken,
  getApiErrorMessage,
  getMe,
  loginAuth,
  logoutAuth,
  refreshSession,
  registerAuth,
  setApiAccessToken,
} from '../services/api'

const AuthContext = createContext(null)
const ACCESS_TOKEN_REFRESH_LEEWAY_MS = 2 * 60 * 1000
const ACTIVITY_WINDOW_MS = 10 * 60 * 1000
const KEEPALIVE_CHECK_INTERVAL_MS = 60 * 1000

function parseJwtPayload(token) {
  if (!token) return null

  try {
    const [, encodedPayload] = String(token).split('.')
    if (!encodedPayload) return null

    const normalized = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const json =
      typeof window !== 'undefined' && typeof window.atob === 'function'
        ? window.atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(json)
  } catch {
    return null
  }
}

function getAccessTokenExpiry(token) {
  const payload = parseJwtPayload(token)
  const exp = Number(payload?.exp || 0)
  return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0
}

function isInvalidSessionError(error) {
  const status = error?.response?.status
  return status === 401 || status === 403 || status === 429
}

function persistBootstrapContext(session) {
  if (!session?.user || !session?.workspace) {
    localStorage.removeItem('factory_bootstrap_context')
    return
  }

  localStorage.setItem(
    'factory_bootstrap_context',
    JSON.stringify({
      user: session.user,
      workspace: session.workspace,
    })
  )
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastActivityAt, setLastActivityAt] = useState(() => Date.now())
  const apiOrigin = useMemo(() => {
    try {
      return new URL(API_URL).origin
    } catch {
      return window.location.origin
    }
  }, [])

  useEffect(() => {
    const syncRefreshedSession = (event) => {
      const restored = event.detail
      if (!restored?.accessToken || !restored?.user) return
      setSession({ user: restored.user, workspace: restored.workspace, accessToken: restored.accessToken })
      persistBootstrapContext(restored)
    }
    const clearInvalidSession = () => {
      clearApiAccessToken()
      setSession(null)
      persistBootstrapContext(null)
    }
    window.addEventListener('factory:session-refreshed', syncRefreshedSession)
    window.addEventListener('factory:session-invalid', clearInvalidSession)
    return () => {
      window.removeEventListener('factory:session-refreshed', syncRefreshedSession)
      window.removeEventListener('factory:session-invalid', clearInvalidSession)
    }
  }, [])

  useEffect(() => {
    axios.defaults.withCredentials = true

    const requestInterceptor = axios.interceptors.request.use((config) => {
      if (config.url?.startsWith('/api/')) {
        config.baseURL = apiOrigin
      }

      if (session?.accessToken) {
        config.headers = config.headers || {}
        config.headers.Authorization = `Bearer ${session.accessToken}`
      }

      return config
    })

    const responseInterceptor = axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config

        if (!originalRequest || originalRequest._retry || error.response?.status !== 401) {
          return Promise.reject(error)
        }

        if (originalRequest.url?.includes('/auth/login') || originalRequest.url?.includes('/auth/register') || originalRequest.url?.includes('/auth/refresh')) {
          return Promise.reject(error)
        }

        originalRequest._retry = true

        try {
          const restored = await refreshSession()
          setApiAccessToken(restored.accessToken)
          setSession({
            user: restored.user,
            workspace: restored.workspace,
            accessToken: restored.accessToken,
          })
          persistBootstrapContext(restored)
          originalRequest.headers = originalRequest.headers || {}
          originalRequest.headers.Authorization = `Bearer ${restored.accessToken}`
          return axios(originalRequest)
        } catch (refreshError) {
          if (!isInvalidSessionError(refreshError)) {
            return Promise.reject(refreshError)
          }
          clearApiAccessToken()
          setSession(null)
          persistBootstrapContext(null)
          return Promise.reject(refreshError)
        }
      }
    )

    return () => {
      axios.interceptors.request.eject(requestInterceptor)
      axios.interceptors.response.eject(responseInterceptor)
    }
  }, [apiOrigin, session?.accessToken])

  useEffect(() => {
    let cancelled = false

    async function restoreSession() {
      try {
        const restored = await refreshSession()
        if (cancelled) return

        setApiAccessToken(restored.accessToken)
        setSession({
          user: restored.user,
          workspace: restored.workspace,
          accessToken: restored.accessToken,
        })
        persistBootstrapContext(restored)
      } catch (error) {
        if (cancelled || !isInvalidSessionError(error)) return
        clearApiAccessToken()
        setSession(null)
        persistBootstrapContext(null)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    restoreSession()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!session?.accessToken) return undefined

    const markActivity = () => setLastActivityAt(Date.now())
    const events = ['pointerdown', 'keydown', 'mousemove', 'scroll', 'focus', 'visibilitychange']

    for (const eventName of events) {
      window.addEventListener(eventName, markActivity, { passive: true })
    }

    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, markActivity)
      }
    }
  }, [session?.accessToken])

  useEffect(() => {
    if (!session?.accessToken) return undefined

    let cancelled = false

    const refreshIfNeeded = async () => {
      if (cancelled) return
      if (document.visibilityState === 'hidden') return

      const now = Date.now()
      if (now - lastActivityAt > ACTIVITY_WINDOW_MS) return

      const expiresAt = getAccessTokenExpiry(session.accessToken)
      if (!expiresAt || expiresAt - now > ACCESS_TOKEN_REFRESH_LEEWAY_MS) return

      try {
        const restored = await refreshSession()
        if (cancelled) return

        setApiAccessToken(restored.accessToken)
        setSession({
          user: restored.user,
          workspace: restored.workspace,
          accessToken: restored.accessToken,
        })
        persistBootstrapContext(restored)
      } catch (error) {
        if (cancelled || !isInvalidSessionError(error)) return
        clearApiAccessToken()
        setSession(null)
        persistBootstrapContext(null)
      }
    }

    refreshIfNeeded()
    const intervalId = window.setInterval(refreshIfNeeded, KEEPALIVE_CHECK_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [lastActivityAt, session?.accessToken])

  const value = useMemo(
    () => ({
      session,
      user: session?.user || null,
      workspace: session?.workspace || null,
      isAuthenticated: Boolean(session?.user),
      loading,
      async login(payload) {
        try {
          const result = await loginAuth(payload)
          setSession({
            user: result.user,
            workspace: result.workspace,
            accessToken: result.accessToken,
          })
          persistBootstrapContext(result)
          return result
        } catch (error) {
          throw new Error(getApiErrorMessage(error, 'Não foi possível entrar.'))
        }
      },
      async register(payload) {
        try {
          const result = await registerAuth(payload)
          setSession({
            user: result.user,
            workspace: result.workspace,
            accessToken: result.accessToken,
          })
          persistBootstrapContext(result)
          return result
        } catch (error) {
          throw new Error(getApiErrorMessage(error, 'Não foi possível criar a conta.'))
        }
      },
      async refreshMe() {
        const result = await getMe()
        setSession((current) => ({
          ...current,
          user: result.user,
          workspace: result.workspace,
        }))
        persistBootstrapContext(result)
        return result
      },
      async logout() {
        try {
          await logoutAuth()
        } catch (e) {
          console.warn('Logout API failed, clearing session locally')
        } finally {
          clearApiAccessToken()
          setSession(null)
          persistBootstrapContext(null)
        }
      },
    }),
    [loading, session]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth precisa ser usado dentro de AuthProvider')
  }
  return context
}

export { API_URL }
