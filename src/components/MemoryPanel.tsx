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
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-stretch sm:justify-end">
      {/* Backdrop - click to close */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel - bottom sheet on mobile, right drawer on desktop */}
      <div className="relative flex h-[85vh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-white/10 bg-[#100a08]/95 shadow-2xl animate-[fade-up_0.25s_ease-out] sm:h-full sm:max-w-sm sm:rounded-none sm:border-l sm:border-t-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 via-orange-600 to-red-700 text-xs ring-1 ring-white/20">
              🧠
            </span>
            <h2 className="font-semibold text-stone-100">Memory</h2>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-stone-300">
              {memories.length}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close memory panel"
            className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-white/10 hover:text-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="py-8 text-center text-stone-500">
              Loading memories...
            </div>
          ) : memories.length === 0 ? (
            <div className="py-10 text-center">
              <div className="mb-3 text-3xl">💭</div>
              <p className="text-sm text-stone-300">No memories stored yet.</p>
              <p className="mt-1 text-xs text-stone-500">
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
                    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-orange-200/70">
                      {CATEGORY_LABELS[cat]}
                    </h3>
                    <div className="space-y-2">
                      {categoryMemories.map((memory) => (
                        <div
                          key={memory.id}
                          className="group rounded-xl border border-white/10 bg-white/[0.04] p-3 transition-colors hover:border-white/20"
                        >
                          {editingId === memory.id ? (
                            /* Edit mode */
                            <div className="space-y-2">
                              <textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-orange-500/60"
                                rows={2}
                                autoFocus
                              />
                              <div className="flex items-center gap-2">
                                <select
                                  value={editCategory}
                                  onChange={(e) =>
                                    setEditCategory(e.target.value as MemoryCategory)
                                  }
                                  className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-stone-300 focus:outline-none focus:ring-1 focus:ring-orange-500/60"
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
                                  className="text-xs font-medium text-orange-300 transition-colors hover:text-orange-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={handleEditCancel}
                                  className="text-xs text-stone-400 transition-colors hover:text-stone-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* View mode */
                            <>
                              <p className="text-sm text-stone-100">
                                {memory.content}
                              </p>
                              <div className="mt-2 flex items-center justify-between">
                                <span className="text-xs text-stone-500">
                                  {new Date(memory.createdAt).toLocaleDateString()}
                                </span>
                                <div className="flex items-center gap-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                                  <button
                                    onClick={() => handleEditStart(memory)}
                                    className="text-xs text-orange-300 transition-colors hover:text-orange-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleDelete(memory.id)}
                                    className="text-xs text-red-300 transition-colors hover:text-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70"
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
          <div className="border-t border-white/10 p-4">
            <button
              onClick={handleClearAll}
              className="w-full rounded-xl border border-red-500/30 px-3 py-2 text-sm text-red-300 transition-colors hover:bg-red-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70"
            >
              Clear All Memories
            </button>
          </div>
        )}
      </div>
    </div>
  );
}