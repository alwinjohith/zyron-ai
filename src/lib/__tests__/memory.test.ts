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
  buildShortTermContext,
  isTrivialMessage,
  categorizeMemory,
  findDuplicateMemory,
  classifyUserTone,
  buildToneContext,
  buildProjectContext,
  detectProjectIntroduction,
  createProjectContext,
  extractProjectName,
  getActiveProjectContext,
  clearAllProjectContext,
  detectTaskStatement,
  createTaskContext,
  getActiveTaskContext,
  getRecentTasks,
  markActiveTaskInProgress,
  completeActiveTask,
  buildTaskContext,
  taskTitlesMatch,
  clearAllTaskContext,
} from "@/lib/db";

beforeEach(() => {
  clearAllMemories();
  clearAllProjectContext();
  clearAllTaskContext();
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

describe("Stage 5: short-term conversation context", () => {
  it("A: follow-up retains the ESP32 car topic", () => {
    const history = [
      { role: "user", content: "I'm building a car using ESP32." },
    ];
    const ctx = buildShortTermContext("What sensor should I use?", history);

    // The active topic must include the ESP32/car context so the follow-up
    // continues the same thread.
    expect(ctx.activeTopics.length).toBeGreaterThan(0);
    expect(ctx.activeTopics.join(" ").toLowerCase()).toContain("esp32");
    expect(ctx.followUpTopic).toContain("esp32");
  });

  it("B: pronoun 'it' resolves to Java as the likely antecedent", () => {
    const history = [{ role: "user", content: "I prefer Java." }];
    const ctx = buildShortTermContext("Why is it better?", history);

    expect(ctx.pronounHints.length).toBeGreaterThan(0);
    expect(ctx.pronounHints.join(" ").toLowerCase()).toContain("java");
    expect(ctx.followUpTopic).toBeTruthy();
  });

  it("C: 'its memory system' continues the Zyron project context", () => {
    const history = [{ role: "user", content: "Tell me about my Zyron project." }];
    const ctx = buildShortTermContext("What about its memory system?", history);

    expect(ctx.activeTopics.length).toBeGreaterThan(0);
    // Zyron (as a proper noun) should be in the carried-over topics.
    expect(ctx.activeTopics.join(" ").toLowerCase()).toContain("zyron");
    expect(ctx.followUpTopic).toBeTruthy();
  });

  it("D: trivial chit-chat is flagged and needs no broad memory scan", () => {
    // No prior topics: a trivial greeting must be marked trivial.
    const ctx = buildShortTermContext("How are you?", []);
    expect(ctx.isTrivial).toBe(true);
    expect(ctx.activeTopics.length).toBe(0);

    // The raw fast-path helper also flags common fillers.
    expect(isTrivialMessage("Hello")).toBe(true);
    expect(isTrivialMessage("Hi")).toBe(true);
    expect(isTrivialMessage("How are you?")).toBe(true);
    expect(isTrivialMessage("Thanks")).toBe(true);
    expect(isTrivialMessage("Okay")).toBe(true);
  });

  it("D2: legitimate short questions are NOT treated as trivial", () => {
    // A real question with a subject must not be skipped by the fast path.
    expect(isTrivialMessage("What is my project status?")).toBe(false);
    expect(isTrivialMessage("What sensor should I use?")).toBe(false);
    expect(isTrivialMessage("Is Java better than Python?")).toBe(false);
  });

  it("E: ambiguous pronoun with no evidence assigns no aggressive topic", () => {
    // No prior conversation => no antecedent, no follow-up target.
    const ctx = buildShortTermContext("It is good.", []);
    expect(ctx.pronounHints.length).toBe(0);
    expect(ctx.followUpTopic).toBeNull();
    expect(ctx.activeTopics.length).toBe(0);
  });

  it("F: trivial message still yields no memory retrieval", () => {
    // Storing one relevant memory; a trivial greeting must not surface it.
    createMemory("My favorite color is blue.", "preferences");
    const relevant = getRelevantMemories("Hi");
    expect(relevant.length).toBe(0);
  });
});

describe("Stage 5: follow-up retrieval coupling", () => {
  it("A: ESP32 car follow-up retrieves the relevant project memory", () => {
    createMemory("I'm building a car using ESP32.", "projects");
    const history = [{ role: "user", content: "I'm building a car using ESP32." }];

    // The follow-up carries the resolved topic "esp32" and no topic of its own.
    const relevant = getRelevantMemories(
      "What sensor should I use?",
      history,
      MAX_RELEVANT_MEMORIES,
      "esp32"
    );
    const texts = relevant.map((m) => m.content);
    expect(texts.some((c) => c.toLowerCase().includes("esp32"))).toBe(true);
  });

  it("B: 'Why is it better?' retains Java context and retrieves it", () => {
    createMemory("I prefer Java.", "preferences");
    const history = [{ role: "user", content: "I prefer Java." }];

    const ctx = buildShortTermContext("Why is it better?", history);
    expect(ctx.followUpTopic).toBeTruthy();

    const relevant = getRelevantMemories(
      "Why is it better?",
      history,
      MAX_RELEVANT_MEMORIES,
      ctx.followUpTopic
    );
    const texts = relevant.map((m) => m.content);
    expect(texts.some((c) => c.toLowerCase().includes("java"))).toBe(true);
  });

  it("C: 'its memory system' retains the Zyron project context", () => {
    createMemory("I am building the Zyron project.", "projects");
    const history = [{ role: "user", content: "Tell me about my Zyron project." }];

    const ctx = buildShortTermContext("What about its memory system?", history);
    expect(ctx.followUpTopic).toBeTruthy();

    const relevant = getRelevantMemories(
      "What about its memory system?",
      history,
      MAX_RELEVANT_MEMORIES,
      ctx.followUpTopic
    );
    const texts = relevant.map((m) => m.content);
    expect(texts.some((c) => c.toLowerCase().includes("zyron"))).toBe(true);
  });

  it("D: 'How are you?' still avoids long-term memory retrieval", () => {
    createMemory("My favorite color is blue.", "preferences");

    const ctx = buildShortTermContext("How are you?", []);
    const relevant = getRelevantMemories("How are you?");
    expect(ctx.isTrivial).toBe(true);
    expect(relevant.length).toBe(0);
  });

  it("E: 'It is good.' with no prior topic invents no antecedent and retrieves nothing", () => {
    createMemory("My favorite color is blue.", "preferences");

    const ctx = buildShortTermContext("It is good.", []);
    expect(ctx.followUpTopic).toBeNull();
    expect(ctx.pronounHints.length).toBe(0);

    // No follow-up topic => the fallback path must not fabricate a match.
    const relevant = getRelevantMemories("It is good.", []);
    expect(relevant.length).toBe(0);
  });
});

describe("Stage 6: emotional / tone context", () => {
  it("A: positive achievement is detected", () => {
    expect(classifyUserTone("I finally finished my project!")).toBe("positive");
    expect(classifyUserTone("Great news — I got the offer!")).toBe("positive");
  });

  it("B: distress / failure is detected", () => {
    expect(classifyUserTone("I failed my exam today.")).toBe("distress");
    expect(classifyUserTone("I'm really frustrated with this.")).toBe("distress");
    expect(classifyUserTone("I'm stuck and can't figure this out.")).toBe("distress");
  });

  it("C: casual tone is detected", () => {
    expect(classifyUserTone("Bro, help me fix this bug.")).toBe("casual");
  });

  it("D: educational / neutral explanation requests are detected", () => {
    expect(classifyUserTone("Explain what a CPU is.")).toBe("educational");
    expect(classifyUserTone("What is a CPU?")).toBe("educational");
  });

  it("E: ordinary neutral messages carry no tone directive", () => {
    const ctx = buildToneContext("What time is it?");
    expect(ctx.tone).toBe("neutral");
    expect(ctx.hasTone).toBe(false);
  });

  it("F: memory creation is not interfered with (personality detection is read-only)", () => {
    // A memory-save request must not be treated as an emotional tone directive.
    const ctx = buildToneContext("Remember that I like Java.");
    expect(ctx.hasTone).toBe(false);

    // Saving the memory still works exactly as before.
    const category = categorizeMemory("Remember that I like Java.");
    resolveMemoryConflict("Remember that I like Java.", category);
    createMemory("Remember that I like Java.", category);
    const active = getAllMemories().map((m) => m.content);
    expect(active.some((c) => c.includes("Java"))).toBe(true);
  });

  it("G: tone detection never persists anything to the database", () => {
    buildToneContext("I finally finished my project!");
    buildToneContext("I'm really frustrated with this.");

    // No rows should have been created by tone detection alone.
    expect(getAllMemories().length).toBe(0);
  });

  it("H: distress is prioritized over weaker signals", () => {
    // A distress signal should win even if a casual marker is also present.
    expect(
      classifyUserTone("Bro, I'm so frustrated with this bug.")
    ).toBe("distress");
  });

  it("I: empty / trivial content is neutral", () => {
    expect(classifyUserTone("")).toBe("neutral");
    expect(classifyUserTone("Hi")).toBe("neutral");
  });
});

describe("Stage 7: project & goal awareness", () => {
  it("A: detects an explicit project introduction", () => {
    expect(detectProjectIntroduction("I'm building an ESP32 car.")).toBe(true);
    expect(
      detectProjectIntroduction("I am developing a web app with React.")
    ).toBe(true);
  });

  it("B: does not detect ordinary conversation or questions as projects", () => {
    expect(detectProjectIntroduction("What's the weather today?")).toBe(false);
    expect(detectProjectIntroduction("The sensor isn't working.")).toBe(false);
    expect(detectProjectIntroduction("I like pizza.")).toBe(false);
    expect(detectProjectIntroduction("How are you?")).toBe(false);
  });

  it("C: creates an active project context for an intro", () => {
    const project = createProjectContext("ESP32 car", "I'm building an ESP32 car.");
    expect(project.name).toBe("ESP32 car");
    expect(getActiveProjectContext()?.name).toBe("ESP32 car");
  });

  it("D: only one project is active at a time (new intro replaces old)", () => {
    createProjectContext("ESP32 car", "I'm building an ESP32 car.");
    createProjectContext("Zyron", "I'm building Zyron.");

    const active = getActiveProjectContext();
    expect(active?.name).toBe("Zyron");

    const db = getDb();
    const all = db
      .prepare("SELECT * FROM project_context ORDER BY id")
      .all() as Array<{ is_active: number }>;
    // Both rows still exist; only the newest is active.
    expect(all.filter((r) => r.is_active === 1)).toHaveLength(1);
  });

  it("E: extracts a project name from an intro message", () => {
    expect(extractProjectName("I'm building an ESP32 car.")).toBe("ESP32 car");
    expect(extractProjectName("Let's build a smart home system.")).toBeTruthy();
  });

  it("F: a specific follow-up with its own project entity is associated", () => {
    createProjectContext("ESP32 car", "I'm building an ESP32 car.");

    const ctx = buildProjectContext(
      "The sensor isn't working.",
      ["esp32", "car"],
      false
    );

    expect(ctx.section).toContain("ESP32 car");
    expect(ctx.isFollowUp).toBe(true);
  });

  it("G: a bare substantive follow-up attaches to a specific active project", () => {
    createProjectContext("ESP32 car", "I'm building an ESP32 car.");

    const ctx = buildProjectContext("The sensor isn't working.", [], false);
    expect(ctx.isFollowUp).toBe(true);
    expect(ctx.section).toContain("ESP32 car");
  });

  it("H: an unrelated message with its own distinct topic is NOT a follow-up", () => {
    createProjectContext("ESP32 car", "I'm building an ESP32 car.");

    // Even though the ESP32 topic is still active in the conversation, a
    // general-knowledge weather question must not be forced into the project.
    const ctx = buildProjectContext(
      "What's the weather today?",
      ["esp32", "car", "weather"],
      false
    );
    expect(ctx.isFollowUp).toBe(false);
  });

  it("H2: an unrelated question after a project message is NOT forced in", () => {
    createProjectContext("ESP32 car", "I'm building an ESP32 car.");

    // "it" carries no own topic; but "What time is it?" is generic knowledge.
    const ctx = buildProjectContext(
      "What time is it?",
      ["esp32", "car"],
      false
    );
    expect(ctx.isFollowUp).toBe(false);
  });

  it("H3: stage references attach as a follow-up only with existing evidence", () => {
    createProjectContext("ESP32 car", "I'm building an ESP32 car.");

    // "Stage 6" mentions project-work, but recent topics contain no ESP32
    // evidence, so it stays ambiguous.
    const noEvidence = buildProjectContext("I finished Stage 6.", [], false);
    expect(noEvidence.isFollowUp).toBe(false);

    // With recent conversation mentioning the project, it becomes a follow-up.
    const withEvidence = buildProjectContext(
      "I finished Stage 6.",
      ["esp32"],
      false
    );
    expect(withEvidence.isFollowUp).toBe(true);
  });

  it("I: ambiguous bare messages without a specific project are NOT forced in", () => {
    // A project with only generic words offers no strong evidence.
    createProjectContext("Projects", "I'm building projects.");

    const ctx = buildProjectContext("What's next?", [], false);
    expect(ctx.isFollowUp).toBe(false);
  });

  it("J: project context does not interfere with memory creation/retrieval", () => {
    createProjectContext("ESP32 car", "I'm building an ESP32 car.");

    // Normal memory creation still works.
    createMemory("My favorite color is green.", "preferences");
    const relevant = getRelevantMemories("What is my favorite color?");
    const texts = relevant.map((m) => m.content);
    expect(texts.some((c) => c.includes("green"))).toBe(true);

    // Project context rows are separate from memories.
    expect(getAllMemories().length).toBe(1);
  });

  it("K: project intro does not become a memory row", () => {
    const project = createProjectContext("ESP32 car", "I'm building an ESP32 car.");
    expect(project).toBeTruthy();
    expect(getAllMemories().length).toBe(0);
  });
});

describe("Stage 8: planning & task awareness", () => {
  it("A: detects and creates an active task from a first-person commitment", () => {
    const stmt = detectTaskStatement("I need to connect the motor driver.");
    expect(stmt.kind).toBe("create");
    expect(stmt.title).toBe("Connect the motor driver");

    createTaskContext(stmt.title!);
    const active = getActiveTaskContext();
    expect(active?.title).toBe("Connect the motor driver");
    expect(active?.status).toBe("planned");
    expect(active?.is_active).toBe(1);
  });

  it("B: detects multiple create phrasings", () => {
    expect(detectTaskStatement("I have to solder the pins.").kind).toBe("create");
    expect(detectTaskStatement("My next step is to flash the firmware.").kind).toBe("create");
    expect(detectTaskStatement("Next I'll wire the power supply.").kind).toBe("create");
    expect(detectTaskStatement("I'm going to mount the board.").kind).toBe("create");
  });

  it("C: does not create tasks from questions, help requests, or fillers", () => {
    expect(detectTaskStatement("What's the weather?")).toEqual({
      kind: "question",
      title: null,
    });
    expect(detectTaskStatement("I need help with the code.").kind).toBe("none");
    expect(detectTaskStatement("I have to go now.").kind).toBe("none");
    expect(detectTaskStatement("I like pizza.").kind).toBe("none");
    expect(detectTaskStatement("I'm stuck.").kind).toBe("none");
    expect(detectTaskStatement("Hello!").kind).toBe("none");
    expect(detectTaskStatement("Can you help me?").kind).toBe("none");
  });

  it("D: a task snapshots the active project name as project_ref", () => {
    createProjectContext("ESP32 car", "I'm building an ESP32 car.");

    const task = createTaskContext("Connect the motor driver");
    expect(task.project_ref).toBe("ESP32 car");
    expect(getActiveTaskContext()?.project_ref).toBe("ESP32 car");
  });

  it("E: only one task is active at a time (new task supersedes old)", () => {
    createTaskContext("Connect the motor driver");
    createTaskContext("Solder the pins");

    const active = getActiveTaskContext();
    expect(active?.title).toBe("Solder the pins");

    const db = getDb();
    const all = db
      .prepare("SELECT * FROM task_context ORDER BY id")
      .all() as Array<{ is_active: number }>;
    // Both rows still exist; only the newest is active.
    expect(all.filter((r) => r.is_active === 1)).toHaveLength(1);
    expect(all).toHaveLength(2);
  });

  it("F: progress that matches the active task updates it in place", () => {
    createTaskContext("Connect the motor driver");

    const stmt = detectTaskStatement("I'm working on the motor driver now.");
    expect(stmt.kind).toBe("progress");

    markActiveTaskInProgress();
    expect(getActiveTaskContext()?.status).toBe("in_progress");

    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) AS c FROM task_context").get() as {
      c: number;
    };
    expect(count.c).toBe(1); // no new row was created
  });

  it("G: progress with a clearly different object starts a new in_progress task", () => {
    createTaskContext("Connect the motor driver");

    const stmt = detectTaskStatement("I'm working on the display panel.");
    expect(stmt.kind).toBe("create");
    expect(stmt.status).toBe("in_progress");

    createTaskContext(stmt.title!, "in_progress");
    expect(getActiveTaskContext()?.title).toBe("Display panel");
    expect(getActiveTaskContext()?.status).toBe("in_progress");
  });

  it("H: completing a matching task archives it", () => {
    createTaskContext("Build the sensor circuit");

    expect(detectTaskStatement("I finished the sensor circuit.").kind).toBe("done");
    completeActiveTask();

    expect(getActiveTaskContext()).toBeNull();

    const db = getDb();
    const row = db
      .prepare("SELECT * FROM task_context WHERE title = 'Build the sensor circuit'")
      .get() as { status: string; is_active: number };
    expect(row.status).toBe("done");
    expect(row.is_active).toBe(0);
  });

  it("I: anaphoric completion ('I finished it.') completes the active task", () => {
    createTaskContext("Connect the motor driver");
    expect(detectTaskStatement("I finished it.").kind).toBe("done");
  });

  it("J: a done statement about an unrelated object is a no-op", () => {
    createTaskContext("Connect the motor driver");

    expect(detectTaskStatement("I finished the oven.").kind).toBe("none");

    // The active task is untouched.
    expect(getActiveTaskContext()?.title).toBe("Connect the motor driver");
  });

  it("K: completion without a matching task is a no-op", () => {
    expect(detectTaskStatement("I finished it.").kind).toBe("none");
    completeActiveTask();
    expect(getActiveTaskContext()).toBeNull();
  });

  it("L: 'What's next?' surfaces the active task but persists nothing", () => {
    createTaskContext("Connect the motor driver");

    const ctx = buildTaskContext("What's next?", [], false);
    expect(ctx.isTaskRelated).toBe(true);
    expect(ctx.section).toContain("Connect the motor driver");
    expect(ctx.section).toContain("planned");

    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) AS c FROM task_context").get() as {
      c: number;
    };
    expect(count.c).toBe(1);
  });

  it("M: 'What have I done?' lists recent tasks without persisting", () => {
    createTaskContext("Connect the motor driver");
    completeActiveTask();

    const ctx = buildTaskContext("What have I done?", [], false);
    expect(ctx.isTaskRelated).toBe(true);
    expect(ctx.section).toContain("Connect the motor driver");
    expect(ctx.section).toContain("(done)");

    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) AS c FROM task_context").get() as {
      c: number;
    };
    expect(count.c).toBe(1);
  });

  it("N: 'What's next?' without an active task does not fabricate a section", () => {
    const ctx = buildTaskContext("What's next?", [], false);
    expect(ctx.isTaskRelated).toBe(false);
    expect(ctx.section).toBe("");
  });

  it("O: an anaphoric question is a task follow-up", () => {
    createTaskContext("Connect the motor driver");

    const ctx = buildTaskContext("Does it need a capacitor?", [], false);
    expect(ctx.isTaskRelated).toBe(true);
    expect(ctx.section).toContain("Connect the motor driver");
  });

  it("P: unrelated general-knowledge questions are NOT task follow-ups", () => {
    createTaskContext("Connect the motor driver");

    const ctx = buildTaskContext("What's the weather today?", ["esp32", "car"], false);
    expect(ctx.isTaskRelated).toBe(false);
    expect(ctx.section).toBe("");
  });

  it("Q: unrelated messages never attach to the task", () => {
    createTaskContext("Connect the motor driver");

    expect(detectTaskStatement("I like pizza.").kind).toBe("none");

    const ctx = buildTaskContext("The weather forecast looks nice.", ["esp32"], false);
    expect(ctx.isTaskRelated).toBe(false);

    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) AS c FROM task_context").get() as {
      c: number;
    };
    expect(count.c).toBe(1);
  });

  it("R: sequential tasks keep history and a single active task", () => {
    createTaskContext("Connect the motor driver");
    createTaskContext("Solder the pins");
    completeActiveTask();

    expect(getActiveTaskContext()).toBeNull();
    const recent = getRecentTasks(3);
    expect(recent.map((t) => t.title)).toEqual([
      "Solder the pins",
      "Connect the motor driver",
    ]);
  });

  it("S: task tracking does not create or interfere with memories", () => {
    createTaskContext("Connect the motor driver");
    expect(getAllMemories().length).toBe(0);

    createMemory("My favorite color is green.", "preferences");
    expect(getAllMemories().length).toBe(1);

    const relevant = getRelevantMemories("What is my favorite color?");
    expect(relevant.map((m) => m.content).some((c) => c.includes("green"))).toBe(true);
  });

  it("T: task rows never appear in memory retrieval/listings", () => {
    createTaskContext("Connect the motor driver");
    expect(getAllMemories().length).toBe(0);
    expect(getAllMemoriesIncludingArchived().length).toBe(0);
    expect(getRelevantMemories("motor driver").length).toBe(0);
  });

  it("U: task statements do not change project context", () => {
    createProjectContext("ESP32 car", "I'm building an ESP32 car.");

    createTaskContext("Connect the motor driver");
    expect(getActiveProjectContext()?.name).toBe("ESP32 car");
  });

  it("V: project context is untouched when a task is completed", () => {
    createProjectContext("ESP32 car", "I'm building an ESP32 car.");

    createTaskContext("Connect the motor driver");
    completeActiveTask();

    expect(getActiveProjectContext()?.name).toBe("ESP32 car");
  });

  it("W: taskTitlesMatch distinguishes close and unrelated tasks", () => {
    expect(taskTitlesMatch("Connect the motor driver", "the motor driver")).toBe(true);
    expect(taskTitlesMatch("Connect the motor driver", "Write the ADC code")).toBe(false);
  });

  it("X: conflict resolution still archives conflicting memories when a task exists", () => {
    createTaskContext("Connect the motor driver");
    createMemory("My favorite programming language is Python.", "preferences");

    const resolution = resolveMemoryConflict(
      "Actually, my favorite programming language is Java.",
      "preferences"
    );
    createMemory("Actually, my favorite programming language is Java.", "preferences");
    expect(resolution.action).toBe("archived");

    const active = getAllMemories().map((m) => m.content);
    expect(active.some((c) => c.includes("Java"))).toBe(true);
  });

  it("Y: a task statement in the same turn surfaces as task context", () => {
    createTaskContext("Connect the motor driver");

    const ctx = buildTaskContext("I'm working on it.", [], false);
    expect(ctx.isTaskRelated).toBe(true);
    expect(ctx.section).toContain("Connect the motor driver");
  });
});
