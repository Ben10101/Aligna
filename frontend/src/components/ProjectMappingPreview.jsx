import React, { useState, useMemo } from 'react';
import { ChevronDown, Users, AlertTriangle, CheckCircle, Target, Eye } from 'lucide-react';
import ProjectFieldMapper from '../services/ProjectFieldMapper';

export default function ProjectMappingPreview({ projectForm }) {
  const [expandedSections, setExpandedSections] = useState({
    metadata: true,
    phases: false,
    team: false,
    risks: false,
    checklist: false,
  });

  const mappedData = useMemo(() => {
    return ProjectFieldMapper.mapFormDataToProject(projectForm);
  }, [projectForm]);

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  if (!projectForm.name && !projectForm.description && !projectForm.vision) {
    return null;
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h4 className="text-sm font-semibold text-slate-900 mb-4">📊 Dados Mapeados para o Projeto</h4>

        {/* Metadados Extraídos */}
        <div className="border-b border-slate-100">
          <button
            onClick={() => toggleSection('metadata')}
            className="w-full py-3 px-3 flex items-center justify-between hover:bg-slate-50 rounded-lg transition"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
              <Target size={16} />
              Metadados Extraídos
            </span>
            <ChevronDown
              size={16}
              className={`transition ${expandedSections.metadata ? 'rotate-180' : ''}`}
            />
          </button>

          {expandedSections.metadata && (
            <div className="px-3 pb-3 space-y-2 text-sm">
              {mappedData.metadata.primaryObjective && (
                <div className="bg-blue-50 p-2 rounded">
                  <p className="text-xs font-semibold text-blue-900">Objetivo Principal:</p>
                  <p className="text-blue-800 mt-1">{mappedData.metadata.primaryObjective}</p>
                </div>
              )}
              {mappedData.metadata.targetAudience && (
                <div className="bg-purple-50 p-2 rounded">
                  <p className="text-xs font-semibold text-purple-900">Público-Alvo:</p>
                  <p className="text-purple-800 mt-1">{mappedData.metadata.targetAudience}</p>
                </div>
              )}
              {mappedData.metadata.expectedOutcome && (
                <div className="bg-green-50 p-2 rounded">
                  <p className="text-xs font-semibold text-green-900">Resultado Esperado:</p>
                  <p className="text-green-800 mt-1">{mappedData.metadata.expectedOutcome}</p>
                </div>
              )}
              {mappedData.metadata.keywords.length > 0 && (
                <div className="bg-amber-50 p-2 rounded">
                  <p className="text-xs font-semibold text-amber-900">Palavras-Chave:</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {mappedData.metadata.keywords.map((keyword, idx) => (
                      <span key={idx} className="bg-amber-200 text-amber-900 text-xs px-2 py-1 rounded">
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Fases */}
        <div className="border-b border-slate-100">
          <button
            onClick={() => toggleSection('phases')}
            className="w-full py-3 px-3 flex items-center justify-between hover:bg-slate-50 rounded-lg transition"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
              <Eye size={16} />
              Fases Recomendadas ({mappedData.enriched.phases.length})
            </span>
            <ChevronDown
              size={16}
              className={`transition ${expandedSections.phases ? 'rotate-180' : ''}`}
            />
          </button>

          {expandedSections.phases && (
            <div className="px-3 pb-3 space-y-2">
              {mappedData.enriched.phases.map((phase) => (
                <div key={phase.number} className="bg-slate-50 p-2 rounded text-sm">
                  <p className="font-semibold text-slate-900">
                    Fase {phase.number}: {phase.name}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">{phase.description}</p>
                  <p className="text-xs text-slate-500 mt-1">⏱️ {phase.estimatedDuration}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Equipe Recomendada */}
        <div className="border-b border-slate-100">
          <button
            onClick={() => toggleSection('team')}
            className="w-full py-3 px-3 flex items-center justify-between hover:bg-slate-50 rounded-lg transition"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
              <Users size={16} />
              Equipe Recomendada ({mappedData.enriched.recommendedTeam.length})
            </span>
            <ChevronDown
              size={16}
              className={`transition ${expandedSections.team ? 'rotate-180' : ''}`}
            />
          </button>

          {expandedSections.team && (
            <div className="px-3 pb-3 space-y-1">
              {mappedData.enriched.recommendedTeam.map((member, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm">
                  <span className="text-emerald-600">✓</span>
                  <div>
                    <p className="font-medium text-slate-900">{member.role}</p>
                    <p className="text-xs text-slate-500">{member.skills.join(', ')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Riscos Identificados */}
        <div className="border-b border-slate-100">
          <button
            onClick={() => toggleSection('risks')}
            className="w-full py-3 px-3 flex items-center justify-between hover:bg-slate-50 rounded-lg transition"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
              <AlertTriangle size={16} />
              Riscos Identificados ({mappedData.enriched.risks.length})
            </span>
            <ChevronDown
              size={16}
              className={`transition ${expandedSections.risks ? 'rotate-180' : ''}`}
            />
          </button>

          {expandedSections.risks && (
            <div className="px-3 pb-3 space-y-2">
              {mappedData.enriched.risks.map((risk) => (
                <div
                  key={risk.id}
                  className={`p-2 rounded text-sm ${
                    risk.severity === 'high'
                      ? 'bg-red-50 border-l-2 border-red-500'
                      : 'bg-amber-50 border-l-2 border-amber-500'
                  }`}
                >
                  <p className="font-semibold text-slate-900">{risk.title}</p>
                  <p className="text-xs text-slate-600 mt-1">{risk.description}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    <strong>Mitigação:</strong> {risk.mitigation}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Checklist de Inicialização */}
        <div>
          <button
            onClick={() => toggleSection('checklist')}
            className="w-full py-3 px-3 flex items-center justify-between hover:bg-slate-50 rounded-lg transition"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
              <CheckCircle size={16} />
              Checklist de Inicialização
            </span>
            <ChevronDown
              size={16}
              className={`transition ${expandedSections.checklist ? 'rotate-180' : ''}`}
            />
          </button>

          {expandedSections.checklist && (
            <div className="px-3 pb-3 space-y-4">
              {Object.entries(mappedData.initializationChecklist).map(([section, tasks]) => (
                <div key={section}>
                  <p className="text-xs font-semibold uppercase text-slate-500 mb-2">
                    {section === 'planning' && '📋 Planejamento'}
                    {section === 'team' && '👥 Equipe'}
                    {section === 'technical' && '⚙️ Técnico'}
                    {section === 'governance' && '🎯 Governança'}
                  </p>
                  <div className="space-y-1">
                    {tasks.map((task, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" className="w-4 h-4 rounded" disabled />
                        <span className="text-slate-600">{task.task}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Resumo */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
        <p className="font-semibold mb-2">💡 Dica</p>
        <p>
          Os dados acima foram extraídos automaticamente da sua visão do produto. Você pode usar essa informação
          para:
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
          <li>Montar equipes adequadas</li>
          <li>Identificar riscos antecipadamente</li>
          <li>Estruturar as fases do projeto</li>
          <li>Criar checklists personalizados</li>
        </ul>
      </div>
    </div>
  );
}
