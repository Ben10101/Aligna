import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Building2, Lock, Mail, User } from 'lucide-react'

const EMPTY_LOGIN = { email: '', password: '' }
const EMPTY_REGISTER = { name: '', email: '', password: '' }

const SIDE_IMAGE = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop'

function Field({ label, type = 'text', value, onChange, placeholder, helper, icon: Icon }) {
  const [isFocused, setIsFocused] = useState(false)

  return (
    <div className="mb-4 text-left">
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</label>
      <div
        className={`relative flex items-center rounded-xl border bg-slate-50/50 px-4 py-3.5 transition-all duration-300 ${
          isFocused ? 'border-[#102a72] bg-white ring-4 ring-[#102a72]/10 shadow-sm' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        {Icon ? (
          <Icon className={`mr-3 h-5 w-5 transition-colors duration-300 ${isFocused ? 'text-[#102a72]' : 'text-slate-400'}`} strokeWidth={1.5} />
        ) : null}
        <input
          type={type}
          value={value}
          onChange={onChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 outline-none"
        />
      </div>
      {helper ? <span className="mt-1.5 block text-[11px] leading-relaxed tracking-tight text-slate-500">{helper}</span> : null}
    </div>
  )
}

function TogglePill({ mode, setMode }) {
  return (
    <div className="relative mb-8 flex w-full max-w-sm rounded-xl bg-slate-100/80 p-1 shadow-inner backdrop-blur-sm">
      <div
        className="absolute bottom-1 top-1 w-[calc(50%-4px)] rounded-lg bg-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all duration-300 ease-out"
        style={{ left: mode === 'login' ? '4px' : 'calc(50%)' }}
      />

      <button
        type="button"
        onClick={() => setMode('login')}
        className={`relative z-10 w-1/2 py-2.5 text-sm font-semibold transition-colors duration-300 ${
          mode === 'login' ? 'text-[#102a72]' : 'text-slate-500 hover:text-slate-700'
        }`}
      >
        Entrar
      </button>
      <button
        type="button"
        onClick={() => setMode('register')}
        className={`relative z-10 w-1/2 py-2.5 text-sm font-semibold transition-colors duration-300 ${
          mode === 'register' ? 'text-[#102a72]' : 'text-slate-500 hover:text-slate-700'
        }`}
      >
        Criar conta
      </button>
    </div>
  )
}

export default function AuthPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, register } = useAuth()
  const [mode, setMode] = useState('login')
  const [loginForm, setLoginForm] = useState(EMPTY_LOGIN)
  const [registerForm, setRegisterForm] = useState(EMPTY_REGISTER)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const redirectTo = useMemo(() => location.state?.from || '/projects', [location.state])
  const isRegisterRoute = location.pathname.endsWith('/register')

  useEffect(() => {
    setMode(isRegisterRoute ? 'register' : 'login')
  }, [isRegisterRoute])

  async function handleLoginSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    try {
      await login(loginForm)
      navigate(redirectTo, { replace: true })
    } catch (submitError) {
      setError(submitError.response?.data?.message || submitError.message || 'Não foi possível entrar.')
    } finally {
      setSaving(false)
    }
  }

  async function handleRegisterSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    try {
      await register(registerForm)
      navigate('/projects', { replace: true })
    } catch (submitError) {
      setError(submitError.response?.data?.message || submitError.message || 'Não foi possível criar a conta.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-[#102a72] selection:text-white">
      <div className="flex w-full flex-col justify-center px-6 py-12 lg:w-6/12 lg:px-16 xl:px-24">
        <div className="mx-auto w-full max-w-[440px]">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="text-left"
          >
            <div className="mb-10 inline-flex flex-col gap-3">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[#102a72] text-white shadow-lg">
                <Building2 className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900">Aligna</h2>
                <div className="mt-1 text-[12px] font-medium uppercase tracking-widest text-slate-500">Alignment Workspace</div>
              </div>
            </div>

            <TogglePill mode={mode} setMode={setMode} />

            <h1 className="mb-2 text-3xl font-bold tracking-tight text-slate-900">
              {mode === 'login' ? 'Bem-vindo de volta' : 'Crie sua conta'}
            </h1>
            <p className="text-[15px] font-medium text-slate-500">
              {mode === 'login'
                ? 'Entre para continuar no seu workspace.'
                : 'Crie sua conta e comece a organizar seus projetos com clareza.'}
            </p>
          </motion.div>

          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -10 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-6 overflow-hidden"
              >
                <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/50 p-4 text-[13px] font-medium text-rose-600 shadow-sm">
                  <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                  {error}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-10">
            <AnimatePresence mode="wait">
              {mode === 'login' ? (
                <motion.form
                  key="login-form"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  onSubmit={handleLoginSubmit}
                  className="space-y-2 text-left"
                >
                  <Field
                    icon={Mail}
                    label="E-mail"
                    type="email"
                    value={loginForm.email}
                    onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                    placeholder="voce@exemplo.com"
                  />
                  <Field
                    icon={Lock}
                    label="Senha"
                    type="password"
                    value={loginForm.password}
                    onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder="Sua senha"
                  />

                  <div className="flex items-center justify-between py-3 text-xs font-semibold">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" className="h-[18px] w-[18px] rounded border-slate-300 text-[#102a72] focus:ring-[#102a72]" />
                      <span className="text-slate-600">Lembrar-me</span>
                    </label>
                    <a href="#" className="text-[#102a72] transition-colors hover:text-[#17388f] hover:underline">
                      Esqueceu a senha?
                    </a>
                  </div>

                  <button
                    disabled={saving}
                    className="group relative mt-4 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-[#102a72] px-4 py-4 text-[15px] font-semibold tracking-wide text-white shadow-[0_4px_14px_0_rgba(16,42,114,0.39)] transition-all hover:-translate-y-0.5 hover:bg-[#0c205a] hover:shadow-[0_6px_20px_rgba(16,42,114,0.23)] disabled:pointer-events-none disabled:opacity-70"
                  >
                    {saving ? 'Acessando Aligna...' : 'Entrar'}
                    {!saving && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={3} />}
                  </button>

                  <p className="mt-6 text-center text-[13px] leading-relaxed text-slate-500">
                    Ainda não tem conta?{' '}
                    <button
                      type="button"
                      onClick={() => setMode('register')}
                      className="font-semibold text-[#102a72] hover:underline"
                    >
                      Criar conta
                    </button>
                  </p>
                </motion.form>
              ) : (
                <motion.form
                  key="register-form"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  onSubmit={handleRegisterSubmit}
                  className="space-y-2 text-left"
                >
                  <Field
                    icon={User}
                    label="Nome completo"
                    value={registerForm.name}
                    onChange={(event) => setRegisterForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="João Silva"
                  />
                  <Field
                    icon={Mail}
                    label="E-mail"
                    type="email"
                    value={registerForm.email}
                    onChange={(event) => setRegisterForm((current) => ({ ...current, email: event.target.value }))}
                    placeholder="joao@exemplo.com"
                  />
                  <Field
                    icon={Lock}
                    label="Senha"
                    type="password"
                    value={registerForm.password}
                    onChange={(event) => setRegisterForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder="No mínimo 8 caracteres"
                    helper="Use uma senha forte para proteger sua conta."
                  />

                  <button
                    disabled={saving}
                    className="group relative mt-4 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-[#102a72] px-4 py-4 text-[15px] font-semibold tracking-wide text-white shadow-[0_4px_14px_0_rgba(16,42,114,0.39)] transition-all hover:-translate-y-0.5 hover:bg-[#0c205a] hover:shadow-[0_6px_20px_rgba(16,42,114,0.23)] disabled:pointer-events-none disabled:opacity-70"
                  >
                    {saving ? 'Criando conta...' : 'Criar conta'}
                    {!saving && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={3} />}
                  </button>

                  <p className="mt-6 text-center text-[13px] leading-relaxed text-slate-500">
                    Já tem conta?{' '}
                    <button
                      type="button"
                      onClick={() => setMode('login')}
                      className="font-semibold text-[#102a72] hover:underline"
                    >
                      Entrar
                    </button>
                  </p>
                </motion.form>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="relative hidden w-full overflow-hidden bg-[#0A1128] lg:block lg:w-6/12">
        <div className="absolute inset-0 z-0">
          <img src={SIDE_IMAGE} alt="Abstract AI background" className="h-full w-full object-cover opacity-60 mix-blend-overlay" />
          <div className="absolute inset-0 bg-gradient-to-br from-[#102a72]/90 via-[#0A1128]/95 to-[#050B14]/95" />

          <div className="absolute -left-[20%] -top-[10%] h-[50%] w-[70%] rounded-full bg-[#3B82F6]/30 blur-[120px]" />
          <div className="absolute bottom-[10%] -right-[10%] h-[60%] w-[60%] rounded-full bg-[#102a72]/50 blur-[150px]" />
        </div>

        <div className="relative z-10 flex h-full flex-col justify-end p-12 text-white lg:p-16 xl:p-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
          >
            <div className="mb-6 inline-flex items-center rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-[#93c5fd] shadow-lg shadow-black/20 backdrop-blur-md">
              <span className="mr-2 flex h-2 w-2 animate-pulse rounded-full bg-[#60a5fa]" />
              Workspace conectado
            </div>
            <h2 className="mb-5 text-[2.5rem] font-bold tracking-tight drop-shadow-md lg:text-[3rem] xl:text-[3.5rem]">
              Inteligência que <br />
              <span className="bg-gradient-to-r from-blue-300 to-blue-100 bg-clip-text text-transparent">organiza seu produto.</span>
            </h2>
            <p className="max-w-[480px] text-lg font-medium leading-relaxed tracking-wide text-blue-50/80">
              Gerencie requisitos de negócio, alinhe decisões e acompanhe a evolução do seu produto.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.8 }}
            className="mt-12 flex flex-wrap gap-3"
          >
            {['Engenharia', 'Qualidade', 'Entregas'].map((badge) => (
              <div
                key={badge}
                className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold tracking-wider text-white shadow-xl shadow-black/10 transition-all hover:bg-white/10"
              >
                {badge}
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </div>
  )
}
