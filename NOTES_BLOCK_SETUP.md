# 📝 Bloco de Notas - Guia de Integração

## 🎯 O que é?

Um componente flutuante de **bloco de notas** que permite:
- ✅ Criar notas rapidamente
- ✅ Editar notas existentes
- ✅ Deletar notas
- ✅ Salvar automaticamente no localStorage
- ✅ Acessar de qualquer página da aplicação

## 📦 Como usar?

### Opção 1: Integrar no App.jsx (Globalmente)

```jsx
import NotesBlock from './components/NotesBlock';

function App() {
  return (
    <div>
      {/* Suas rotas e componentes */}
      <NotesBlock />
    </div>
  );
}
```

### Opção 2: Usar o Hook em Componentes Específicos

```jsx
import { useNotes } from '../hooks/useNotes';

function MyComponent() {
  const { notes, addNote, updateNote, deleteNote } = useNotes();

  const handleAddNote = () => {
    addNote('Minha nova nota');
  };

  return (
    <div>
      <button onClick={handleAddNote}>Adicionar Nota</button>
      <ul>
        {notes.map(note => (
          <li key={note.id}>{note.text}</li>
        ))}
      </ul>
    </div>
  );
}
```

## 🎨 Personalizações

### Alterar posição do botão flutuante

No arquivo `NotesBlock.jsx`, linha ~56:

```jsx
// Mude de:
<div className="fixed bottom-4 right-4 z-50">

// Para:
<div className="fixed bottom-20 left-4 z-50">  // canto inferior esquerdo
<div className="fixed top-4 right-4 z-50">     // canto superior direito
<div className="fixed top-20 left-4 z-50">     // canto superior esquerdo
```

### Alterar cores do tema

Procure e altere as classes com `indigo`:

```jsx
// De:
className="bg-indigo-500 hover:bg-indigo-600"

// Para:
className="bg-blue-500 hover:bg-blue-600"
className="bg-green-500 hover:bg-green-600"
className="bg-purple-500 hover:purple-600"
```

## 💾 Dados Persistidos

As notas são salvas em `localStorage` sob a chave: `aligna_notes`

Cada nota possui:
```json
{
  "id": 1718457600000,
  "text": "Conteúdo da nota",
  "createdAt": "2026-06-15T18:30:00.000Z",
  "updatedAt": "2026-06-15T18:35:00.000Z"
}
```

## ⌨️ Atalhos de Teclado

| Atalho | Ação |
|--------|------|
| `Ctrl+Enter` | Salvar/Atualizar nota |
| Clique na nota | Editar nota |
| Ícone 🗑️ | Deletar nota |

## 🔧 API do Hook `useNotes`

```javascript
const {
  notes,              // Array de todas as notas
  addNote,            // (text) => Adicionar nota
  updateNote,         // (id, text) => Atualizar nota
  deleteNote,         // (id) => Deletar nota
  getNoteById,        // (id) => Obter uma nota específica
  getAllNotes,        // () => Retornar todas as notas
  clearAllNotes,      // () => Limpar todas as notas
} = useNotes();
```

## 📱 Exemplos de Uso

### Adicionar nota automaticamente ao criar projeto

```jsx
const { addNote } = useNotes();

const handleCreateProject = async (projectData) => {
  const project = await createProject(projectData);
  addNote(`✅ Projeto "${projectData.name}" criado com sucesso!`);
  return project;
};
```

### Notas contextualizadas

```jsx
const { addNote } = useNotes();

const handleError = (error) => {
  addNote(`❌ Erro: ${error.message}`);
  console.error(error);
};

const handleSuccess = (message) => {
  addNote(`✅ ${message}`);
};
```

### Exportar notas

```jsx
const { getAllNotes } = useNotes();

const exportNotes = () => {
  const notes = getAllNotes();
  const text = notes.map(n => `${n.text}\n(${n.updatedAt})`).join('\n\n');
  
  const element = document.createElement('a');
  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
  element.setAttribute('download', `notas-${new Date().toISOString()}.txt`);
  element.click();
};
```

## 🎓 Dica: Usar para Documentar Processo

Ótimo para documentar o workflow enquanto trabalha:

```
📋 Tarefas do Projeto X:
- ✅ Requisitos coletados
- 🔄 Design em progresso
- ⏳ Desenvolvimento (próxima semana)
- ⏳ Testes
- ⏳ Deploy

💡 Notas técnicas:
- Usar React 18.2
- Integrar com Prisma ORM
- CORS configurado para localhost:5173
```

---

**Pronto para usar!** 🚀

Se precisar de mais funcionalidades (sync com backend, compartilhamento, etc), é só avisar!
