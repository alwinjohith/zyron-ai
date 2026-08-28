import { describe, it, expect, beforeEach } from "vitest";
import {
  clearAllMemories,
  createMemory,
  resolveMemoryConflict,
  getAllMemories,
  getAllMemoriesIncludingArchived,
  getRelevantMemories,
  categorizeMemory,
  findDuplicateMemory,
} from "@/lib/db";

beforeEach(() => {
  clearAllMemories();
});

describe("Stage 3: memory conflict / update resolution", () => {
  it("A: a new preference replaces the old preference (Python -> Java)", () => {
    createMemory("My favorite programming language is Python.", "preferences");

    const content = "Actually, my favorite programming language is Java.";
    const category = categorizeMemory(content);
    const resolution = resolveMemoryConflict(content, category);
    createMemory(content, category);

    expect(resolution.action).toBe("archived");

    const active = getAllMemories().map((m) => m.content);
    expect(active.some((c) => c.includes("Java"))).toBe(true);
    expect(active.some((c) => c.includes("Python"))).toBe(false);
  });

  it("B: a new fact replaces a conflicting old fact", () => {
    createMemory("I am working on the Zyron project.", "projects");

    const content = "I switched to working on the Zyron v2 project now.";
    const category = categorizeMemory(content);
    const resolution = resolveMemoryConflict(content, category);
    createMemory(content, category);

    expect(resolution.action).toBe("archived");

    const active = getAllMemories().map((m) => m.content);
    const oldOne = active.find((c) => c.includes("Zyron project"));
    expect(oldOne).toBeUndefined();
  });

  it("C: unrelated memories remain untouched when a fact is updated", () => {
    createMemory("My favorite programming language is Python.", "preferences");
    createMemory("My favorite project is Zyron.", "preferences");

    const content = "Actually, my favorite programming language is Java.";
    const category = categorizeMemory(content);
    resolveMemoryConflict(content, category);
    createMemory(content, category);

    const active = getAllMemories().map((m) => m.content);
    expect(active.some((c) => c.includes("Java"))).toBe(true);
    expect(active.some((c) => c.includes("Python"))).toBe(false);
    // The unrelated project fact must survive.
    expect(active.some((c) => c.includes("project is Zyron"))).toBe(true);
  });

  it("D: archived memories are not returned as current memories", () => {
    createMemory("My favorite programming language is Python.", "preferences");
    const content = "Actually, my favorite programming language is Java.";
    resolveMemoryConflict(content, categorizeMemory(content));
    createMemory(content, "preferences");

    const active = getAllMemories();
    const archived = getAllMemoriesIncludingArchived().filter(
      (m) => !active.some((a) => a.id === m.id)
    );

    // The old Python fact still exists in history but is archived.
    expect(archived.some((m) => m.content.includes("Python"))).toBe(true);
    // It must not appear among active/current memories.
    expect(active.some((m) => m.content.includes("Python"))).toBe(false);
  });

  it("E: asking for an updated fact returns the newest value", () => {
    createMemory("My favorite programming language is Python.", "preferences");
    const content = "Actually, my favorite programming language is Java.";
    resolveMemoryConflict(content, categorizeMemory(content));
    createMemory(content, "preferences");

    const relevant = getRelevantMemories("What is my favorite programming language?");
    const texts = relevant.map((m) => m.content);
    expect(texts.some((c) => c.includes("Java"))).toBe(true);
    expect(texts.some((c) => c.includes("Python"))).toBe(false);
  });

  it("F: normal new memories still work", () => {
    const content = "My favorite color is green.";
    const category = categorizeMemory(content);
    const resolution = resolveMemoryConflict(content, category);
    createMemory(content, category);

    expect(resolution.action).toBe("no-conflict");
    const all = getAllMemories();
    expect(all.some((m) => m.content.includes("green"))).toBe(true);
  });

  it("G: existing memory retrieval still works", () => {
    createMemory("I am an ECE student.", "education");
    createMemory("My favorite color is blue.", "preferences");

    const relevant = getRelevantMemories("What is my favorite color?");
    const texts = relevant.map((m) => m.content);
    expect(texts.some((c) => c.includes("blue"))).toBe(true);
  });

  it("H: no false conflict for unrelated facts about different subjects", () => {
    createMemory("I use Java.", "preferences");
    const friendContent = "My friend uses Python.";
    const category = categorizeMemory(friendContent);
    resolveMemoryConflict(friendContent, category);
    createMemory(friendContent, category);

    const active = getAllMemories().map((m) => m.content);
    // Both unrelated facts remain active — no false elimination.
    expect(active.some((c) => c.includes("Java"))).toBe(true);
    expect(active.some((c) => c.includes("Python"))).toBe(true);
  });

  it("saves exact duplicate as already-remembered (no double entry)", () => {
    createMemory("My favorite color is blue.", "preferences");
    expect(findDuplicateMemory("My favorite color is blue.")).not.toBeNull();
  });
});
