# -*- coding: utf-8 -*-
"""
Backend Generator - Cria servidor Express funcional e completo
"""

import os
import json

class BackendGenerator:
    """Gera um backend Express funcional"""
    
    def __init__(self, project_path, primary_entity="Task", attributes=None):
        self.project_path = project_path
        self.backend_path = os.path.join(project_path, 'backend')
        self.entity = primary_entity
        self.entity_lower = primary_entity.lower()
        self.entity_plural = f"{self.entity_lower}s"
        self.table_name = self.entity_plural
        self.attributes = attributes if attributes else [
            {'name': 'title', 'sql_type': 'VARCHAR(255) NOT NULL'}, 
            {'name': 'description', 'sql_type': 'TEXT'}
        ]
    
    def create_server(self):
        """Cria server.js funcional"""
        # Geração de código dinâmico para SQL e API
        sql_columns = ",\n      ".join([f"{attr['name']} {attr['sql_type']}" for attr in self.attributes])
        api_body_fields = ", ".join([attr['name'] for attr in self.attributes])
        insert_fields = ", ".join([attr['name'] for attr in self.attributes])
        insert_placeholders = ", ".join(['?'] * len(self.attributes))
        insert_params_js = ", ".join([f"req.body.{attr['name']} || null" for attr in self.attributes])
        update_set_clause = ", ".join([f"{attr['name']} = ?" for attr in self.attributes])
        update_params_js = ", ".join([f"req.body.{attr['name']}" for attr in self.attributes])

        # Geração de lógica de filtro dinâmica
        filter_logic = ""
        if any(attr['name'] == 'status' for attr in self.attributes):
            filter_logic += """
  if (status) {{
    query += ' AND status = ?';
    params.push(status);
  }}"""
        if any(attr['name'] == 'priority' for attr in self.attributes):
            filter_logic += """
  if (priority) {{
    query += ' AND priority = ?';
    params.push(priority);
  }}"""

        server_js = f"""import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import sqlite3 from 'sqlite3'
import bcryptjs from 'bcryptjs'
import jwt from 'jsonwebtoken'
import {{ fileURLToPath }} from 'url'
import {{ dirname }} from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {{
  throw new Error('JWT_SECRET must be configured before starting the backend')
}}
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

// Middleware
app.use(express.json({{ limit: '1mb' }}))
app.use(
  cors({{
    origin(origin, callback) {{
      if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) {{
        return callback(null, true)
      }}

      return callback(new Error(`Origin not allowed: ${{origin}}`))
    }},
    credentials: true,
  }})
)

// Database setup
const db = new sqlite3.Database('./data.db', (err) => {{
  if (err) {{
    console.error('❌ Database error:', err)
  }} else {{
    console.log('✅ Connected to SQLite database')
    initializeDatabase()
  }}
}})

function initializeDatabase() {{
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // {self.entity}s table
  db.run(`
    CREATE TABLE IF NOT EXISTS {self.table_name} (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      {sql_columns},
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `)
}}

// Helper functions
function generateId() {{
  return Math.random().toString(36).substr(2, 9)
}}

function verifyToken(req, res, next) {{
  const token = req.headers.authorization?.split(' ')[1]
  
  if (!token) {{
    return res.status(401).json({{ error: 'No token provided' }})
  }}

  try {{
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded
    next()
  }} catch (err) {{
    return res.status(401).json({{ error: 'Invalid token' }})
  }}
}}

// Routes

// Health check
app.get('/api/health', (req, res) => {{
  res.json({{ status: 'OK', timestamp: new Date() }})
}})

// Auth Routes

// Register
app.post('/api/auth/register', async (req, res) => {{
  try {{
    const {{ email, password, name }} = req.body

    if (!email || !password || !name) {{
      return res.status(400).json({{ error: 'Missing required fields' }})
    }}

    // Hash password
    const hashedPassword = await bcryptjs.hash(password, 10)
    const userId = generateId()

    db.run(
      'INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)',
      [userId, email, hashedPassword, name],
      function(err) {{
        if (err) {{
          if (err.message.includes('UNIQUE')) {{
            return res.status(400).json({{ error: 'Email already registered' }})
          }}
          return res.status(500).json({{ error: 'Error registering user' }})
        }}

        const token = jwt.sign({{ id: userId, email }}, JWT_SECRET, {{ expiresIn: '24h' }})
        res.status(201).json({{
          user: {{ id: userId, email, name }},
          token
        }})
      }}
    )
  }} catch (err) {{
    res.status(500).json({{ error: err.message }})
  }}
}})

// Login
app.post('/api/auth/login', (req, res) => {{
  try {{
    const {{ email, password }} = req.body

    if (!email || !password) {{
      return res.status(400).json({{ error: 'Email and password required' }})
    }}

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {{
      if (err) {{
        return res.status(500).json({{ error: 'Database error' }})
      }}

      if (!user) {{
        return res.status(401).json({{ error: 'Invalid credentials' }})
      }}

      const validPassword = await bcryptjs.compare(password, user.password)

      if (!validPassword) {{
        return res.status(401).json({{ error: 'Invalid credentials' }})
      }}

      const token = jwt.sign({{ id: user.id, email: user.email }}, JWT_SECRET, {{ expiresIn: '24h' }})
      res.json({{
        user: {{ id: user.id, email: user.email, name: user.name }},
        token
      }})
    }})
  }} catch (err) {{
    res.status(500).json({{ error: err.message }})
  }}
}})

// Get current user
app.get('/api/users/me', verifyToken, (req, res) => {{
  db.get('SELECT id, email, name, created_at FROM users WHERE id = ?', [req.user.id], (err, user) => {{
    if (err) {{
      return res.status(500).json({{ error: 'Database error' }})
    }}
    if (!user) {{
      return res.status(404).json({{ error: 'User not found' }})
    }}
    res.json({{ user }})
  }})
}})

// {self.entity} Routes

// Get all {self.entity_plural}
app.get('/api/{self.entity_plural}', verifyToken, (req, res) => {{
  const {{ status, priority }} = req.query
  
  let query = 'SELECT * FROM {self.table_name} WHERE user_id = ?'
  const params = [req.user.id]

  {filter_logic}
  query += ' ORDER BY created_at DESC'

  db.all(query, params, (err, tasks) => {{
    if (err) {{
      return res.status(500).json({{ error: 'Database error' }})
    }}
    res.json({{ data: tasks || [], total: tasks?.length || 0 }})
  }})
}})

// Get single {self.entity_lower}
app.get('/api/{self.entity_plural}/:id', verifyToken, (req, res) => {{
  db.get(
    'SELECT * FROM {self.table_name} WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id],
    (err, task) => {{
      if (err) {{
        return res.status(500).json({{ error: 'Database error' }})
      }}
      if (!task) {{
        return res.status(404).json({{ error: 'Task not found' }})
      }}
      res.json({{ task }})
    }}
  )
}})

// Create task
app.post('/api/{self.entity_plural}', verifyToken, (req, res) => {{
  try {{
    const {{ {api_body_fields} }} = req.body

    const mainField = `{self.attributes[0]['name']}`
    // Validação simples para o primeiro atributo
    if (!req.body[mainField]) {{
      return res.status(400).json({{ error: `${{mainField.charAt(0).toUpperCase() + mainField.slice(1)}} is required` }})
    }}

    const newId = generateId()
    const now = new Date().toISOString()
    const params = [newId, req.user.id, {insert_params_js}, now, now]

    db.run(
      'INSERT INTO {self.table_name} (id, user_id, {insert_fields}, created_at, updated_at) VALUES (?, ?, {insert_placeholders}, ?, ?)',
      params,
      function(err) {{
        if (err) {{
          return res.status(500).json({{ error: 'Error creating {self.entity_lower}' }})
        }}
        res.status(201).json({{
          {self.entity_lower}: {{
            id: newId,
            user_id: req.user.id,
            ...req.body,
            created_at: now,
            updated_at: now
          }}
        }})
      }}
    )
  }} catch (err) {{
    res.status(500).json({{ error: err.message }})
  }}
}})

// Update task
app.put('/api/{self.entity_plural}/:id', verifyToken, (req, res) => {{
  try {{
    const {{ {api_body_fields} }} = req.body
    const now = new Date().toISOString()
    const params = [{update_params_js}, now, req.params.id, req.user.id]

    db.run(
      'UPDATE {self.table_name} SET {update_set_clause}, updated_at = ? WHERE id = ? AND user_id = ?',
      params,
      function(err) {{
        if (err) {{
          return res.status(500).json({{ error: 'Error updating {self.entity_lower}' }})
        }}

        if (this.changes === 0) {{
          return res.status(404).json({{ error: '{self.entity} not found' }})
        }}

        res.json({{
          {self.entity_lower}: {{
            id: req.params.id,
            ...req.body,
            updated_at: now
          }}
        }})
      }}
    )
  }} catch (err) {{
    res.status(500).json({{ error: err.message }})
  }}
}})

// Delete task
app.delete('/api/{self.entity_plural}/:id', verifyToken, (req, res) => {{
  db.run(
    'DELETE FROM {self.table_name} WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id],
    function(err) {{
      if (err) {{
        return res.status(500).json({{ error: 'Error deleting {self.entity_lower}' }})
      }}

      if (this.changes === 0) {{
        return res.status(404).json({{ error: '{self.entity} not found' }})
      }}

      res.json({{ success: true }})
    }}
  )
}})

// Error handler
app.use((err, req, res, next) => {{
  console.error(err)
  res.status(500).json({{ error: 'Internal server error' }})
}})

// 404 handler
app.use((req, res) => {{
  res.status(404).json({{ error: 'Not found' }})
}})

app.listen(PORT, () => {{
  console.log(`✅ Backend running on http://localhost:${{PORT}}`)
  console.log(`📚 API Docs: http://localhost:${{PORT}}/api`)
}})

export default app
"""
        with open(f'{self.backend_path}/src/server.js', 'w', encoding='utf-8') as f:
            f.write(server_js)
        print('[CREATE] backend/src/server.js', file=__import__('sys').stderr)
    
    def create_env(self):
        """Cria .env.example"""
        env = """PORT=3001
JWT_SECRET=change-me-to-a-long-random-secret
FRONTEND_ORIGIN=http://localhost:5173
NODE_ENV=development
DATABASE_URL=./data.db
"""
        with open(f'{self.backend_path}/.env.example', 'w', encoding='utf-8') as f:
            f.write(env)
        print('[CREATE] backend/.env.example', file=__import__('sys').stderr)

    def create_package_json(self):
        """Cria package.json correto"""
        package = {
            "name": "projeto-backend",
            "version": "1.0.0",
            "type": "module",
            "description": "Backend API com Express e SQLite",
            "main": "src/server.js",
            "scripts": {
                "start": "node src/server.js",
                "dev": "nodemon src/server.js",
                "test": 'echo "Error: no test specified" && exit 1'
            },
            "keywords": ["api", "express", "sqlite"],
            "author": "",
            "license": "MIT",
            "dependencies": {
                "express": "^4.18.2",
                "cors": "^2.8.5",
                "bcryptjs": "^2.4.3",
                "jsonwebtoken": "^9.0.0",
                "sqlite3": "^5.1.6",
                "dotenv": "^16.0.3"
            },
            "devDependencies": {
                "nodemon": "^2.0.22"
            }
        }
        
        with open(f'{self.backend_path}/package.json', 'w', encoding='utf-8') as f:
            json.dump(package, f, indent=2)
        print('[CREATE] backend/package.json', file=__import__('sys').stderr)

    def generate(self):
        """Gera todo o backend funcional"""
        self.create_package_json()
        self.create_env()
        self.create_server()
