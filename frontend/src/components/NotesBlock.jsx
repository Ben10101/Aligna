import React, { useState, useEffect } from 'react';
import { Save, Trash2, Plus, X } from 'lucide-react';

export default function NotesBlock() {
  const [notes, setNotes] = useState(() => {
    const saved = localStorage.getItem('aligna_notes');
    return saved ? JSON.parse(saved) : [];
  });

  const [currentNote, setCurrentNote] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('aligna_notes', JSON.stringify(notes));
  }, [notes]);

  const addNote = () => {
    if (!currentNote.trim()) return;

    if (editingId) {
      setNotes(notes.map(n =>
        n.id === editingId
          ? { ...n, text: currentNote, updatedAt: new Date().toISOString() }
          : n
      ));
      setEditingId(null);
    } else {
      setNotes([
        ...notes,
        {
          id: Date.now(),
          text: currentNote,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
    }
    setCurrentNote('');
  };

  const deleteNote = (id) => {
    setNotes(notes.filter(n => n.id !== id));
    if (editingId === id) {
      setEditingId(null);
      setCurrentNote('');
    }
  };

  const editNote = (note) => {
    setCurrentNote(note.text);
    setEditingId(note.id);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {/* Botão flutuante */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-14 h-14 rounded-full shadow-lg transition-all ${
          isOpen
            ? 'bg-indigo-600 hover:bg-indigo-700'
            : 'bg-indigo-500 hover:bg-indigo-600'
        } text-white flex items-center justify-center`}
        title="Bloco de Notas"
      >
        {isOpen ? <X size={24} /> : <Plus size={24} />}
      </button>

      {/* Painel de notas */}
      {isOpen && (
        <div className="absolute bottom-16 right-0 w-96 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden flex flex-col max-h-96">
          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-500 to-indigo-600 text-white p-4">
            <h3 className="font-bold text-lg">Bloco de Notas</h3>
            <p className="text-sm opacity-90">{notes.length} nota(s) salva(s)</p>
          </div>

          {/* Área de input */}
          <div className="p-4 border-b border-gray-200">
            <textarea
              value={currentNote}
              onChange={(e) => setCurrentNote(e.target.value)}
              placeholder="Digite sua nota aqui..."
              onKeyDown={(e) => {
                if (e.ctrlKey && e.key === 'Enter') {
                  addNote();
                }
              }}
              className="w-full h-20 p-2 border border-gray-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={addNote}
                disabled={!currentNote.trim()}
                className="flex-1 bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-300 text-white px-3 py-2 rounded font-medium text-sm flex items-center justify-center gap-2 transition"
              >
                <Save size={16} />
                {editingId ? 'Atualizar' : 'Salvar'} (Ctrl+Enter)
              </button>
              {editingId && (
                <button
                  onClick={() => {
                    setCurrentNote('');
                    setEditingId(null);
                  }}
                  className="bg-gray-400 hover:bg-gray-500 text-white px-3 py-2 rounded font-medium text-sm transition"
                >
                  Cancelar
                </button>
              )}
            </div>
          </div>

          {/* Lista de notas */}
          <div className="flex-1 overflow-y-auto">
            {notes.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                <p>Nenhuma nota ainda</p>
                <p className="text-xs mt-1">Crie uma para começar</p>
              </div>
            ) : (
              <div className="space-y-2 p-3">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className={`p-3 rounded border transition ${
                      editingId === note.id
                        ? 'bg-indigo-50 border-indigo-300'
                        : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <p className="text-sm text-gray-800 line-clamp-2 cursor-pointer hover:text-indigo-600"
                       onClick={() => editNote(note)}>
                      {note.text}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-gray-500">
                        {formatDate(note.updatedAt)}
                      </span>
                      <button
                        onClick={() => deleteNote(note.id)}
                        className="text-red-500 hover:text-red-700 transition"
                        title="Deletar"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600">
            💡 Clique em uma nota para editar | Ctrl+Enter para salvar
          </div>
        </div>
      )}
    </div>
  );
}
