import React from 'react';
import AppShell from '../components/AppShell';
import BacklogKanban from './BacklogKanban';

export default function GlobalBacklogPage() {
  return (
    <AppShell
      eyebrow="Visão Global"
      title="Backlog Global"
      description="Visualize e gerencie as histórias de usuário de todos os projetos em um só lugar."
    >
      <BacklogKanban
        global={true}
        title="Backlog Global"
        subtitle="Arraste histórias para o agente processar e gerar artefatos."
        agentColumnTitle="Analista de Requisitos (Global)"
        contextLabel="backlog global"
      />
    </AppShell>
  );
}
