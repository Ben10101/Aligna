import sys
import os

file_path = r'c:\Users\bleao\ai-software-factory\backend\src\services\implementationService.js'

if not os.path.exists(file_path):
    print(f"Erro: Arquivo {file_path} nao existe.")
    sys.exit(1)

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
skip_until = -1

for i, line in enumerate(lines):
    if i < skip_until:
        continue

    # 1. Transform buildRepairContext to async and add DebugAgent call
    if 'function buildRepairContext({ reviewReport, specialistReviewReport, validationSummary, attemptNumber, technicalSpec }) {' in line:
        new_lines.append('async function buildRepairContext({ reviewReport, specialistReviewReport, validationSummary, attemptNumber, technicalSpec, projectId }) {\n')
        new_lines.append('  const findings = (reviewReport?.findings || []).slice(0, 10).map((finding) => ({\n')
        new_lines.append('    code: finding.code,\n')
        new_lines.append('    severity: finding.severity,\n')
        new_lines.append('    filePath: finding.filePath,\n')
        new_lines.append('    message: finding.message,\n')
        new_lines.append('  }));\n')
        new_lines.append('  const specialistFindings = (specialistReviewReport?.findings || []).slice(0, 10).map((finding) => ({\n')
        new_lines.append('    code: finding.code,\n')
        new_lines.append('    severity: finding.severity,\n')
        new_lines.append('    filePath: finding.filePath,\n')
        new_lines.append('    message: finding.message,\n')
        new_lines.append('  }));\n')
        
        # Inject DebugAgent logic
        injection = """  const validationFailures = formatValidationFailures(validationSummary);

  // Nivel Antigravity: Diagnostico Autonomo de falhas de build/teste
  if (validationSummary?.buildStatus === 'failed' || validationSummary?.status === 'failed') {
    try {
      console.log(`[Self-Healing] Analisando falhas com DebugAgent...`);
      const logs = JSON.stringify(validationSummary, null, 2);
      const debugReport = await invokeDebugAgent(projectId, { logs, context: 'validation_failure' });
      
      if (debugReport && debugReport.findings) {
        console.log(`[Self-Healing] DebugAgent encontrou ${debugReport.findings.length} causas raiz.`);
        findings.push(...debugReport.findings.map(f => ({
          ...f,
          severity: 'critical',
          source: 'debug_agent'
        })));
      }
    } catch (err) {
      console.error('[Self-Healing] Falha ao invocar DebugAgent:', err.message);
    }
  }
"""
        new_lines.append(injection)
        new_lines.append('\n  return {\n')
        new_lines.append('    attemptNumber,\n')
        new_lines.append('    reviewStatus: reviewReport?.summary?.status || \'unknown\',\n')
        new_lines.append('    reviewScore: reviewReport?.summary?.score ?? null,\n')
        new_lines.append('    specialistReviewStatus: specialistReviewReport?.summary?.status || \'unknown\',\n')
        new_lines.append('    specialistReviewScore: specialistReviewReport?.summary?.score ?? null,\n')
        new_lines.append('    findings,\n')
        new_lines.append('    specialistFindings,\n')
        new_lines.append('    validationStatus: validationSummary?.status || \'unknown\',\n')
        new_lines.append('    validationFailures,\n')
        new_lines.append('    generationSource:\n')
        new_lines.append('      technicalSpec?.autonomousMaterialization?.generationSource ||\n')
        new_lines.append('      technicalSpec?.frontend?.autonomousGenerationSource ||\n')
        new_lines.append('      technicalSpec?.autonomousExecution?.generationSource ||\n')
        new_lines.append('      \'unknown\',\n')
        new_lines.append('    materialization:\n')
        new_lines.append('      technicalSpec?.autonomousMaterialization || null,\n')
        new_lines.append('    repairStyle: resolveRepairStyle({ technicalSpec, findings, specialistFindings, validationFailures }),\n')
        new_lines.append('    repairScope: inferRepairScope({ findings, specialistFindings, validationFailures }),\n')
        new_lines.append('  };\n')
        new_lines.append('}\n')
        skip_until = i + 36
        continue

    # 2. Update call site to use await
    if 'const repairContext = buildRepairContext({' in line:
        new_lines.append('      const repairContext = await buildRepairContext({\n')
        new_lines.append('        reviewReport: cycleResult.reviewReport,\n')
        new_lines.append('        specialistReviewReport: cycleResult.specialistReviewReport,\n')
        new_lines.append('        validationSummary: cycleResult.validationSuite.summary,\n')
        new_lines.append('        attemptNumber: attemptIndex,\n')
        new_lines.append('        technicalSpec,\n')
        new_lines.append('        projectId: task.projectId,\n')
        new_lines.append('      });\n')
        skip_until = i + 7 
        continue

    new_lines.append(line)

with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("Sucesso")
