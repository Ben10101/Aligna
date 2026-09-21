import sys

file_path = r'C:\Users\bleao\ai-software-factory\orchestrator\run_single_agent.py'
with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
target_found = False
for line in lines:
    if 'else:' in line and 'raise ValueError(f"Agente desconhecido' in lines[lines.index(line)+1]:
        new_lines.append('        elif agent_name == "DebugAgent" or agent_name == "debug_agent":\n')
        new_lines.append('            agent = DebugAgent(project_id)\n')
        new_lines.append('            result = agent.process(payload)\n')
        new_lines.append(line)
        target_found = True
    else:
        new_lines.append(line)

if target_found:
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print("Sucesso")
else:
    print("Nao encontrado")
