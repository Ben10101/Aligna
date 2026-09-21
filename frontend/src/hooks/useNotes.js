import { useState, useCallback } from 'react';

export function useNotes() {
  const [notes, setNotes] = useState(() => {
    const saved = localStorage.getItem('aligna_notes');
    return saved ? JSON.parse(saved) : [];
  });

  const addNote = useCallback((text) => {
    const newNote = {
      id: Date.now(),
      text,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setNotes((prev) => [...prev, newNote]);
    localStorage.setItem('aligna_notes', JSON.stringify([...notes, newNote]));
    return newNote;
  }, [notes]);

  const updateNote = useCallback((id, text) => {
    const updated = notes.map((n) =>
      n.id === id ? { ...n, text, updatedAt: new Date().toISOString() } : n
    );
    setNotes(updated);
    localStorage.setItem('aligna_notes', JSON.stringify(updated));
  }, [notes]);

  const deleteNote = useCallback((id) => {
    const updated = notes.filter((n) => n.id !== id);
    setNotes(updated);
    localStorage.setItem('aligna_notes', JSON.stringify(updated));
  }, [notes]);

  const getNoteById = useCallback((id) => {
    return notes.find((n) => n.id === id);
  }, [notes]);

  const getAllNotes = useCallback(() => {
    return notes;
  }, [notes]);

  const clearAllNotes = useCallback(() => {
    setNotes([]);
    localStorage.removeItem('aligna_notes');
  }, []);

  return {
    notes,
    addNote,
    updateNote,
    deleteNote,
    getNoteById,
    getAllNotes,
    clearAllNotes,
  };
}
