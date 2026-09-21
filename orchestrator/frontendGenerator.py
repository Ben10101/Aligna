# -*- coding: utf-8 -*-
"""
Frontend Generator - Cria aplicação React funcional completa
"""

import os
import json

class FrontendGenerator:
    """Gera um frontend React funcional"""
    
    def __init__(self, project_path, primary_entity="Task", attributes=None):
        self.project_path = project_path
        self.frontend_path = os.path.join(project_path, 'frontend')
        self.entity = primary_entity
        self.entity_lower = primary_entity.lower()
        self.entity_plural = f"{self.entity_lower}s"
        self.page_name = f"{self.entity}sPage"
        self.attributes = attributes if attributes else [
            {'name': 'title', 'type': 'string'}, 
            {'name': 'description', 'type': 'text'}
        ]
    
    def create_app_jsx(self):
        """Cria App.jsx funcional"""
        app_jsx = f"""import {{ Suspense, lazy, useState, useEffect }} from 'react'
import {{ BrowserRouter as Router, Routes, Route, Navigate }} from 'react-router-dom'
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const {self.page_name} = lazy(() => import('./pages/{self.page_name}'))
import './App.css'

function RouteLoadingFallback() {{
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-600">Carregando</p>
        <p className="mt-2 text-sm text-slate-600">Preparando a proxima tela do projeto gerado...</p>
      </div>
    </div>
  )
}}

const routeLoadingFallback = <RouteLoadingFallback />

export default function App() {{
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {{
    // Verificar se usuário está logado
    const token = localStorage.getItem('token')
    const userData = localStorage.getItem('user')
    
    if (token && userData) {{
      setUser(JSON.parse(userData))
    }}
    setLoading(false)
  }}, [])

  const handleLogin = (userData, token) => {{
    setUser(userData)
    localStorage.setItem('user', JSON.stringify(userData))
    localStorage.setItem('token', token)
  }}

  const handleLogout = () => {{
    setUser(null)
    localStorage.removeItem('user')
    localStorage.removeItem('token')
  }}

  if (loading) {{
    return <div className="flex items-center justify-center min-h-screen">Carregando...</div>
  }}

  return (
    <Router>
      <Suspense fallback={{routeLoadingFallback}}>
        <Routes>
          <Route path="/login" element={{
            user ? <Navigate to="/" /> : <LoginPage onLogin={{handleLogin}} />
          }} />
          
          <Route path="/register" element={{
            user ? <Navigate to="/" /> : <RegisterPage onRegister={{handleLogin}} />
          }} />
          
          <Route path="/" element={{
            user ? <{self.page_name} user={{user}} onLogout={{handleLogout}} /> : <Navigate to="/login" />
          }} />
        </Routes>
      </Suspense>
    </Router>
  )
}}
"""
        with open(f'{self.frontend_path}/src/App.jsx', 'w', encoding='utf-8') as f:
            f.write(app_jsx)
        print('[CREATE] frontend/src/App.jsx', file=__import__('sys').stderr)

    def create_login_page(self):
        """Cria página de login"""
        login_page = """import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import axios from 'axios'

const API_URL = 'http://localhost:3001/api'

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await axios.post(`${API_URL}/auth/login`, {
        email,
        password
      })

      const { user, token } = response.data
      onLogin(user, token)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao fazer login')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-2xl">
        <h1 className="mb-6 text-3xl font-bold text-gray-800">Login</h1>

        {error && (
          <div className="mb-4 rounded bg-red-100 p-3 text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-gray-300 px-4 py-2"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-gray-300 px-4 py-2"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-blue-500 py-2 text-white font-semibold hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p className="mt-4 text-center text-gray-600">
          Não tem conta?{' '}
          <Link to="/register" className="text-blue-500 hover:underline">
            Registre-se
          </Link>
        </p>
      </div>
    </div>
  )
}
"""
        with open(f'{self.frontend_path}/src/pages/LoginPage.jsx', 'w', encoding='utf-8') as f:
            f.write(login_page)
        print('[CREATE] frontend/src/pages/LoginPage.jsx', file=__import__('sys').stderr)

    def create_register_page(self):
        """Cria página de registro"""
        register_page = """import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import axios from 'axios'

const API_URL = 'http://localhost:3001/api'

export default function RegisterPage({ onRegister }) {
  const [formData, setFormData] = useState({ email: '', password: '', name: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await axios.post(`${API_URL}/auth/register`, formData)
      const { user, token } = response.data
      onRegister(user, token)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao registrar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-2xl">
        <h1 className="mb-6 text-3xl font-bold text-gray-800">Registrar</h1>

        {error && (
          <div className="mb-4 rounded bg-red-100 p-3 text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Nome</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="w-full rounded border border-gray-300 px-4 py-2"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className="w-full rounded border border-gray-300 px-4 py-2"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Senha</label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              className="w-full rounded border border-gray-300 px-4 py-2"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-blue-500 py-2 text-white font-semibold hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? 'Registrando...' : 'Registrar'}
          </button>
        </form>

        <p className="mt-4 text-center text-gray-600">
          Já tem conta?{' '}
          <Link to="/login" className="text-blue-500 hover:underline">
            Faça login
          </Link>
        </p>
      </div>
    </div>
  )
}
"""
        with open(f'{self.frontend_path}/src/pages/RegisterPage.jsx', 'w', encoding='utf-8') as f:
            f.write(register_page)
        print('[CREATE] frontend/src/pages/RegisterPage.jsx', file=__import__('sys').stderr)

    def create_entity_page(self):
        """Cria página da entidade principal"""
        # Gera o estado inicial do formulário com base nos atributos
        initial_state_fields = ", ".join([f"{attr['name']}: ''" for attr in self.attributes])
        initial_state = f"{{ {initial_state_fields}, priority: 'medium' }}"

        # Gera os inputs do formulário dinamicamente
        form_inputs = ""
        for i, attr in enumerate(self.attributes):
            placeholder = attr['name'].replace('_', ' ').title()
            input_type = "text"
            if attr['type'] in ['decimal', 'integer', 'number']:
                input_type = 'number'
            
            # Define o primeiro campo como obrigatório
            is_required = "required" if i == 0 else ""

            if attr['type'] == 'text':
                form_inputs += f"""
            <div>
              <textarea
                placeholder="{placeholder}"
                value={{newItem.{attr['name']}}}
                onChange={{(e) => setNewItem({{ ...newItem, {attr['name']}: e.target.value }})}}
                className="w-full rounded border border-gray-300 px-4 py-2"
                rows="3"
              />
            </div>"""
            else:
                form_inputs += f"""
            <div>
              <input
                type="{input_type}"
                placeholder="{placeholder}"
                value={{newItem.{attr['name']}}}
                onChange={{(e) => setNewItem({{ ...newItem, {attr['name']}: e.target.value }})}}
                className="w-full rounded border border-gray-300 px-4 py-2"
                {is_required}
              />
            </div>"""
            
        # --- Conditional UI Generation ---
        has_priority = any(attr['name'] == 'priority' for attr in self.attributes)
        has_status = any(attr['name'] == 'status' for attr in self.attributes)

        priority_select_jsx = ""
        if has_priority:
            priority_select_jsx = f"""
              <select
                value={{newItem.priority}}
                onChange={{(e) => setNewItem({{ ...newItem, priority: e.target.value }})}}
                className="rounded border border-gray-300 px-4 py-2"
              >
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
              </select>
            """

        status_badge_jsx = ""
        status_button_jsx = ""
        if has_status:
            status_badge_jsx = f"""
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800">
                        {{item.status === 'completed' ? '✅ Completa' : '⏳ Ativa'}}
                      </span>
            """
            status_button_jsx = f"""
                    <button
                      onClick={{() => handleUpdateItem(item.id, {{ status: item.status === 'completed' ? 'active' : 'completed' }})}}
                      className="w-full rounded bg-green-500 px-3 py-1 text-sm text-white hover:bg-green-600"
                    >
                      {{item.status === 'completed' ? 'Reabrir' : 'Completar'}}
                    </button>
            """

        priority_badge_jsx = ""
        if has_priority:
            priority_badge_jsx = f"""
                      <span className={{`rounded-full px-3 py-1 text-sm font-medium ${{getPriorityColor(item.priority)}}`}}>
                        {{item.priority === 'low' ? '🟢 Baixa' : item.priority === 'medium' ? '🟡 Média' : '🔴 Alta'}}
                      </span>
            """

        # Identificar campos para exibição na lista (Dinâmico)
        main_field = self.attributes[0]['name']
        sub_field = self.attributes[1]['name'] if len(self.attributes) > 1 else None
        sub_field_jsx = ""
        
        if sub_field:
            sub_field_jsx = f"""{{item.{sub_field} && (
                      <p className="mt-2 text-gray-600">{{item.{sub_field}}}</p>
                    )}}"""
                    
        # --- Geração de UI Condicional para Stats ---
        stats_jsx = ""
        if has_status:
            stats_jsx = f"""
        <div className="mt-8 grid grid-cols-3 gap-4">
          <div className="rounded-lg bg-white p-6 shadow text-center">
            <p className="text-3xl font-bold text-blue-500">{{items.length}}</p>
            <p className="text-gray-600">Total</p>
          </div>
          <div className="rounded-lg bg-white p-6 shadow text-center">
            <p className="text-3xl font-bold text-green-500">{{items.filter(t => t.status === 'completed').length}}</p>
            <p className="text-gray-600">Completas</p>
          </div>
          <div className="rounded-lg bg-white p-6 shadow text-center">
            <p className="text-3xl font-bold text-yellow-500">{{items.filter(t => t.status !== 'completed').length}}</p>
            <p className="text-gray-600">Ativas</p>
          </div>
        </div>"""
        else:
            stats_jsx = f"""
        <div className="mt-8 grid grid-cols-1 gap-4">
          <div className="rounded-lg bg-white p-6 shadow text-center">
            <p className="text-3xl font-bold text-blue-500">{{items.length}}</p>
            <p className="text-gray-600">Total de Itens</p>
          </div>
        </div>"""

        # Helpers condicionais para estilização
        priority_helpers = """
  const getPriorityColor = (priority) => {
    const colors = {
      low: 'bg-green-100 text-green-800',
      medium: 'bg-yellow-100 text-yellow-800',
      high: 'bg-red-100 text-red-800'
    }
    return colors[priority] || 'bg-gray-100'
  }""" if has_priority else ""

        status_helpers = """
  const getStatusColor = (status) => {
    return status === 'completed' ? 'line-through text-gray-500' : ''
  }""" if has_status else "  const getStatusColor = () => '';"

        page_content = f"""import {{ useState, useEffect }} from 'react'
import axios from 'axios'

const API_URL = 'http://localhost:3001/api'

export default function {self.page_name}({{ user, onLogout }}) {{
  const [items, setItems] = useState([])
  const [newItem, setNewItem] = useState({initial_state})
  const [loading, setLoading] = useState(false)
  const token = localStorage.getItem('token')

  const axiosConfig = {{
    headers: {{ Authorization: `Bearer ${{token}}` }}
  }}

  useEffect(() => {{
    fetchItems()
  }}, [])

  const fetchItems = async () => {{
    try {{
      const response = await axios.get(`${{API_URL}}/{self.entity_plural}`, axiosConfig)
      setItems(response.data.data || [])
    }} catch (err) {{
      console.error('Erro ao carregar dados:', err)
    }}
  }}

  const handleCreateItem = async (e) => {{
    e.preventDefault()
    if (!newItem.{main_field}) return

    setLoading(true)
    try {{
      const response = await axios.post(`${{API_URL}}/{self.entity_plural}`, newItem, axiosConfig)
      setItems([response.data.{self.entity_lower}, ...items])
      setNewItem({initial_state})
    }} catch (err) {{
      console.error('Erro ao criar:', err)
    }} finally {{
      setLoading(false)
    }}
  }}

  const handleUpdateItem = async (id, updates) => {{
    try {{
      const itemToUpdate = items.find(t => t.id === id)
      await axios.put(`${{API_URL}}/{self.entity_plural}/${{id}}`, {{ ...itemToUpdate, ...updates }}, axiosConfig)
      setItems(items.map(t => t.id === id ? {{ ...t, ...updates }} : t))
    }} catch (err) {{
      console.error('Erro ao atualizar:', err)
    }}
  }}

  const handleDeleteItem = async (id) => {{
    if (!window.confirm('Tem certeza?')) return

    try {{
      await axios.delete(`${{API_URL}}/{self.entity_plural}/${{id}}`, axiosConfig)
      setItems(items.filter(t => t.id !== id))
    }} catch (err) {{
      console.error('Erro ao deletar:', err)
    }}
  }}
{priority_helpers}
{status_helpers}
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50">
      {{/* Header */}}
      <header className="bg-white shadow">
        <div className="mx-auto max-w-6xl px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Meus {self.entity_plural.title()}s</h1>
            <p className="text-gray-600">Bem-vindo, {{user.name}}! 👋</p>
          </div>
          <button
            onClick={{onLogout}}
            className="rounded bg-red-500 px-4 py-2 text-white hover:bg-red-600"
          >
            Logout
          </button>
        </div>
      </header>

      {{/* Main content */}}
      <main className="mx-auto max-w-6xl px-6 py-8">
        {{/* Create task form */}}
        <div className="mb-8 rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-xl font-bold text-gray-900">Novo(a) {self.entity}</h2>
          <form onSubmit={{handleCreateItem}} className="space-y-4">
            {form_inputs}
            <div className="flex items-center gap-4">
              {priority_select_jsx}
              <button
                type="submit"
                disabled={{loading}}
                className="flex-1 rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {{loading ? 'Criando...' : 'Criar'}}
              </button>
            </div>
          </form>
        </div>

        {{/* Tasks list */}}
        <div className="space-y-4">
          {{items.length === 0 ? (
            <div className="rounded-lg bg-white p-12 text-center shadow">
              <p className="text-gray-500">Nenhum item ainda. Crie um para começar! 🚀</p>
            </div>
          ) : (
            items.map(item => (
              <div key={{item.id}} className="rounded-lg bg-white p-6 shadow hover:shadow-lg transition">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className={{`text-lg font-semibold text-gray-900 ${{getStatusColor(item.status)}}`}}>
                      {{item.{main_field}}}
                    </h3>
                    {sub_field_jsx}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {priority_badge_jsx}
                      {status_badge_jsx}
                    </div>
                  </div>

                  {{/* Actions */}}
                  <div className="ml-4 flex flex-col space-y-2">
                    {status_button_jsx}
                    <button
                      onClick={{() => handleDeleteItem(item.id)}}
                      className="w-full rounded bg-red-500 px-3 py-1 text-sm text-white hover:bg-red-600"
                    >
                      Deletar
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}}
        </div>

        {{/* Stats Condicionais */}}
        {stats_jsx}
      </main>
    </div>
  )
}}
"""
        with open(f'{self.frontend_path}/src/pages/{self.page_name}.jsx', 'w', encoding='utf-8') as f:
            f.write(page_content)
        print(f'[CREATE] frontend/src/pages/{self.page_name}.jsx', file=__import__('sys').stderr)

    def create_package_json(self):
        """Cria package.json"""
        package = {
          "name": "projeto-frontend",
          "private": True,
          "version": "1.0.0",
          "type": "module",
          "scripts": {
            "dev": "vite",
            "build": "vite build",
            "preview": "vite preview"
          },
          "dependencies": {
            "react": "^18.2.0",
            "react-dom": "^18.2.0",
            "react-router-dom": "^6.8.0",
            "axios": "^1.3.0"
          },
          "devDependencies": {
            "@types/react": "^18.0.24",
            "@types/react-dom": "^18.0.8",
            "@vitejs/plugin-react": "^3.1.0",
            "vite": "^4.5.0",
            "tailwindcss": "^3.3.0",
            "postcss": "^8.4.24",
            "autoprefixer": "^10.4.14"
          }
        }

        with open(f'{self.frontend_path}/package.json', 'w', encoding='utf-8') as f:
            json.dump(package, f, indent=2)
        print('[CREATE] frontend/package.json', file=__import__('sys').stderr)

    def create_tailwind_config(self):
        """Cria tailwind.config.js"""
        config = """export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
"""
        with open(f'{self.frontend_path}/tailwind.config.js', 'w', encoding='utf-8') as f:
            f.write(config)
        print('[CREATE] frontend/tailwind.config.js', file=__import__('sys').stderr)

    def create_css(self):
        """Cria App.css com TailwindCSS"""
        css = """@tailwind base;
@tailwind components;
@tailwind utilities;

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

html, body, #root {
  width: 100%;
  height: 100%;
}
"""
        with open(f'{self.frontend_path}/src/App.css', 'w', encoding='utf-8') as f:
            f.write(css)
        print('[CREATE] frontend/src/App.css', file=__import__('sys').stderr)

    def create_vite_config(self):
        """Cria vite.config.js"""
        vite_config = """import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: 'localhost'
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('react-router-dom')) return 'router'
          if (id.includes('react') || id.includes('scheduler')) return 'react-vendor'
        }
      }
    }
  }
})
"""
        with open(f'{self.frontend_path}/vite.config.js', 'w', encoding='utf-8') as f:
            f.write(vite_config)
        print('[CREATE] frontend/vite.config.js', file=__import__('sys').stderr)

    def create_postcss_config(self):
        """Cria postcss.config.js"""
        postcss_config = """export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
"""
        with open(f'{self.frontend_path}/postcss.config.js', 'w', encoding='utf-8') as f:
            f.write(postcss_config)
        print('[CREATE] frontend/postcss.config.js', file=__import__('sys').stderr)

    def create_main_jsx(self):
        """Cria main.jsx"""
        main_jsx = """import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
"""
        with open(f'{self.frontend_path}/src/main.jsx', 'w', encoding='utf-8') as f:
            f.write(main_jsx)
        print('[CREATE] frontend/src/main.jsx', file=__import__('sys').stderr)

    def create_index_html(self):
        """Cria index.html"""
        index_html = """<!doctype html>
<html lang="pt-br">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Task Management</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
"""
        with open(f'{self.frontend_path}/index.html', 'w', encoding='utf-8') as f:
            f.write(index_html)
        print('[CREATE] frontend/index.html', file=__import__('sys').stderr)

    def create_gitignore(self):
        """Cria .gitignore"""
        gitignore = """# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

node_modules
dist
dist-ssr
*.local

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
"""
        with open(f'{self.frontend_path}/.gitignore', 'w', encoding='utf-8') as f:
            f.write(gitignore)
        print('[CREATE] frontend/.gitignore', file=__import__('sys').stderr)

    def generate(self):
        """Gera todo o frontend funcional"""
        import os
        os.makedirs(f'{self.frontend_path}/src/pages', exist_ok=True)
        os.makedirs(f'{self.frontend_path}/src/hooks', exist_ok=True)
        os.makedirs(f'{self.frontend_path}/src/services', exist_ok=True)
        
        self.create_vite_config()
        self.create_postcss_config()
        self.create_index_html()
        self.create_main_jsx()
        self.create_package_json()
        self.create_tailwind_config()
        self.create_css()
        self.create_app_jsx()
        self.create_login_page()
        self.create_register_page()
        self.create_entity_page()
        self.create_gitignore()
