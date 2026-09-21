#!/usr/bin/env node

import http from 'http';
import https from 'https';

const API_URL = 'http://localhost:3001/api';
const HEALTH_CHECK_URL = 'http://localhost:3001/api/health';

console.log('🔍 Diagnóstico de Conexão Backend\n');
console.log(`⏱️  Hora: ${new Date().toLocaleString('pt-BR')}\n`);

async function checkConnection(url, label) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => {
      console.log(`❌ ${label}: Timeout (5s) - Servidor não respondeu`);
      resolve(false);
    }, 5000);

    protocol
      .get(url, (res) => {
        clearTimeout(timeout);
        console.log(
          `✅ ${label}: ${res.statusCode} ${res.statusMessage}`,
        );
        console.log(`   Headers: ${JSON.stringify({ 'content-type': res.headers['content-type'] })}`);
        resolve(true);
      })
      .on('error', (err) => {
        clearTimeout(timeout);
        console.log(`❌ ${label}: ${err.code || err.message}`);
        resolve(false);
      });
  });
}

async function checkDatabaseConnection() {
  console.log('\n📊 Verificando Banco de Dados...');
  try {
    const fs = await import('fs');
    const prismaSchema = fs.readFileSync(
      'backend/prisma/schema.prisma',
      'utf-8',
    );
    const dbMatch = prismaSchema.match(/url\s*=\s*env\("([^"]+)"\)/);
    if (dbMatch) {
      console.log(`   Variável de ambiente: ${dbMatch[1]}`);
    }

    // Tenta ler .env
    try {
      const dotenv = await import('dotenv');
      dotenv.config();
      const dbUrl = process.env.DATABASE_URL;
      if (dbUrl) {
        const urlObj = new URL(dbUrl);
        console.log(
          `   Database: ${urlObj.protocol}//${urlObj.hostname}:${urlObj.port || 'default'}${urlObj.pathname}`,
        );
      }
    } catch (e) {
      console.log('   (Não foi possível ler DATABASE_URL)');
    }
  } catch (err) {
    console.log(`   ⚠️  Erro ao verificar DB: ${err.message}`);
  }
}

async function diagnose() {
  console.log('📡 Verificando Conectividade...\n');

  // Test API connection
  const apiConnected = await checkConnection(API_URL, 'API Base');

  // Test health endpoint
  if (apiConnected) {
    await checkConnection(HEALTH_CHECK_URL, 'Health Check');
  }

  // Check database
  await checkDatabaseConnection();

  // Summary
  console.log('\n📋 Resumo:\n');
  if (apiConnected) {
    console.log('✅ Backend está ativo e respondendo!\n');
    console.log('🔧 Próximos passos:');
    console.log('  1. Verifique se o frontend está rodando em http://localhost:5173');
    console.log('  2. Verifique o console do navegador (F12) para erros CORS');
    console.log('  3. Verifique se as credenciais de autenticação estão corretas');
  } else {
    console.log('❌ Backend NÃO está respondendo!\n');
    console.log('🔧 Ações recomendadas:');
    console.log('  1. Inicie o backend: cd backend && npm run dev');
    console.log('  2. Verifique se a porta 3001 está disponível');
    console.log('  3. Verifique o arquivo .env para DATABASE_URL');
    console.log('  4. Verifique se o banco de dados está ativo');
    console.log('  5. Execute: npm run prisma:generate && npm run prisma:migrate:dev');
  }

  console.log('\n');
}

diagnose().catch(console.error);
