# -*- coding: utf-8 -*-
"""
Project Builder - Gera arquivos reais de um projeto completo
"""

import os
import json
import shutil
import sys

# Obter diretório raiz do projeto para caminhos absolutos
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(script_dir)

# Importar geradores
from orchestrator.backendGenerator import BackendGenerator
from orchestrator.frontendGenerator import FrontendGenerator

class ProjectBuilder:
    """Constrói um projeto real com estrutura de arquivos"""
    
    def __init__(self, project_id, output_dir=None):
        self.project_id = project_id
        # Usar caminho absoluto se não for especificado
        if output_dir is None:
            output_dir = os.path.join(project_root, 'outputs/projects')
        self.output_dir = output_dir
        self.project_path = os.path.join(output_dir, project_id)
    
    def create_directories(self):
        """Cria a estrutura de diretórios"""
        
        dirs = [
            'frontend',
            'frontend/src',
            'frontend/src/components',
            'frontend/src/pages',
            'frontend/src/services',
            'frontend/src/hooks',
            'frontend/public',
            'backend',
            'backend/src',
            'backend/src/routes',
            'backend/src/controllers',
            'backend/src/models',
            'backend/src/middleware',
            'backend/src/utils',
            'docs',
        ]
        
        for dir_path in dirs:
            full_path = os.path.join(self.project_path, dir_path)
            os.makedirs(full_path, exist_ok=True)
            print(f"[MKDIR] {dir_path}", file=__import__('sys').stderr)
    
    def create_frontend_files(self):
        """Cria arquivos do frontend"""
        
        # package.json
        package_json = {
            "name": f"projeto-{self.project_id}",
            "version": "1.0.0",
            "type": "module",
            "scripts": {
                "dev": "vite",
                "build": "vite build",
                "preview": "vite preview",
                "lint": "eslint src"
            },
            "dependencies": {
                "react": "^18.2.0",
                "react-dom": "^18.2.0",
                "react-router-dom": "^6.20.0",
                "axios": "^1.6.0",
                "react-markdown": "^9.0.0",
                "remark-gfm": "^4.0.0"
            },
            "devDependencies": {
                "vite": "^5.0.0",
                "@vitejs/plugin-react": "^4.2.0",
                "tailwindcss": "^3.3.0",
                "postcss": "^8.4.0",
                "autoprefixer": "^10.4.0"
            }
        }
        
        with open(f'{self.project_path}/frontend/package.json', 'w', encoding='utf-8') as f:
            json.dump(package_json, f, indent=2, ensure_ascii=False)
        print("[CREATE] frontend/package.json", file=__import__('sys').stderr)
        
        # vite.config.js
        vite_config = """import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
})
"""
        with open(f'{self.project_path}/frontend/vite.config.js', 'w', encoding='utf-8') as f:
            f.write(vite_config)
        print("[CREATE] frontend/vite.config.js", file=__import__('sys').stderr)
        
        # .gitignore
        gitignore = """node_modules
dist
.env
.env.local
.DS_Store
*.log
*.swp
.vscode
.idea
"""
        with open(f'{self.project_path}/frontend/.gitignore', 'w', encoding='utf-8') as f:
            f.write(gitignore)
        
        # src/App.jsx
        app_jsx = """import { useState } from 'react'
import axios from 'axios'

export default function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleFetchData = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await axios.get('/api/health')
      setData(response.data)
    } catch (err) {
      setError('Erro ao conectar com o backend')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl p-8 max-w-md w-full">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">Seu Projeto</h1>
        
        <button
          onClick={handleFetchData}
          disabled={loading}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 rounded transition disabled:opacity-50"
        >
          {loading ? 'Testando...' : 'Testar Backend'}
        </button>

        {error && <div className="mt-4 p-3 bg-red-100 text-red-700 rounded">{error}</div>}
        {data && (
          <div className="mt-4 p-3 bg-green-100 text-green-700 rounded">
            <p>Backend OK! Status: {data.status}</p>
          </div>
        )}
      </div>
    </div>
  )
}
"""
        with open(f'{self.project_path}/frontend/src/App.jsx', 'w', encoding='utf-8') as f:
            f.write(app_jsx)
        print("[CREATE] frontend/src/App.jsx", file=__import__('sys').stderr)
        
        # src/main.jsx
        main_jsx = """import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
"""
        with open(f'{self.project_path}/frontend/src/main.jsx', 'w', encoding='utf-8') as f:
            f.write(main_jsx)
        print("[CREATE] frontend/src/main.jsx", file=__import__('sys').stderr)
        
        # src/index.css
        index_css = """* {
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
  background-color: #f5f5f5;
}

code {
  font-family: source-code-pro, Menlo, Monaco, Consolas, 'Courier New',
    monospace;
}

html, body, #root {
  width: 100%;
  height: 100%;
}

main {
  min-height: 100vh;
  padding: 2rem;
}
"""
        with open(f'{self.project_path}/frontend/src/index.css', 'w', encoding='utf-8') as f:
            f.write(index_css)
        print("[CREATE] frontend/src/index.css", file=__import__('sys').stderr)
        
        # index.html
        index_html = """<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Seu Projeto</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
"""
        with open(f'{self.project_path}/frontend/index.html', 'w', encoding='utf-8') as f:
            f.write(index_html)
        print("[CREATE] frontend/index.html", file=__import__('sys').stderr)
    
    def create_backend_files(self):
        """Cria arquivos do backend"""
        
        # package.json
        package_json = {
            "name": f"projeto-{self.project_id}-backend",
            "version": "1.0.0",
            "type": "module",
            "main": "src/server.js",
            "scripts": {
                "start": "node src/server.js",
                "dev": "node --watch src/server.js",
                "test": "echo \\\"Error: no test specified\\\" && exit 1"
            },
            "dependencies": {
                "express": "^4.18.0",
                "cors": "^2.8.5",
                "dotenv": "^16.3.0",
                "uuid": "^9.0.0"
            },
            "devDependencies": {
                "nodemon": "^3.0.0"
            }
        }
        
        with open(f'{self.project_path}/backend/package.json', 'w', encoding='utf-8') as f:
            json.dump(package_json, f, indent=2, ensure_ascii=False)
        print("[CREATE] backend/package.json", file=__import__('sys').stderr)
        
        # src/server.js
        server_js = """import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config()
const app = express()
const PORT = process.env.PORT || 3001
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

// Middleware
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) {
        return callback(null, true)
      }

      return callback(new Error(`Origin not allowed: ${origin}`))
    },
    credentials: true,
  })
)
app.use(express.json({ limit: '1mb' }))

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK',
    message: 'Backend rodando com sucesso!',
    timestamp: new Date().toISOString()
  })
})

// Exemplo de rota
app.get('/api/info', (req, res) => {
  res.json({
    name: 'Seu Projeto',
    version: '1.0.0',
    description: 'Projeto gerado por AI Software Factory'
  })
})

// Tratamento de erros
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'Erro interno do servidor' })
})

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' })
})

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`)
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`)
})
"""
        with open(f'{self.project_path}/backend/src/server.js', 'w', encoding='utf-8') as f:
            f.write(server_js)
        print("[CREATE] backend/src/server.js", file=__import__('sys').stderr)
        
        # .env.example
        env_example = """PORT=3001
NODE_ENV=development
FRONTEND_ORIGIN=http://localhost:5173
DATABASE_URL=
"""
        with open(f'{self.project_path}/backend/.env.example', 'w', encoding='utf-8') as f:
            f.write(env_example)
        
        # .gitignore
        gitignore = """node_modules
.env
.env.local
.DS_Store
*.log
*.swp
.vscode
.idea
"""
        with open(f'{self.project_path}/backend/.gitignore', 'w', encoding='utf-8') as f:
            f.write(gitignore)
    
    def create_documentation(self, idea, backlog, requirements, architecture, code, tests):
        """Cria arquivos de documentação"""
        
        # README.md
        readme = f"""# {self.project_id.replace('-', ' ').title()}

## Descrição
{idea}

## Como Rodar

### Pré-requisitos
- Node.js 18+
- npm ou yarn

### Backend
```bash
cd backend
npm install
npm run dev
```

O backend rodará em: http://localhost:3001

### Frontend
```bash
cd frontend
npm install
npm run dev
```

O frontend rodará em: http://localhost:5173

## Endpoints da API

- **GET** `/api/health` - Verificar status do servidor
- **GET** `/api/info` - Informações do projeto

## Estrutura de Pastas

```
projeto/
├── frontend/          # Aplicação React
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── services/
│   └── package.json
├── backend/           # Servidor Node.js
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   └── models/
│   └── package.json
└── docs/              # Documentação
```

## Stack Tecnológico

- **Frontend**: React 18 + Vite + TailwindCSS
- **Backend**: Node.js + Express
- **HTTP Client**: Axios

## Próximas Passos

1. Instalar dependências: `npm install`
2. Configurar variáveis de ambiente
3. Implementar rotas adicionais
4. Adicionar banco de dados
5. Testes automatizados

---

Gerado por [AI Software Factory](https://github.com/seu-usuario/ai-software-factory)
"""
        with open(f'{self.project_path}/README.md', 'w', encoding='utf-8') as f:
            f.write(readme)
        print("[CREATE] README.md", file=__import__('sys').stderr)
        
        # Salva todos os artefatos gerados pela IA na pasta /docs
        docs_path = os.path.join(self.project_path, 'docs')
        os.makedirs(docs_path, exist_ok=True)

        artifacts_to_save = {
            "BACKLOG.md": backlog,
            "REQUIREMENTS.md": requirements,
            "ARCHITECTURE.md": architecture,
            "CODE_STRUCTURE.md": code,
            "TESTS.md": tests
        }
        
        for filename, content in artifacts_to_save.items():
            filepath = os.path.join(docs_path, filename)
            try:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(content or f"# Conteúdo para {filename} não foi gerado.\n")
                print(f"[CREATE] docs/{filename}", file=__import__('sys').stderr)
            except Exception as e:
                print(f"[ERROR] Falha ao escrever docs/{filename}: {e}", file=__import__('sys').stderr)

    
    def create_project(self, idea, backlog, requirements, architecture, code, tests, primary_entity="Task", attributes=None):
        """Cria o projeto completo com código funcional"""
        
        print(f"[BUILD] Criando projeto: {self.project_id}", file=sys.stderr)
        
        # Criar diretórios
        self.create_directories()
        
        # Gerar backend funcional
        print(f"[BACKEND] Gerando servidor Express para entidade: {primary_entity}...", file=sys.stderr)
        backend_gen = BackendGenerator(self.project_path, primary_entity, attributes)
        backend_gen.generate()
        
        # Gerar frontend funcional
        print(f"[FRONTEND] Gerando aplicação React para entidade: {primary_entity}...", file=sys.stderr)
        frontend_gen = FrontendGenerator(self.project_path, primary_entity, attributes)
        frontend_gen.generate()
        
        # Criar documentação
        self.create_documentation(idea, backlog, requirements, architecture, code, tests)
        
        print(f"[SUCCESS] Projeto criado em: {self.project_path}", file=sys.stderr)
        
        return self.project_path
