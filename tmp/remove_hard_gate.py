import sys

file_path = r'c:\Users\bleao\ai-software-factory\backend\src\services\implementationService.js'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
target_found = False
for line in lines:
    if 'throw new Error(`A implementacao incremental do ${failedLane} falhou em ${failedScript}.`);' in line:
        new_lines.append(f'        // Nivel Antigravity: Nao paramos mais aqui. Deixamos o ciclo de qualidade capturar e o DebugAgent agir.\n')
        new_lines.append(f"        console.warn(`[Self-Healing] Quick validation falhou em ${{failedLane}}/${{failedScript}}. Proceeding to repair cycle.`);\n")
        target_found = True
    else:
        new_lines.append(line)

if target_found:
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print("Sucesso")
else:
    print("Nao encontrado")
