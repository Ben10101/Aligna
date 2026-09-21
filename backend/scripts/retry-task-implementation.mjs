import { runTaskImplementation } from '../src/services/implementationService.js';
import dotenv from 'dotenv';
dotenv.config();

const taskUuid = '8db29115-e0b5-487a-82dd-8f99d957fb1e';
const userUuid = '7abeaba1-deba-4323-abd5-0b62eac53e0e';

function safeStringify(value) {
  return JSON.stringify(value, (_, current) => (typeof current === 'bigint' ? current.toString() : current), 2);
}

async function retry() {
  console.log(`Iniciando retentativa de implementação para a task ${taskUuid}...`);
  try {
    const result = await runTaskImplementation(taskUuid, userUuid, { forceRefresh: true });
    console.log('Implementação concluída com sucesso!');
    console.log(safeStringify(result));
  } catch (error) {
    console.error('Erro na implementação:', error);
  } finally {
    process.exit();
  }
}

retry();
