import { runSingleAgent } from './orchestratorService.js';

export function isSemanticAlignmentEnabled() {
  return ['1', 'true', 'yes'].includes(String(process.env.ALIGNMENT_SEMANTIC_ANALYSIS_ENABLED || '').trim().toLowerCase());
}

export async function analyzeSemanticAlignment(input, options = {}) {
  const result = await runSingleAgent('alignment_semantic', { idea: input }, { envOverrides: options.envOverrides || {} });
  return { status: 'completed', findings: Array.isArray(result?.findings) ? result.findings : [], provider: result?.provider || null };
}
