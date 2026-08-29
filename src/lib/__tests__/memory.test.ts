import { describe, it, expect, beforeEach } from "vitest";
import {
  clearAllMemories,
  createMemory,
  resolveMemoryConflict,
  getAllMemories,
  getAllMemoriesIncludingArchived,
  getRelevantMemories,
  getDb,
  searchMemories,
  MAX_RELEVANT_MEMORIES,
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

describe("Stage 4: memory retrieval quality", () => {
  it("1: searchMemories never returns archived memories (no leak)", () => {
    createMemory("My favorite programming language is Python.", "preferences");
    const content = "Actually, my favorite programming language is Java.";
    resolveMemoryConflict(content, categorizeMemory(content));
    createMemory(content, "preferences");

    const viaSearch = searchMemories("programming");
    expect(viaSearch.some((m) => m.content.includes("Python"))).toBe(false);
    expect(viaSearch.some((m) => m.content.includes("Java"))).toBe(true);
  });

  it("2: searchMemories respects its limit argument", () => {
    createMemory("I like Python for data.", "preferences");
    createMemory("I like Java for Android.", "preferences");
    createMemory("I like Rust for systems.", "preferences");

    const limited = searchMemories("like", 2);
    expect(limited.length).toBeLessThanOrEqual(2);
  });

  it("3: fresher fact is retrieved and older stale one is not (recency/conflict)", () => {
    createMemory("My favorite programming language is Python.", "preferences");
    const content = "Actually, my favorite programming language is Java.";
    resolveMemoryConflict(content, categorizeMemory(content));
    createMemory(content, "preferences");

    const relevant = getRelevantMemories("What is my favorite programming language?");
    const texts = relevant.map((m) => m.content);
    expect(texts.some((c) => c.includes("Java"))).toBe(true);
    expect(texts.some((c) => c.includes("Python"))).toBe(false);
  });

  it("4: newer active memory outranks an older active one on recency", () => {
    const older = createMemory("I am learning Python.", "preferences");
    const newer = createMemory("I am learning Rust.", "preferences");

    // Directly set distinct ages so the recency bonus differentiates them.
    const db = getDb();
    db.prepare("UPDATE memories SET updatedAt = datetime('now', '-60 days') WHERE id = ?")
      .run(older.id);
    db.prepare("UPDATE memories SET updatedAt = datetime('now') WHERE id = ?")
      .run(newer.id);

    const relevant = getRelevantMemories("Recommend a language I am learning.");
    // Both are learning-language facts; the fresher one must appear first.
    expect(relevant.length).toBeGreaterThan(0);
    expect(relevant[0].content).toContain("Rust");
  });

  it("5: request_advice with no topical anchor injects few/no broad memories", () => {
    // A personal name fact and a far-away project fact share no topic with the
    // unanchored advice request, so they must NOT all be injected just because
    // "request_advice" previously defaulted to all four categories.
    createMemory("My name is Alice.", "personal");
    createMemory("I am building the Mars rover.", "projects");

    const relevant = getRelevantMemories("Can you suggest something?");
    const texts = relevant.map((m) => m.content);
    expect(texts.some((c) => c.includes("Mars"))).toBe(false);
    expect(texts.some((c) => c.includes("Alice"))).toBe(false);
  });

  it("6: unrelated memories are excluded (score below threshold)", () => {
    createMemory("I am an ECE student.", "education");
    createMemory("My favorite color is blue.", "preferences");

    const relevant = getRelevantMemories("What is my favorite color?");
    const texts = relevant.map((m) => m.content);
    expect(texts.some((c) => c.includes("blue"))).toBe(true);
    expect(texts.some((c) => c.includes("ECE"))).toBe(false);
  });

  it("7: never more than MAX_RELEVANT_MEMORIES are returned", () => {
    for (let i = 0; i < 8; i++) {
      createMemory(`I am working on project number ${i}.`, "projects");
    }
    const relevant = getRelevantMemories("Which project should I work on?");
    expect(relevant.length).toBeLessThanOrEqual(MAX_RELEVANT_MEMORIES);
  });

  it("8: SQL pre-filtering matches full-scan results (no regression)", () => {
    createMemory("I am an ECE student.", "education");
    createMemory("My favorite color is blue.", "preferences");
    createMemory("I am building a smart car with ESP32.", "projects");

    const relevant = getRelevantMemories("What is my favorite color?");
    const texts = relevant.map((m) => m.content);
    expect(texts.some((c) => c.includes("blue"))).toBe(true);
    // The ECE and ESP32 facts describe unrelated topics and must be absent.
    expect(texts.some((c) => c.includes("ECE"))).toBe(false);
    expect(texts.some((c) => c.includes("ESP32"))).toBe(false);
  });

  it("9: existing Stage 3 retrieval behavior is preserved (newest value wins)", () => {
    createMemory("My favorite programming language is Python.", "preferences");
    const content = "Actually, my favorite programming language is Java.";
    resolveMemoryConflict(content, categorizeMemory(content));
    createMemory(content, "preferences");

    const relevant = getRelevantMemories("What is my favorite programming language?");
    const texts = relevant.map((m) => m.content);
    expect(texts.some((c) => c.includes("Java"))).toBe(true);
    expect(texts.some((c) => c.includes("Python"))).toBe(false);
  });
});
