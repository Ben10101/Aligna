# -*- coding: utf-8 -*-
"""
Factory Orchestrator
Coordena o fluxo de execução dos agentes
"""

import json
import sys
import os
from datetime import datetime

# Configurar UTF-8 para output
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Obter o diretório do script atual
script_dir = os.path.dirname(os.path.abspath(__file__))
# Ir um nível acima (raiz do projeto)
project_root = os.path.dirname(script_dir)

# Adicionar o diretório raiz ao path
sys.path.insert(0, project_root)

print(f"📍 Script dir: {script_dir}", file=sys.stderr)
print(f"📍 Project root: {project_root}", file=sys.stderr)

from agents.project_manager.agent import ProjectManager
from agents.requirements_analyst.agent import RequirementsAnalyst
from agents.qa_engineer.agent import QAEngineer
from orchestrator.projectBuilder import ProjectBuilder


class Factory:
    """Orquestra a fábrica de software"""

    def __init__(self, project_id, idea):
        self.project_id = project_id
        self.idea = idea
        self.results = {}

    def run(self):
        """Executa o pipeline completo de geração do projeto"""
        
        print(f"[FACTORY] Iniciando factory de software: {self.project_id}", file=sys.stderr)
        print(f"[FACTORY] Ideia: {self.idea}", file=sys.stderr)
        print("-" * 60, file=sys.stderr)

        try:
            # Definição da fila de execução (Pipeline de Agentes)
            # Cada item é uma etapa sequencial que depende da anterior
            execution_queue = [
                {
                    "name": "Project Manager",
                    "action": "Gerando backlog",
                    "execute": lambda: ProjectManager(self.project_id).process(self.idea),
                    "save": lambda res: self.results.update({'backlog': res})
                },
                {
                    "name": "Requirements Analyst",
                    "action": "Analisando requisitos",
                    "execute": lambda: RequirementsAnalyst(self.project_id).process(self.idea, self.results['backlog']),
                    "save": lambda res: self.results.update({'requirements': res})
                },
                {
                    "name": "QA Engineer",
                    "action": "Gerando testes",
                    "execute": lambda: QAEngineer(self.project_id).process(self.idea, self.results.get('code', '')),
                    "save": lambda res: self.results.update({'tests': res})
                }
            ]

            total_steps = len(execution_queue) + 1  # +1 para o ProjectBuilder

            # Executar a fila de agentes sequencialmente
            for i, task in enumerate(execution_queue, 1):
                print(f"\n[{i}/{total_steps}] {task['name']} - {task['action']}...", file=sys.stderr)
                result = task['execute']()
                task['save'](result)
                print(f"[OK] {task['name']} concluído com sucesso!", file=sys.stderr)

            # 6. ProjectBuilder - Cria arquivos reais
            print(f"\n[{total_steps}/{total_steps}] ProjectBuilder - Criando projeto real...", file=sys.stderr)
            builder = ProjectBuilder(self.project_id)
            project_path = builder.create_project(
                self.idea,
                self.results['backlog'],
                self.results['requirements'],
                self.results['architecture'],
                self.results['code'],
                self.results['tests'],
                self.results.get('primary_entity', 'Task'),
                self.results.get('attributes', [])
            )
            self.results['project_path'] = project_path
            print("[OK] Projeto real criado com sucesso!", file=sys.stderr)

            print("\n" + "=" * 60, file=sys.stderr)
            print("[SUCCESS] Projeto completo gerado com sucesso!", file=sys.stderr)
            print("=" * 60, file=sys.stderr)

            return self.results

        except Exception as e:
            print(f"\n[ERROR] Erro ao executar factory: {str(e)}", file=sys.stderr)
            raise

    def save_artifacts(self):
        """Salva os artefatos em arquivos"""
        
        project_dir = os.path.join(project_root, f"outputs/projects/{self.project_id}")
        
        if not os.path.exists(project_dir):
            os.makedirs(project_dir, exist_ok=True)

        # Salvar cada artefato em um arquivo
        artifacts = {
            'backlog.md': self.results.get('backlog', ''),
            'requirements.md': self.results.get('requirements', ''),
            'architecture.md': self.results.get('architecture', ''),
            'code_structure.md': self.results.get('code', ''),
            'tests.md': self.results.get('tests', ''),
        }

        for filename, content in artifacts.items():
            filepath = os.path.join(project_dir, filename)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"[SAVE] Salvo: {filepath}", file=sys.stderr)

        # Salvar metadados do projeto
        metadata = {
            'project_id': self.project_id,
            'idea': self.idea,
            'timestamp': datetime.now().isoformat(),
            'created_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        }

        metadata_path = os.path.join(project_dir, 'metadata.json')
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
        print(f"[SAVE] Metadados salvos: {metadata_path}", file=sys.stderr)


def main():
    """Função principal para executar como script"""
    
    if len(sys.argv) < 3:
        print("Uso: python factory.py <project_id> <idea>", file=sys.stderr)
        sys.exit(1)

    project_id = sys.argv[1]
    idea = ' '.join(sys.argv[2:])

    # Criar e executar a factory
    factory = Factory(project_id, idea)
    results = factory.run()
    
    # Salvar artefatos
    factory.save_artifacts()

    # Retornar resultados como JSON (para stdout apenas)
    output = {
        'projectId': project_id,
        'timestamp': datetime.now().isoformat(),
        **results
    }

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
