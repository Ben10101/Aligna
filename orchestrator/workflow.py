"""
Workflow Module
Define o workflow da fábrica de software
"""


class Workflow:
    """Define as etapas do workflow"""

    STAGES = [
        {
            'name': 'Project Manager',
            'description': 'Gera backlog e épicos',
            'agent': 'ProjectManager',
            'output': 'backlog'
        },
        {
            'name': 'Requirements Analyst',
            'description': 'Analisa requisitos funcionais e não-funcionais',
            'agent': 'RequirementsAnalyst',
            'output': 'requirements'
        },
        {
            'name': 'QA Engineer',
            'description': 'Gera plano de testes',
            'agent': 'QAEngineer',
            'output': 'tests'
        }
    ]

    @staticmethod
    def get_stages():
        """Retorna todas as etapas do workflow"""
        return Workflow.STAGES

    @staticmethod
    def get_stage_count():
        """Retorna o número total de etapas"""
        return len(Workflow.STAGES)

    @staticmethod
    def get_stage(index):
        """Retorna uma etapa específica pelo índice"""
        if 0 <= index < len(Workflow.STAGES):
            return Workflow.STAGES[index]
        return None

    @staticmethod
    def get_dependencies(stage_index):
        """Retorna os outputs das etapas anteriores como inputs"""
        if stage_index == 0:
            return ['idea']  # Primeira etapa recebe apenas a ideia
        
        dependencies = ['idea']
        for i in range(stage_index):
            stage = Workflow.STAGES[i]
            dependencies.append(stage['output'])
        
        return dependencies


# Exemplo de uso
if __name__ == '__main__':
    print("Workflow da AI Software Factory")
    print("=" * 60)
    
    for i, stage in enumerate(Workflow.get_stages(), 1):
        print(f"\n{i}. {stage['name']}")
        print(f"   Descrição: {stage['description']}")
        print(f"   Output: {stage['output']}")
        deps = Workflow.get_dependencies(i - 1)
        print(f"   Dependências: {', '.join(deps)}")
