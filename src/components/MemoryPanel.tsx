"use client";

import { useState, useEffect, useMemo } from "react";
import type { Memory, MemoryCategory } from "@/types/memory";

const CATEGORY_LABELS: Record<string, string> = {
  personal: "Personal",
  education: "Education",
  projects: "Projects",
  goals: "Goals",
  preferences: "Preferences",
  general: "General",
};

const CATEGORY_ORDER = [
  "personal",
  "education",
  "projects",
  "goals",
  "preferences",
  "general",
];

const CATEGORIES: MemoryCategory[] = [
  "personal",
  "education",
  "projects",
  "goals",
  "preferences",
  "general",
];

// Props for the MemoryPanel component
interface MemoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MemoryPanel({ isOpen, onClose }: MemoryPanelProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState<MemoryCategory>("general");

  // Group memories by category
  const groupedMemories = useMemo(() => {
    const groups: Record<string, Memory[]> = {};
    for (const cat of CATEGORY_ORDER) {
      groups[cat] = [];
    }
    for (const m of memories) {
      const cat = CATEGORY_ORDER.includes(m.category) ? m.category : "general";
      groups[cat].push(m);
    }
    return groups;
  }, [memories]);

  // Load memories when panel opens
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/memory");
        const data = await response.json();
        if (!cancelled) {
          if (data.success) {
            setMemories(data.memories || []);
          } else {
            setError(data.error || "Failed to load memories");
          }
        }
      } catch {
        if (!cancelled) {
          setError("Failed to connect to server");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Delete a single memory
  async function handleDelete(id: number) {
    try {
      const response = await fetch("/api/memory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      if (data.success) {
        setMemories((prev) => prev.filter((m) => m.id !== id));
      } else {
        setError(data.error || "Failed to delete memory");
      }
    } catch {
      setError("Failed to delete memory");
    }
  }

  // Clear all memories
  async function handleClearAll() {
    if (!confirm("Are you sure you want to delete ALL memories? This cannot be undone.")) {
      return;
    }
    try {
      const response = await fetch("/api/memory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearAll: true }),
      });
      const data = await response.json();
      if (data.success) {
        setMemories([]);
      } else {
        setError(data.error || "Failed to clear memories");
      }
    } catch {
      setError("Failed to clear memories");
    }
  }

  // Start editing a memory
  function handleEditStart(memory: Memory) {
    setEditingId(memory.id);
    setEditContent(memory.content);
    setEditCategory(memory.category as MemoryCategory);
    setError(null);
  }

  // Cancel editing
  function handleEditCancel() {
    setEditingId(null);
    setEditContent("");
    setEditCategory("general");
  }

  // Save edited memory
  async function handleEditSave(id: number) {
    if (editContent.trim().length === 0) {
      setError("Memory content cannot be empty");
      return;
    }
    try {
      const response = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          content: editContent.trim(),
          category: editCategory,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setMemories((prev) =>
          prev.map((m) =>
            m.id === id
              ? { ...m, content: data.memory.content, category: data.memory.category, updatedAt: data.memory.updatedAt }
              : m
          )
        );
        handleEditCancel();
      } else {
        setError(data.error || "Failed to update memory");
      }
    } catch {
      setError("Failed to update memory");
    }
  }

  // Don't render anything if panel is closed
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop - click to close */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="ml-auto w-full max-w-sm bg-white dark:bg-zinc-900 shadow-xl flex flex-col relative">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧠</span>
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
              Memory
            </h2>
            <span className="text-xs bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 px-2 py-0.5 rounded-full">
              {memories.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
          >
            <svg className="w-5 h-5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-8 text-zinc-500 dark:text-zinc-400">
              Loading memories...
            </div>
          ) : memories.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-3xl mb-2">💭</div>
              <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                No memories stored yet.
              </p>
              <p className="text-zinc-400 dark:text-zinc-500 text-xs mt-1">
                Ask me to remember something in the chat!
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {CATEGORY_ORDER.map((cat) => {
                const categoryMemories = groupedMemories[cat];
                if (categoryMemories.length === 0) return null;
                return (
                  <div key={cat}>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">
                      {CATEGORY_LABELS[cat]}
                    </h3>
                    <div className="space-y-2">
                      {categoryMemories.map((memory) => (
                        <div
                          key={memory.id}
                          className="group p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700"
                        >
                          {editingId === memory.id ? (
                            /* Edit mode */
                            <div className="space-y-2">
                              <textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className="w-full px-2 py-1 text-sm bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded text-zinc-800 dark:text-zinc-200 resize-none"
                                rows={2}
                                autoFocus
                              />
                              <div className="flex items-center gap-2">
                                <select
                                  value={editCategory}
                                  onChange={(e) =>
                                    setEditCategory(e.target.value as MemoryCategory)
                                  }
                                  className="text-xs px-2 py-1 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded text-zinc-700 dark:text-zinc-300"
                                >
                                  {CATEGORIES.map((c) => (
                                    <option key={c} value={c}>
                                      {CATEGORY_LABELS[c]}
                                    </option>
                                  ))}
                                </select>
                                <div className="flex-1" />
                                <button
                                  onClick={() => handleEditSave(memory.id)}
                                  className="text-xs text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 font-medium"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={handleEditCancel}
                                  className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* View mode */
                            <>
                              <p className="text-sm text-zinc-800 dark:text-zinc-200 pr-10">
                                {memory.content}
                              </p>
                              <div className="flex items-center justify-between mt-2">
                                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                                  {new Date(memory.createdAt).toLocaleDateString()}
                                </span>
                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => handleEditStart(memory)}
                                    className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleDelete(memory.id)}
                                    className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {memories.length > 0 && (
          <div className="p-4 border-t border-zinc-200 dark:border-zinc-700">
            <button
              onClick={handleClearAll}
              className="w-full px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 transition-colors"
            >
              Clear All Memories
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
