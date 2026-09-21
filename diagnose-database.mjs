#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import net from 'net';

console.log('🔍 Diagnóstico de Banco de Dados\n');
console.log(`⏱️  Hora: ${new Date().toLocaleString('pt-BR')}\n`);

async function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2000);

    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(true);
    });

    socket.once('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });

    socket.connect(port, 'localhost');
  });
}

async function checkDocker() {
  return new Promise((resolve) => {
    const child = spawn('docker', ['ps'], { stdio: 'pipe' });
    let output = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      resolve(code === 0 && output.includes('mysql'));
    });

    setTimeout(() => {
      child.kill();
      resolve(false);
    }, 3000);
  });
}

async function checkEnvFile() {
  try {
    const envPath = '.env';
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const match = content.match(/DATABASE_URL=(.+)/);
      return match ? match[1] : null;
    }
  } catch (e) {
    return null;
  }
}

async function diagnose() {
  console.log('📊 Verificando Banco de Dados...\n');

  // Check environment
  const dbUrl = await checkEnvFile();
  console.log(`📝 DATABASE_URL: ${dbUrl || '(não encontrado)'}`);

  // Check port 3306
  const port3306Open = await checkPort(3306);
  console.log(`\n🔌 Porta 3306 (MySQL):`, port3306Open ? '✅ ABERTA' : '❌ FECHADA');

  // Check Docker
  const dockerRunning = await checkDocker();
  console.log(`🐳 Docker: ${dockerRunning ? '✅ RODANDO' : '❌ NÃO RODANDO'}`);

  // Check docker-compose.yml
  console.log('\n📋 Configuração do Docker:\n');
  if (fs.existsSync('docker-compose.yml')) {
    const compose = fs.readFileSync('docker-compose.yml', 'utf-8');
    if (compose.includes('mysql') || compose.includes('mariadb')) {
      console.log('✅ docker-compose.yml contém MySQL');
      // Extract port
      const portMatch = compose.match(/["']?3306["']?\s*:/);
      if (portMatch) {
        console.log('   Porta: 3306');
      }
    }
  } else {
    console.log('⚠️  docker-compose.yml não encontrado');
  }

  // Summary
  console.log('\n\n📌 RESUMO E SOLUÇÕES:\n');

  if (port3306Open) {
    console.log('✅ Banco de dados está RODANDO!\n');
    console.log('🔧 Tente:');
    console.log('  1. Reiniciar o backend: npm run dev');
    console.log('  2. Se persistir, executar: npm run prisma:generate');
  } else {
    console.log('❌ Banco de dados NÃO está respondendo\n');
    console.log('🔧 OPÇÃO 1 - Usar Docker Compose (Recomendado):\n');
    console.log('  docker-compose up -d');
    console.log('  Aguarde 15 segundos...');
    console.log('  npm run dev\n');

    console.log('🔧 OPÇÃO 2 - MySQL Local:\n');
    console.log('  Windows (Services):');
    console.log('    Win+R → services.msc → Procure "MySQL" → Iniciar\n');
    console.log('  macOS (Brew):');
    console.log('    brew services start mysql\n');
    console.log('  Linux (apt):');
    console.log('    sudo systemctl start mysql\n');

    console.log('🔧 OPÇÃO 3 - Conectar a banco de dados remoto:\n');
    console.log('  Editar .env:');
    console.log('  DATABASE_URL=mysql://user:password@host:3306/ai_factory\n');
  }

  console.log('\n💡 Verifique também:');
  console.log('  • Permissões do firewall');
  console.log('  • Credenciais do MySQL em .env');
  console.log('  • Se o banco "ai_factory" foi criado\n');
}

diagnose().catch(console.error);
