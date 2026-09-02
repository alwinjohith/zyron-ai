import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type {
  MemoryCategory,
  RelevantMemory,
  ToneContext,
  ToneIntent,
} from "@/types/memory";

// Path to the SQLite database file
// Stored in the project root so it persists between restarts.
// Overridable via MEMORY_DB_PATH so tests can run against an isolated
// database without touching production data.
const DB_PATH =
  process.env.MEMORY_DB_PATH || path.join(process.cwd(), "data", "memory.db");

// Singleton database instance
let db: Database.Database | null = null;

/**
 * Get or create the database connection.
 * Creates the database file and tables if they don't exist.
 */
export function getDb(): Database.Database {
  if (db) return db;

  // Ensure the data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Create the database connection
  db = new Database(DB_PATH);

  // Enable WAL mode for better performance
  db.pragma("journal_mode = WAL");

  // Create the memories table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      is_active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Stage 3 migration: add the is_active column to databases that were
  // created before the conflict/archive system existed.
  const columns = db.prepare("PRAGMA table_info(memories)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((c) => c.name === "is_active")) {
    db.exec("ALTER TABLE memories ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
  }

  // Stage 7: lightweight active project context (additive, no migration of memories).
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_context (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      goal TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Stage 8: lightweight active task context (additive, no migration).
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_context (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned','in_progress','done')),
      project_ref TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_task_context_active ON task_context (is_active, updatedAt)"
  );

  return db;
}

/**
 * Save a new memory to the database.
 */
export function createMemory(content: string, category: string = "general") {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO memories (content, category) VALUES (?, ?)"
  );
  const result = stmt.run(content, category);

  // Return the newly created memory
  return {
    id: Number(result.lastInsertRowid),
    content,
    category,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Get all ACTIVE stored memories, ordered by newest first.
 * Archived (outdated/conflicting) memories are excluded so they are never
 * used for retrieval, listing, or personalization.
 */
export function getAllMemories() {
  const db = getDb();
  const stmt = db.prepare(
    "SELECT * FROM memories WHERE is_active = 1 ORDER BY createdAt DESC"
  );
  return stmt.all() as Array<{
    id: number;
    content: string;
    category: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

/**
 * Get every stored memory — including archived (inactive) history.
 * Used internally for debugging/history; archived rows are never shown
 * to the user or used for normal personalization.
 */
export function getAllMemoriesIncludingArchived() {
  const db = getDb();
  const stmt = db.prepare(
    "SELECT * FROM memories ORDER BY createdAt DESC"
  );
  return stmt.all() as Array<{
    id: number;
    content: string;
    category: string;
    is_active: number;
    createdAt: string;
    updatedAt: string;
  }>;
}

/**
 * Get a single memory by its ID.
 */
export function getMemoryById(id: number) {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM memories WHERE id = ?");
  return stmt.get(id) as
    | { id: number; content: string; category: string; createdAt: string; updatedAt: string }
    | undefined;
}

/**
 * Delete a memory by its ID.
 * Returns true if deleted, false if not found.
 */
export function deleteMemory(id: number): boolean {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM memories WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Delete all memories.
 * Returns the number of deleted records.
 */
export function clearAllMemories(): number {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM memories");
  const result = stmt.run();
  return result.changes;
}

/**
 * Archive a memory (mark it inactive) instead of deleting it.
 * Archived memories are kept as history but excluded from retrieval,
 * listing, and all normal personalization. Returns true if archived.
 */
export function archiveMemory(id: number): boolean {
  const db = getDb();
  const stmt = db.prepare(
    "UPDATE memories SET is_active = 0, updatedAt = datetime('now') WHERE id = ? AND is_active = 1"
  );
  return stmt.run(id).changes > 0;
}

/**
 * Search memories by content (simple text matching).
 * Used to find relevant memories for context injection.
 * Only ACTIVE (non-archived) memories are returned, and results are limited
 * to `limit` rows (default MAX_RELEVANT_MEMORIES). Archived memories are
 * excluded so they never leak into retrieval.
 */
export function searchMemories(
  query: string,
  limit: number = MAX_RELEVANT_MEMORIES
) {
  const db = getDb();
  const stmt = db.prepare(
    "SELECT * FROM memories WHERE is_active = 1 AND content LIKE ? ORDER BY createdAt DESC LIMIT ?"
  );
  return stmt.all(`%${query}%`, limit) as Array<{
    id: number;
    content: string;
    category: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

/**
 * Normalize memory content for comparison.
 * Lowercases, trims, and collapses repeated whitespace.
 */
export function normalizeMemoryContent(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Check if a memory with equivalent content already exists.
 * Returns the existing memory if found, or null.
 */
export function findDuplicateMemory(content: string) {
  const normalized = normalizeMemoryContent(content);
  const db = getDb();
  const all = db
    .prepare("SELECT * FROM memories WHERE is_active = 1 ORDER BY createdAt DESC")
    .all() as Array<{
    id: number;
    content: string;
    category: string;
    createdAt: string;
    updatedAt: string;
  }>;
  for (const memory of all) {
    if (normalizeMemoryContent(memory.content) === normalized) {
      return memory;
    }
  }
  return null;
}

/**
 * Update an existing memory's content and category.
 */
export function updateMemory(
  id: number,
  content: string,
  category?: string
) {
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM memories WHERE id = ?")
    .get(id) as
    | { id: number; content: string; category: string; createdAt: string; updatedAt: string }
    | undefined;
  if (!existing) return null;

  const newContent = content;
  const newCategory = category ?? existing.category;

  db.prepare(
    "UPDATE memories SET content = ?, category = ?, updatedAt = datetime('now') WHERE id = ?"
  ).run(newContent, newCategory, id);

  return {
    id,
    content: newContent,
    category: newCategory,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Categorize a memory based on keyword rules.
 * Simple deterministic approach — no LLM call.
 *
 * Order matters: personal and preferences are checked first because they
 * contain broad keywords (e.g. "I am", "like") that could false-match
 * other categories. More specific patterns first.
 */
export function categorizeMemory(content: string): string {
  const lower = content.toLowerCase();

  // --- personal: explicit identity markers ONLY ---
  // NO generic "I am" — that catches unrelated sentences.
  if (
    /\b(my name is|name is|i am called|people call me|i'm named|my full name|call me|i am [a-z]+\.?$)/.test(lower) ||
    /\b(my age|my birthday|my email|my phone|my address|my city|my country|i live in|i'm from|about me)\b/.test(lower)
  ) {
    return "personal";
  }

  // --- preferences: likes, dislikes, favorites, habits ---
  if (
    /\b(prefer|preference|like to|like\b|love|hate|favorite|favourite|dislike|enjoy|hobby|hobbies|interest|passion|style|taste|best|worst|always|never|usually|i use|i don't like|i prefer|my favorite)\b/.test(lower)
  ) {
    return "preferences";
  }

  // --- education: study, school, courses ---
  if (
    /\b(studying|student|study|learn|learning|course|university|college|school|degree|ece|engineering|major|class|professor|lecture|exam|gpa|graduate|academic|thesis|homework|assignment|education|semester|curriculum|teacher|tutor)\b/.test(lower)
  ) {
    return "education";
  }

  // --- goals: aspirations, future plans ---
  if (
    /\b(goal|want to|aim|aspiration|dream|future|plan|hoping|objective|target|achieve|become|someday|career|ambition|intend|plan to|hoping to|want to be|want to become)\b/.test(lower)
  ) {
    return "goals";
  }

  // --- projects: building, creating, coding ---
  if (
    /\b(build|building|creating|created|project|app|website|code|coding|program|programming|software|startup|develop|developing|development|repository|repo|github|npm|framework|api|database|working on|built|developed)\b/.test(lower)
  ) {
    return "projects";
  }

  return "general";
}

/**
 * Recalculate categories for all existing memories.
 * Uses the same rules as categorizeMemory().
 * Safe to call multiple times — updates any memory whose
 * category differs from what the rules would produce.
 */
export function recategorizeAllMemories(): number {
  const db = getDb();
  const all = db
    .prepare("SELECT * FROM memories")
    .all() as Array<{
    id: number;
    content: string;
    category: string;
    createdAt: string;
    updatedAt: string;
  }>;

  let updated = 0;
  const stmt = db.prepare(
    "UPDATE memories SET category = ?, updatedAt = datetime('now') WHERE id = ?"
  );

  for (const memory of all) {
    const correctCategory = categorizeMemory(memory.content);
    if (memory.category !== correctCategory) {
      stmt.run(correctCategory, memory.id);
      updated++;
    }
  }

  return updated;
}

// Words too common to indicate a specific topic match.
const GENERIC_TOPIC_WORDS = new Set([
  "project", "projects", "app", "apps", "application", "applications",
  "work", "works", "car", "language", "languages", "code", "coding",
  "goal", "goals", "plan", "plans", "like", "love", "favorite", "favourite",
  "name", "student", "students", "school", "thing", "things", "stuff",
  "building", "build", "smart", "new", "use", "using", "do", "doing",
  "job", "jobs", "day", "days", "week", "weeks", "time",
]);

// Programming languages used to detect a language-preference change.
const LANGUAGES = new Set([
  "python", "javascript", "typescript", "java", "c++", "c#", "kotlin",
  "swift", "rust", "php", "ruby", "sql", "html", "css", "bash", "perl",
  "scala", "dart", "lua", "matlab", "julia", "haskell", "elixir",
  "clojure", "golang", "node", "nodejs", "django", "flask", "react",
  "react-native", "vue", "angular", "nextjs", "svelte",
]);

// Common filler words excluded from topic tokens.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "so", "this",
  "that", "these", "those", "i", "im", "i'm", "my", "me", "you", "your",
  "we", "our", "us", "they", "them", "their", "it", "its", "he", "him",
  "his", "she", "her", "to", "for", "with", "about", "as", "at", "by",
  "from", "in", "into", "of", "on", "over", "under", "up", "down", "out",
  "here", "there", "all", "any", "both", "each", "few", "more", "most",
  "other", "some", "such", "only", "own", "same", "than", "too", "very",
  "can", "will", "would", "could", "should", "may", "might", "must",
  "is", "are", "was", "were", "be", "been", "being", "am", "have", "has",
  "had", "do", "does", "did", "doing", "done", "not", "no", "nor", "just",
  "actually", "currently", "really", "so", "now", "also", "ok", "okay",
  "yes", "what", "which", "who", "whom", "whose", "when", "where", "why",
  "how", "working", "focusing", "focus", "want", "need", "would", "will",
]);

/**
 * Extract meaningful topic tokens from text.
 * Lowercases, tokenizes on word characters (keeps "+"/"#" for C++/C#),
 * and drops stopwords.
 */
function extractTopicTokens(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens = lower.match(/[a-z0-9+#]+/g) || [];
  return tokens.filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

interface MemoryRow {
  id: number;
  content: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

interface MatchContext {
  newTokens: string[];
  newTokenSet: Set<string>;
  newLangs: string[];
}

/**
 * Phrases that indicate the user is NEGATING or giving up on something.
 * Used to detect removal during conflict resolution.
 */
const REMOVAL_SIGNAL_PATTERNS: RegExp[] = [
  /\bno longer\b/i,
  /\bnot anymore\b/i,
  /\banymore\b/i,
  /\bstopped\b/i,
  /\bquit\b/i,
  /\bgave up\b/i,
  /\bmoved on from\b/i,
  /\bdon'?t (like|use|love|want|enjoy|prefer|work on|do)\b/i,
  /\bdo not (like|use|love|want|enjoy|prefer|work on|do)\b/i,
  /\bnot (into|a fan of|using|doing|working on)\b/i,
  /\bcancelled my\b/i,
  /\bchanged my mind about\b/i,
];

/**
 * Phrases that indicate the user CHANGED / replaced something.
 * Used to detect updates during conflict resolution.
 */
const UPDATE_SIGNAL_PATTERNS: RegExp[] = [
  /\bfocusing on\b/i,
  /\bswitching (to|over to)\b/i,
  /\bchanged (to|it to|my mind to)\b/i,
  /\b(started|starting) (to )?(use|like|prefer|work on|learn|study|build|focus on)\b/i,
  /\bmoved on to\b/i,
  /\bthese days\b/i,
  /\bnow (use|using|prefer|like|focusing|working|studying|learning|do|doing)\b/i,
  /\b(use|using|prefer|like|focusing on|working on|studying|learning) [a-z0-9+#.]+ now\b/i,
  /\binstead\b/i,
];

/** True when the text says something is being given up / removed. */
export function hasRemovalSignal(text: string): boolean {
  return REMOVAL_SIGNAL_PATTERNS.some((re) => re.test(text));
}

/** True when the text says something has changed / been replaced. */
export function hasUpdateSignal(text: string): boolean {
  return UPDATE_SIGNAL_PATTERNS.some((re) => re.test(text));
}

/**
 * A fact slot identifies the underlying user fact a memory describes,
 * independent of its current value. Two memories describe the SAME fact
 * when their subject AND attr match (e.g. subject "favorite" + attr
 * "programming language" for both "…favorite is Python" and "…favorite is C++").
 */
interface FactSlot {
  subject: string;
  attr: string;
}

/** Normalize a fact attribute for comparison (lowercase, strip articles/conjunctions). */
function normalizeAttr(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(a|an|the|my|that)\s+/, "")
    .replace(/\s*(?:and|or|&)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when one attribute is the same fact object as another, using
 * token containment so paraphrases still match ("ece" vs "ece student",
 * "esp32 smart car project" vs "the esp32 smart car project").
 */
function attrMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = a.split(" ").filter(Boolean);
  const tb = b.split(" ").filter(Boolean);
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return small.every((t) => large.includes(t));
}

/**
 * Deterministically extract the underlying fact slot from a statement.
 * Returns null when no known fact pattern is recognized.
 */
function extractFactSlot(content: string): FactSlot | null {
  const lower = content.toLowerCase();

  // --- favorite / favourite <thing> ---
  let m = lower.match(
    /\bmy\s+(?:favorite|favourite)\s+([a-z0-9 +#]+?)\s+(?:is|are)\b/
  );
  if (m) return { subject: "favorite", attr: normalizeAttr(m[1]) };

  // --- name ---
  m = lower.match(/\bmy\s+name\s+is\s+([a-z][a-z0-9 ]*)/);
  if (m) return { subject: "name", attr: normalizeAttr(m[1]) };

  // --- prefer / use (incl. "no longer using", "now using") ---
  m = lower.match(
    /\bi(?:'m|\s+am)?\s+(?:now\s+|currently\s+)?(?:no\s+longer\s+)?(?:prefer|using|use)\s+([a-z0-9 +#]+)/
  );
  if (m) return { subject: "preference", attr: normalizeAttr(m[1]) };

  // --- like / love / enjoy / hate / fan of ---
  m = lower.match(
    /\bi(?:'m|\s+am)?\s+(?:(?:no\s+longer|not|don'?t)\s+)?(?:really\s+)?(?:a\s+fan\s+of|into|like|love|loved|enjoy|enjoying|hate|hated)\s+(?:the\s+|my\s+)?([a-z0-9 +#]+)/
  );
  if (m) return { subject: "likes", attr: normalizeAttr(m[1]) };

  // --- student / education status ---
  m = lower.match(
    /\bi\s+am\s+(?:no\s+longer\s+)?(?:an?\s+)?([a-z0-9 +#]+?)\s+(?:student|undergrad|undergraduate)\b/
  );
  if (m) return { subject: "education", attr: normalizeAttr(m[1]) };

  // --- studying / learning / graduated ---
  m = lower.match(
    /\bi(?:'m|\s+am)?\s+(?:no\s+longer\s+)?(?:studying|learning)\s+([a-z0-9 +#]+)/
  );
  if (m) return { subject: "education", attr: normalizeAttr(m[1]) };

  m = lower.match(
    /\bi\s+(?:have\s+)?(?:graduated|graduating)\s+(?:from|in)\s+([a-z0-9 +#]+)/
  );
  if (m) return { subject: "education", attr: normalizeAttr(m[1]) };

  // --- projects (working on / building / developing), incl. removals ---
  m = lower.match(
    /\bi(?:'m|\s+am)?\s+(?:now\s+|currently\s+)?(?:no\s+longer\s+)?(?:working\s+on|building|developing|creating|making)\s+(?:the\s+|my\s+|a\s+|an\s+)?([a-z0-9 +#]+)/
  );
  if (m) return { subject: "project", attr: normalizeAttr(m[1]) };

  // --- stopped / quit / gave up building-or-using <thing> ---
  m = lower.match(
    /\b(?:stopped|quit|gave\s+up|no\s+longer|not\s+anymore)\s+(?:building|working\s+on|developing|creating|making|using|preferring|doing)\s+(?:the\s+|my\s+|a\s+|an\s+)?([a-z0-9 +#]+)/
  );
  if (m) {
    const verb = m[0];
    const subject = /(building|working\s+on|developing|creating|making)/.test(verb)
      ? "project"
      : /(studying|learning)/.test(verb)
        ? "education"
        : "preference";
    return { subject, attr: normalizeAttr(m[1]) };
  }

  // --- goals ---
  m = lower.match(/\bi\s+(?:want\s+to|aim\s+to|plan\s+to|hope\s+to|aspire\s+to)\s+(.+)/);
  if (m) return { subject: "goal", attr: normalizeAttr(m[1]) };

  return null;
}

// ============================================================
// STAGE 4: INTELLIGENT MEMORY RELEVANCE
// ============================================================

/**
 * User message intent classification.
 */
export type UserIntent =
  | "personal_question"     // "what is my name?", "what do I study?"
  | "project_question"      // "how to improve my project?"
  | "preference_question"   // "what do I prefer?", "should I use X?"
  | "education_question"    // "what should I study?"
  | "general_knowledge"     // "capital of France?", "25 * 4"
  | "request_advice"        // "suggest...", "recommend...", "help me..."
  | "statement"             // declarative statements
  | "greeting"              // "hello", "hi"
  | "other";

/**
 * Classify the intent of a user message.
 * Deterministic, rule-based — no external AI calls.
 */
export function classifyUserIntent(message: string): UserIntent {
  const lower = message.toLowerCase().trim();

  // Greetings
  if (/^(hi|hello|hey|good morning|good evening|howdy)\b/.test(lower)) {
    return "greeting";
  }

  // Questions - check for question words
  const isQuestion = lower.endsWith("?") ||
    /^(what|where|when|who|why|how|which|whose|can you|could you|do you|does|is|are|am i|should i|would you|will you)\b/.test(lower);

  // Request for advice/suggestions (catches both questions and statements)
  if (/\b(suggest|recommend|help|advice|idea|tip|practice)\b/.test(lower)) {
    return "request_advice";
  }

  if (isQuestion) {
    if (/\b(my|i)\b.*\b(name|age|birthday|email|phone|address|city|country|live|from)\b/.test(lower) ||
        /^(what|who)\s+am i\b/.test(lower) ||
        /^who is my\b/.test(lower)) {
      return "personal_question";
    }

    // Project questions
    if (/\b(my|the|personal)\s+(ai\s+)?(project|app|website|code|program|build)\b/.test(lower) ||
        /\b(project|app|website|code|build|develop)\b.*\b(improve|help|suggest|work on|working on)\b/.test(lower) ||
        /\b(improve|help|suggest)\b.*\b(project|app|website|code|build|develop)\b/.test(lower)) {
      return "project_question";
    }

    // Preference questions
    if (/\b(prefer|preference|like|love|hate|favorite|favourite|should i|recommend|suggest)\b.*\b(language|tool|editor|framework|library|use|learn)\b/.test(lower) ||
        /\bwhat.*\b(prefer|like|favorite)\b/.test(lower)) {
      return "preference_question";
    }

    // Education questions
    if (/\b(what|which|how)\b.*\b(study|learn|major|course|degree|school|university|college)\b/.test(lower) ||
        /\b(suggest|recommend).*\b(project|topic|subject)\b.*\b(for|to)\b.*\b(student|learn|study)\b/.test(lower)) {
      return "education_question";
    }

    // General knowledge / math / facts
    if (/\b(capital|population|distance|time|date|weather|math|calculate|multiply|divide|add|subtract)\b/.test(lower) ||
        /^\d+\s*[\+\-\*\/]\s*\d+/.test(lower) ||
        /^(what|who)\s+(is|was|are)\s+(the|a)\s/.test(lower)) {
      return "general_knowledge";
    }

    // Request for advice/suggestions
    if (/\b(suggest|recommend|help|advice|idea|tip)\b/.test(lower)) {
      return "request_advice";
    }

    return "other";
  }

  // Statements (declarative)
  if (lower.endsWith(".") && lower.length > 10) {
    // Only classify as statement if it looks like a personal fact
    // (contains self-reference or matches a category)
    if (/\b(i\s|my\s|i'm|i've|i'll|i'd)\b/.test(lower) || categorizeMemory(lower) !== "general") {
      return "statement";
    }
    return "other";
  }

  return "other";
}

/**
 * Question context for relevance scoring.
 * Contains the user's intent and extracted key entities.
 */
export interface QuestionContext {
  intent: UserIntent;
  entities: string[];        // key entities from the question (e.g., "C++", "ECE", "Zyron")
  categories: MemoryCategory[]; // relevant memory categories for this intent
  recentTopics: string[];    // topics from recent conversation
}

/**
 * Analyze the user's question/message and extract relevant context.
 * Includes conversation history for topic continuity.
 */
export function analyzeQuestionContext(
  message: string,
  recentMessages: Array<{ role: string; content: string }> = []
): QuestionContext {
  // Extract topics from recent conversation (last 4 messages)
  const recentTopics = extractRecentTopics(recentMessages);

  const intent = classifyUserIntent(message);

  // Extract entities from the current message, with pronoun resolution from recent topics
  const entities = extractEntities(message, recentTopics);

  // Map intent to relevant memory categories
  const categories = mapIntentToCategories(intent, message, recentTopics);

  return { intent, entities, categories, recentTopics };
}

/**
 * Extract key entities from text (languages, technologies, project names, etc.)
 * Resolves pronouns like "it", "that", "this" using recent conversation topics.
 */
export function extractEntities(text: string, recentTopics: string[] = []): string[] {
  const lower = text.toLowerCase();
  const entities: string[] = [];

  // Programming languages
  for (const lang of LANGUAGES) {
    if (lower.includes(lang)) entities.push(lang);
  }

  // Project names - capitalize words that look like names
  const words = text.match(/[A-Z][a-z]+/g) || [];
  for (const w of words) {
    if (w.length >= 3 && !STOPWORDS.has(w.toLowerCase())) {
      entities.push(w.toLowerCase());
    }
  }

  // Pronoun resolution: "it", "that", "this" -> recent topics
  if (/\b(it|that|this)\b/.test(lower) && recentTopics.length > 0) {
    entities.push(...recentTopics);
  }

  // Common tech terms
  const techTerms = [
    "embedded", "microcontroller", "esp32", "arduino", "raspberry pi", "fpga",
    "ai", "ml", "machine learning", "neural", "llm", "transformer",
    "react", "vue", "angular", "nextjs", "svelte", "node", "express",
    "database", "sql", "nosql", "postgres", "mongodb", "redis",
    "docker", "kubernetes", "aws", "gcp", "azure", "ci/cd", "github",
  ];
  for (const term of techTerms) {
    if (lower.includes(term)) entities.push(term);
  }

  // Academic fields
  const academicFields = [
    "ece", "electrical", "computer", "engineering", "cs", "computer science",
    "math", "physics", "chemistry", "biology", "mechanical", "civil",
  ];
  for (const field of academicFields) {
    if (lower.includes(field)) entities.push(field);
  }

  return [...new Set(entities)];
}

/**
 * Extract topics from recent conversation history.
 */
function extractRecentTopics(messages: Array<{ role: string; content: string }>): string[] {
  const topics: string[] = [];
  // Look at last 4 user messages
  const userMessages = messages
    .filter(m => m.role === "user")
    .slice(-4);

  for (const msg of userMessages) {
    const entities = extractEntities(msg.content);
    topics.push(...entities);
  }

  return [...new Set(topics)];
}

/**
 * Map user intent to relevant memory categories.
 */
function mapIntentToCategories(
  intent: UserIntent,
  message: string,
  recentTopics: string[]
): MemoryCategory[] {
  const lower = message.toLowerCase();
  const categories: MemoryCategory[] = [];

  switch (intent) {
    case "personal_question":
      categories.push("personal");
      break;
    case "project_question":
      categories.push("projects");
      // If asking about learning/tech choices or improving, preferences also relevant
      if (/\b(language|tool|framework|library|learn|improve)\b/.test(lower)) {
        categories.push("preferences");
      }
      break;
    case "preference_question":
      categories.push("preferences");
      break;
    case "education_question":
      categories.push("education");
      categories.push("projects"); // projects often related to education
      break;
    case "request_advice":
      // Advice can span multiple categories based on entities
      if (recentTopics.some(t => ["project", "build", "app", "code", "website"].includes(t))) {
        categories.push("projects");
      }
      if (recentTopics.some(t => LANGUAGES.has(t) || ["language", "tool", "framework"].includes(t))) {
        categories.push("preferences");
      }
      if (recentTopics.some(t => ["ece", "student", "study", "learn", "course"].includes(t))) {
        categories.push("education");
      }
      if (categories.length === 0) {
        // No topical anchor: do NOT blanket-boost all categories. Without a
        // category signal, retrieval relies on direct keyword/entity/fact-slot
        // overlap only, so unrelated memories are far less likely to be
        // injected. Fewer irrelevant memories reach the prompt.
      }
      break;
    case "general_knowledge":
    case "greeting":
      // No personal memories relevant
      break;
    case "statement":
      // For statements, use categorizeMemory but also consider recent topics
      const cat = categorizeMemory(message);
      if (cat !== "general") categories.push(cat as MemoryCategory);
      // Also include categories from recent topics
      for (const topic of recentTopics) {
        const topicCat = mapTopicToCategory(topic);
        if (topicCat && !categories.includes(topicCat)) categories.push(topicCat);
      }
      break;
    default:
      break;
  }

  return [...new Set(categories)];
}

/**
 * Map a topic/entity to its most likely memory category.
 */
function mapTopicToCategory(topic: string): MemoryCategory | null {
  const lower = topic.toLowerCase();
  if (LANGUAGES.has(lower) || ["language", "tool", "editor", "framework", "library", "prefer", "favorite"].includes(lower)) {
    return "preferences";
  }
  if (["project", "build", "app", "website", "code", "program", "software", "develop", "github", "repo"].includes(lower)) {
    return "projects";
  }
  if (["ece", "student", "study", "learn", "course", "degree", "school", "university", "engineering", "cs"].includes(lower)) {
    return "education";
  }
  if (["name", "age", "birthday", "email", "phone", "address", "city", "country", "live", "from"].includes(lower)) {
    return "personal";
  }
  if (["goal", "want", "plan", "future", "career", "dream", "become", "achieve"].includes(lower)) {
    return "goals";
  }
  return null;
}

/**
 * Score how well a memory's fact slot matches the question's entities and intent.
 * Returns additional relevance points (0-5).
 */
function scoreFactSlotMatch(
  memory: MemoryRow,
  qctx: QuestionContext
): number {
  const memSlot = extractFactSlot(memory.content);
  if (!memSlot) return 0;

  let score = 0;

  // Check if memory slot subject matches any relevant category
  const subjectCategoryMap: Record<string, MemoryCategory> = {
    "name": "personal",
    "favorite": "preferences",
    "preference": "preferences",
    "likes": "preferences",
    "education": "education",
    "project": "projects",
    "goal": "goals",
  };
  const slotCategory = subjectCategoryMap[memSlot.subject];
  if (slotCategory && qctx.categories.includes(slotCategory)) {
    score += 2; // Slot matches relevant category
  }

  // Check if any entity from question matches memory slot attr
  const slotAttrTokens = memSlot.attr.split(" ").filter(Boolean);
  for (const entity of qctx.entities) {
    const entityTokens = entity.split(" ").filter(Boolean);
    const matchCount = entityTokens.filter(t =>
      slotAttrTokens.some(st => st.includes(t) || t.includes(st))
    ).length;
    if (matchCount > 0) {
      score += matchCount * 2;
      if (entityTokens.length === 1 && slotAttrTokens.includes(entityTokens[0])) {
        score += 3; // Exact entity match in slot
      }
    }
  }

  // Check recent topics
  for (const topic of qctx.recentTopics) {
    const topicTokens = topic.split(" ").filter(Boolean);
    const matchCount = topicTokens.filter(t =>
      slotAttrTokens.some(st => st.includes(t) || t.includes(st))
    ).length;
    if (matchCount > 0) {
      score += matchCount; // Slightly lower weight for recent topics
    }
  }

  return Math.min(score, 5); // Cap at 5
}

/**
 * Score category relevance with intent awareness.
 * Higher score when intent strongly matches category.
 */
function scoreCategoryRelevance(
  memory: MemoryRow,
  qctx: QuestionContext
): number {
  if (!qctx.categories.includes(memory.category as MemoryCategory)) {
    return 0;
  }

  // Base score for category match
  let score = 3;

  // Boost for intent-specific categories
  const intentCategoryBoost: Record<UserIntent, MemoryCategory[]> = {
    "personal_question": ["personal"],
    "project_question": ["projects", "preferences"],
    "preference_question": ["preferences"],
    "education_question": ["education", "projects"],
    "request_advice": ["projects", "preferences", "education"],
    "statement": [],
    "general_knowledge": [],
    "greeting": [],
    "other": [],
  };

  const boostedCategories = intentCategoryBoost[qctx.intent] || [];
  if (boostedCategories.includes(memory.category as MemoryCategory)) {
    score += 2;
  }

  return score;
}

/**
 * Score how relevant an existing memory is to a new user statement.
 * Based on shared meaningful topic words plus a special case for
 * programming-language preference changes (e.g. "focusing on C++" vs
 * "favorite language is Python").
 * Used by findRelatedMemory and findConflictingMemory for conflict detection.
 */
function computeRelevanceScore(
  memory: MemoryRow,
  ctx: MatchContext
): number {
  const memTokens = extractTopicTokens(memory.content);

  const sharedDistinctive = memTokens.filter(
    (t) => ctx.newTokenSet.has(t) && !GENERIC_TOPIC_WORDS.has(t)
  );

  let score = sharedDistinctive.length * 2;

  // Language-preference change: both mention a programming language.
  const memLangs = memTokens.filter((t) => LANGUAGES.has(t));
  if (ctx.newLangs.length > 0 && memLangs.length > 0) {
    score += memory.category === "preferences" ? 3 : 1;
  }

  return score;
}

/**
 * Enhanced relevance scoring with intent, entities, and conversation context.
 * Used by getRelevantMemories for intelligent retrieval.
 */
export function computeEnhancedRelevanceScore(
  memory: MemoryRow,
  message: string,
  qctx: QuestionContext,
  newTokens: string[],
  newTokenSet: Set<string>,
  newLangs: string[]
): number {
  const memTokens = extractTopicTokens(memory.content);

  // 1. Keyword/topic overlap (distinctive tokens only).
  //    Capped so many shared keywords cannot flood the score and outrank a
  //    semantically exact fact-slot match from a shorter memory.
  const sharedDistinctive = memTokens.filter(
    (t) => newTokenSet.has(t) && !GENERIC_TOPIC_WORDS.has(t)
  );
  let score = Math.min(sharedDistinctive.length, 3) * 2;

  // 2. Language preference bonus
  const memLangs = memTokens.filter((t) => LANGUAGES.has(t));
  if (newLangs.length > 0 && memLangs.length > 0) {
    score += memory.category === "preferences" ? 3 : 1;
  }

  // 3. Category relevance with intent awareness
  score += scoreCategoryRelevance(memory, qctx);

  // 4. Fact slot match bonus (semantic matching)
  score += scoreFactSlotMatch(memory, qctx);

  // 5. Entity overlap bonus (direct entity matching), capped to avoid flooding
  const memEntities = extractEntities(memory.content);
  let entityScore = 0;
  for (const entity of qctx.entities) {
    if (memEntities.includes(entity)) {
      entityScore += 3; // Strong boost for exact entity match
    } else {
      // Partial entity match
      for (const memEntity of memEntities) {
        if (memEntity.includes(entity) || entity.includes(memEntity)) {
          entityScore += 1;
        }
      }
    }
  }
  score += Math.min(entityScore, 9);

  // 6. Recency bonus for conversation continuity (memories matching recent topics)
  for (const topic of qctx.recentTopics) {
    if (memEntities.includes(topic) || memTokens.includes(topic)) {
      score += 1;
    }
  }

  // 7. Penalize generic-only matches
  if (score > 0 && sharedDistinctive.length === 0 && memLangs.length === 0 && qctx.entities.length === 0) {
    // Only matched via generic category keywords - reduce score
    score = Math.max(1, score - 2);
  }

  // 8. Recency-aware boost: newer memories are more likely the current truth,
  //    so fresher facts are preferred over stale-but-active ones. Bounded so
  //    it never overrides a strong semantic match.
  score += computeRecencyBonus(memory.updatedAt);

  // 9. Hard cap to keep scores bounded and stable against keyword flooding.
  return Math.min(score, MAX_RELEVANCE_SCORE);
}

/**
 * Compute a small recency bonus from a memory's updatedAt timestamp.
 * Recent memories earn a larger bonus; very old memories earn none.
 * The bonus is bounded (0..RECENCY_BONUS_MAX) so it never overrides a
 * strong keyword/fact-slot match, only breaks ties directionally.
 */
function computeRecencyBonus(updatedAt: string): number {
  const time = Date.parse(updatedAt);
  if (Number.isNaN(time)) return 0;

  const ageDays = (Date.now() - time) / (24 * 60 * 60 * 1000);
  if (ageDays <= 1) return RECENCY_BONUS_MAX;          // today
  if (ageDays <= 7) return 1;                           // this week
  if (ageDays <= 30) return 0;                          // recently but not enough
  return 0;
}

/**
 * Determine if a memory should be considered for injection based on intent.
 * General knowledge questions and greetings should not inject personal memories.
 */
export function shouldInjectMemoriesForIntent(intent: UserIntent): boolean {
  return intent !== "general_knowledge" && intent !== "greeting" && intent !== "other";
}

/**
 * Find the single existing memory most relevant to the given text.
 * Returns null when nothing matches or when the match is ambiguous
 * (two memories tying at the top score).
 */
export function findRelatedMemory(text: string): MemoryRow | null {
  const memories = getAllMemories() as MemoryRow[];
  if (memories.length === 0) return null;

  const newTokens = extractTopicTokens(text);
  const ctx: MatchContext = {
    newTokens,
    newTokenSet: new Set(newTokens),
    newLangs: newTokens.filter((t) => LANGUAGES.has(t)),
  };

  let best: { memory: MemoryRow; score: number } | null = null;
  for (const memory of memories) {
    const score = computeRelevanceScore(memory, ctx);
    if (score > (best?.score ?? 0)) {
      best = { memory, score };
    }
  }

  if (!best || best.score < 2) return null;

  // Ambiguity guard: if a second memory ties with the winner, be conservative.
  let tied = 0;
  for (const memory of memories) {
    if (computeRelevanceScore(memory, ctx) === best.score) tied++;
  }
  if (tied > 1) return null;

  return best.memory;
}

/**
 * Find an existing memory that would CONFLICT with a new memory:
 * same category AND strongly related topic. Used before creating a new
 * memory so the old one can be replaced instead of storing a duplicate.
 * Returns null when nothing conflicts or when the match is ambiguous.
 */
export function findConflictingMemory(
  content: string,
  category: string
): MemoryRow | null {
  const memories = getAllMemories() as MemoryRow[];
  if (memories.length === 0) return null;

  // Only memories in the same category can conflict.
  const sameCategory = memories.filter((m) => m.category === category);
  if (sameCategory.length === 0) return null;

  const newTokens = extractTopicTokens(content);
  const ctx: MatchContext = {
    newTokens,
    newTokenSet: new Set(newTokens),
    newLangs: newTokens.filter((t) => LANGUAGES.has(t)),
  };

  let best: { memory: MemoryRow; score: number } | null = null;
  for (const memory of sameCategory) {
    const score = computeRelevanceScore(memory, ctx);
    if (score > (best?.score ?? 0)) {
      best = { memory, score };
    }
  }

  if (!best || best.score < 2) return null;

  // Ambiguity guard: if a second same-category memory ties, be conservative.
  let tied = 0;
  for (const memory of sameCategory) {
    if (computeRelevanceScore(memory, ctx) === best.score) tied++;
  }
  if (tied > 1) return null;

  return best.memory;
}

/**
 * Find every ACTIVE memory that describes the same underlying fact as the
 * new content. Uses the fact-slot extractor so a new value for the same
 * fact (e.g. a new favorite programming language, a project that ended)
 * targets the old memory precisely across all categories, while different
 * facts (different projects, different preferences) never conflict.
 */
export function findSlotConflicts(content: string): MemoryRow[] {
  const newSlot = extractFactSlot(content);
  if (!newSlot) return [];

  const candidates = getAllMemories() as MemoryRow[];
  return candidates.filter((memory) => {
    const memSlot = extractFactSlot(memory.content);
    return (
      memSlot !== null &&
      memSlot.subject === newSlot.subject &&
      attrMatches(memSlot.attr, newSlot.attr)
    );
  });
}

/** Result of a conflict resolution attempt. */
export type MemoryResolutionResult =
  | { action: "noop"; reason: "removal-without-match" }
  | { action: "no-conflict" }
  | { action: "archived"; archived: MemoryRow[] };

/**
 * Resolve any conflict between the new content and existing active memories
 * describing the SAME user fact. Conflicting memories are archived (kept as
 * history but excluded from normal use) and the caller stores the new value.
 *
 * Detection order (deterministic, no AI):
 * 1. Exact fact-slot equality — the new statement re-describes the same
 *    subject+attribute, so the old value is outdated (e.g. a new favorite
 *    programming language, a project that ended).
 * 2. Same-category relevance scoring (findConflictingMemory) as a fallback
 *    for phrasings the slot extractor does not recognize.
 *
 * Removal statements ("no longer…", "stopped…") archive the old memory and
 * do NOT create a replacement; unrelated memories are never touched.
 */
export function resolveMemoryConflict(
  content: string,
  category: string
): MemoryResolutionResult {
  const conflicts: MemoryRow[] = [];
  const slotConflicts = findSlotConflicts(content);
  conflicts.push(...slotConflicts);

  const related = findConflictingMemory(content, category);
  if (related && !conflicts.some((c) => c.id === related.id)) {
    conflicts.push(related);
  }

  if (conflicts.length === 0) {
    return hasRemovalSignal(content)
      ? { action: "noop", reason: "removal-without-match" }
      : { action: "no-conflict" };
  }

  for (const conflict of conflicts) {
    archiveMemory(conflict.id);
  }
  return { action: "archived", archived: conflicts };
}

// Maximum number of relevant memories injected into a single chat request.
export const MAX_RELEVANT_MEMORIES = 3;

// Minimum combined relevance score for a memory to be injected.
const RELEVANCE_THRESHOLD = 2;

// Hard cap on the combined relevance score so keyword/token flooding cannot
// dominate and produce unbounded, unstable rankings.
const MAX_RELEVANCE_SCORE = 15;

// Maximum recency bonus awarded to a memory updated within the last day.
const RECENCY_BONUS_MAX = 1;

// Category relevance is now handled by scoreCategoryRelevance in computeEnhancedRelevanceScore

/**
 * Fetch the ACTIVE memories that are plausible candidates for the given
 * message, applying a safe SQL-level pre-filter instead of loading the whole
 * active table into JS.
 *
 * When the message (plus any `extraTokens`, e.g. a resolved follow-up topic)
 * has at least one "distinctive" topic token (a token that is neither a
 * stopword nor a generic topic word), we SELECT only memories whose content
 * contains at least one such token. Otherwise we fall back to loading all
 * active memories to preserve exact Stage 1-3 behavior (category and fact-slot
 * matches that do not rely on shared keywords).
 *
 * All values are bound as parameters (never interpolated), so the LIKE filter
 * is safe against SQL injection.
 */
function getActiveMemoryCandidates(
  message: string,
  extraTokens: string[] = []
): MemoryRow[] {
  const db = getDb();

  const distinctive = [
    ...extractTopicTokens(message).filter((t) => !GENERIC_TOPIC_WORDS.has(t)),
    ...extraTokens.filter((t) => !GENERIC_TOPIC_WORDS.has(t)),
  ].filter((t, i, arr) => arr.indexOf(t) === i);

  // No distinctive token: fall back to the full active set to preserve
  // category- and fact-slot-based matches from earlier stages.
  if (distinctive.length === 0) {
    return db
      .prepare("SELECT * FROM memories WHERE is_active = 1 ORDER BY createdAt DESC")
      .all() as MemoryRow[];
  }

  const clauses = distinctive.map(() => "content LIKE ?");
  const where = `is_active = 1 AND (${clauses.join(" OR ")})`;
  const params = distinctive.map((t) => `%${t}%`);
  const stmt = db.prepare(
    `SELECT * FROM memories WHERE ${where} ORDER BY createdAt DESC`
  );
  return stmt.all(...params) as MemoryRow[];
}

/**
 * Retrieve memories relevant to the current user message.
 *
 * Scoring combines:
 * - keyword/topic overlap (distinctive tokens)
 * - programming language preference matching
 * - category relevance with intent awareness
 * - fact slot semantic matching
 * - entity overlap (exact and partial)
 * - conversation continuity (recent topics)
 * - recency (newest-first tiebreaker)
 *
 * Returns at most `limit` memories scoring above the threshold.
 * Unrelated memories score 0 and are excluded.
 * General knowledge questions and greetings return no memories.
 *
 * When `followUpTopic` is provided (a resolved prior topic from short-term
 * context) and the message carries no topic entity of its own, the message is
 * treated as a continuation: the follow-up topic is merged into entity/topic
 * matching, category relevance, and candidate pre-filtering, and the message
 * is allowed past the intent gate (instead of being dropped as "other").
 */
export function getRelevantMemories(
  message: string,
  recentMessages: Array<{ role: string; content: string }> = [],
  limit: number = MAX_RELEVANT_MEMORIES,
  followUpTopic?: string | null
): Array<RelevantMemory & MemoryRow> {
  // Analyze question context with conversation history
  const qctx = analyzeQuestionContext(message, recentMessages);

  // Own entities = entities in the message itself, WITHOUT pronoun auto-
  // resolution. This distinguishes "this message introduces its own topic"
  // from "this message is just a reference to the prior topic".
  const ownEntities = extractEntities(message);

  // A genuine follow-up continues the conversation: the message carries no
  // topic entity of its own, but a reliable prior topic was resolved. This is
  // conservative — trivial filler and messages with their own topic entity are
  // never treated as a follow-up.
  const isFollowUp =
    Boolean(followUpTopic) &&
    ownEntities.length === 0 &&
    !isTrivialMessage(message);

  // Don't inject memories for general knowledge questions, greetings, or
  // other non-personal messages — UNLESS this is a genuine follow-up, which
  // should be allowed to retrieve against its resolved topic.
  if (!isFollowUp && !shouldInjectMemoriesForIntent(qctx.intent)) {
    return [];
  }

  const memories = getActiveMemoryCandidates(
    message,
    isFollowUp ? [followUpTopic!] : []
  );
  if (memories.length === 0) return [];

  if (isFollowUp) {
    // Enrich the scoring context with the resolved topic so entity/topic
    // matching and category relevance can use it.
    if (!qctx.entities.includes(followUpTopic!)) {
      qctx.entities.push(followUpTopic!);
    }
    const followCat = mapTopicToCategory(followUpTopic!);
    if (followCat && !qctx.categories.includes(followCat)) {
      qctx.categories.push(followCat);
    }
  }

  const newTokens = extractTopicTokens(message);
  const ctx = {
    newTokens,
    newTokenSet: new Set(newTokens),
    newLangs: newTokens.filter((t) => LANGUAGES.has(t)),
  };

  const scored: Array<{ memory: MemoryRow; score: number }> = [];
  for (const memory of memories) {
    const score = computeEnhancedRelevanceScore(
      memory,
      message,
      qctx,
      newTokens,
      ctx.newTokenSet,
      ctx.newLangs
    );
    if (score >= RELEVANCE_THRESHOLD) {
      scored.push({ memory, score });
    }
  }

  // Highest score first; ties keep getAllMemories' newest-first order.
  scored.sort((a, b) => b.score - a.score);

  return scored
    .slice(0, limit)
    .map(({ memory, score }) => ({ ...memory, score }));
}

/**
 * Get all memories for a specific category.
 */
export function getMemoriesByCategory(category: string) {
  const db = getDb();
  const stmt = db.prepare(
    "SELECT * FROM memories WHERE category = ? AND is_active = 1 ORDER BY createdAt DESC"
  );
  return stmt.all(category) as Array<{
    id: number;
    content: string;
    category: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

// ============================================================
// STAGE 5: SHORT-TERM CONVERSATION CONTEXT
// ============================================================
//
// These helpers derive a lightweight, deterministic notion of the CURRENT
// conversation (active topics, follow-ups, pronoun antecedents) so the prompt
// can carry short-term continuity WITHOUT persisting anything to SQLite.
// Long-term memory continues to use the existing Stage 1-4 system untouched.

/**
 * The derived short-term context for a single user message.
 * This is ephemeral (per-request) and is NEVER written to the database.
 */
export interface ShortTermContext {
  /** Topics carried over from the recent conversation (last few user turns). */
  activeTopics: string[];
  /** Likely pronoun antecedents, only when determinable with confidence. */
  pronounHints: string[];
  /** The most recent topic a follow-up message is attached to, if any. */
  followUpTopic: string | null;
  /** True when the message is conversational filler with no real topic. */
  isTrivial: boolean;
}

// Pronouns that typically reference something stated earlier in the turn.
const REFERENCING_PRONOUNS = [
  "it", "that", "this", "they", "its", "them", "these", "those",
];

// Exact conversational-filler phrases treated as "trivial" (no memory scan).
const TRIVIAL_PHRASES = new Set([
  "hi", "hello", "hey", "heya", "hiya", "howdy", "yo",
  "good morning", "good afternoon", "good evening",
  "thanks", "thank you", "thx", "ty",
  "ok", "okay", "k", "sure", "no problem", "cool", "nice", "great",
  "how are you", "how are you doing", "how are you today", "how's it going",
  "how have you been", "how are things", "what's up", "whats up", "sup",
  "bye", "goodbye", "good night", "see you", "see ya", "later",
  "yes", "yeah", "yep", "nope", "no",
]);

/**
 * Conservative check for conversational filler that carries no topic.
 * A message with any recognized entity or distinctive topic token is never
 * trivial, so legitimate short questions are never skipped.
 */
export function isTrivialMessage(
  message: string,
  ownEntities: string[] = [],
  ownDistinctive: string[] = []
): boolean {
  if (ownEntities.length > 0 || ownDistinctive.length > 0) return false;

  const normalized = message
    .toLowerCase()
    .trim()
    .replace(/[.,!?;]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length === 0) return true;
  if (TRIVIAL_PHRASES.has(normalized)) return true;

  const words = normalized.split(" ");
  return words.length <= 3 && words.every((w) => TRIVIAL_PHRASES.has(w));
}

/**
 * Build the short-term conversation context for the current message.
 *
 * Deterministic, rule-based, never persisted. Resolves:
 * - activeTopics: the ongoing topic(s) from recent user turns.
 * - followUpTopic: when the current message has no topic of its own but the
 *   conversation does, attach it to the most recent topic.
 * - pronounHints: only when the message uses a referencing pronoun AND carries
 *   no self-contained topic AND a recent topic exists (conservative).
 * - isTrivial: conversational filler with no topic.
 */
export function buildShortTermContext(
  message: string,
  recentMessages: Array<{ role: string; content: string }> = []
): ShortTermContext {
  const recentTopics = extractRecentTopics(recentMessages);
  const ownEntities = extractEntities(message);
  const ownDistinctive = extractTopicTokens(message).filter(
    (t) => !GENERIC_TOPIC_WORDS.has(t)
  );

  const isTrivial = isTrivialMessage(message, ownEntities, ownDistinctive);

  const usesPronoun = REFERENCING_PRONOUNS.some((p) =>
    new RegExp(`\\b${p}\\b`, "i").test(message)
  );
  // "Bare" = the message introduces no topic entities of its own (no language,
  // proper noun, tech, or academic term). Ordinary words such as "sensor" or
  // "better" are not topic entities, so a follow-up like "What sensor should I
  // use?" is still recognized as continuing the recent topic.
  const isBare = ownEntities.length === 0;

  // Follow-up: bare message (pronoun or no own topic) that continues the
  // conversation. Attach it to the most recent prior topic.
  let followUpTopic: string | null = null;
  if (!isTrivial && recentTopics.length > 0 && (usesPronoun || isBare)) {
    followUpTopic = recentTopics[recentTopics.length - 1];
  }

  // Pronoun hints only with reasonable confidence: a referencing pronoun in a
  // bare message, and a definite prior topic to point at.
  const pronounHints: string[] = [];
  if (usesPronoun && isBare && recentTopics.length > 0) {
    pronounHints.push(...recentTopics);
  }

  return { activeTopics: recentTopics, pronounHints, followUpTopic, isTrivial };
}

// ============================================================
// STAGE 6: DETERMINISTIC EMOTIONAL / TONE CONTEXT
// ============================================================
//
// These helpers classify the user's message into a small set of tone intents
// using simple, deterministic keyword rules — NO additional LLM call. The
// result is a light directive the system prompt can use to respond
// appropriately. It is ephemeral (per-request) and NEVER written to the
// database, so it cannot interfere with long-term memory creation.

// Words signalling explicit frustration, anger, or distress.
const DISTRESS_PATTERNS: RegExp[] = [
  /\b(frustrat\w*|angry|angr\w*|annoy\w*|furious|mad\b|stressed|stress\w*|overwhelm\w*)\b/i,
  /\b(failed|fail\w*|wreck\w*|messed\s+up|broke\w*|broken)\b/i,
  /\b(sad\b|sadden\w*|upset\b|down\b|depress\w*|miserable|crying|cry\b|tired\s+of)\b/i,
  /\b(struggl\w*|stuck\b|cannot\s+figure|can'?t\s+figure|give\s+up|giving\s+up|hopeless|worried|worry\w*|anxious|anxiety)\b/i,
  /\b(this\s+is\s+(so\s+)?(hard|difficult|impossible|terrible|awful))|(so\s+(annoying|frustrating|stressful))\b/i,
];

// Words signalling a positive achievement, good news, or excitement.
const POSITIVE_PATTERNS: RegExp[] = [
  /\b(finally\s+(finished|completed|done|solved|got|passed|fixed))\b/i,
  /\b(finished|completed|done!|solved|passed|achieved|accomplished|succeeded|success)\b/i,
  /\b(excited|awesome|amazing|great|fantastic|wonderful|excellent|happy|glad|thrilled|proud|superb|brilliant)\b/i,
  /\b(got\s+(the\s+)?(job|offer|promotion|award)|won\b|victory|win\b)\b/i,
  /\b(big\s+(news|win|milestone)|made\s+(it|progress)|progress)\b/i,
];

// Casual / informal markers.
const CASUAL_PATTERNS: RegExp[] = [
  /\b(bro|dude|man\b|bhai|dawg|hey\s+zyron|yo|gonna|wanna|cuz|k\b|thx|ty|pls|plz|btw)\b/i,
];

// Educational / neutral explanation or knowledge requests.
const EDUCATIONAL_PATTERNS: RegExp[] = [
  /^(explain|describe|what\s+is|what\s+are|define|elaborate|clarify|teach|walk\s+me\s+through|how\s+does|how\s+do)\b/i,
  /\b(tutorial|concept|how\s+to|step\s+by\s+step|in\s+detail|in\s+depth)\b/i,
];

/**
 * Classify a user message into a dominant tone intent.
 * Order matters: distress and positivity are checked first because they are
 * the strongest emotional signals; casual and educational are weaker and
 * secondary. Returns "neutral" when no clear signal is found.
 */
export function classifyUserTone(message: string): ToneIntent {
  const lower = message.toLowerCase().trim();
  if (!lower) return "neutral";

  const hasDistress = DISTRESS_PATTERNS.some((re) => re.test(lower));
  if (hasDistress) return "distress";

  const hasPositive = POSITIVE_PATTERNS.some((re) => re.test(lower));
  if (hasPositive) return "positive";

  const hasCasual = CASUAL_PATTERNS.some((re) => re.test(lower));
  if (hasCasual) return "casual";

  const hasEducational = EDUCATIONAL_PATTERNS.some((re) => re.test(lower));
  if (hasEducational) return "educational";

  return "neutral";
}

/**
 * Build the ephemeral tone context for a user message.
 * Deterministic, rule-based, never persisted. `hasTone` is false (and the
 * caller injects nothing) for neutral messages and for memory commands, so
 * personality directives never interfere with memory creation.
 */
export function buildToneContext(message: string): ToneContext {
  const tone = classifyUserTone(message);
  return { tone, hasTone: tone !== "neutral" };
}

// ============================================================
// STAGE 7: PROJECT & GOAL AWARENESS
// ============================================================
//
// Lightweight, persistent tracking of the user's active project/goal.
// Separate from long-term memories — updates here do NOT create memory rows.
// The project_context table is additive and never modifies the memories table.

interface ProjectContextRow {
  id: number;
  name: string;
  description: string;
  goal: string;
  is_active: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Create a new active project context or reactivate/update an existing one.
 * Deactivates any previously active project (only one active at a time).
 * Does NOT create a memory row.
 */
export function createProjectContext(
  name: string,
  description: string = "",
  goal: string = ""
): ProjectContextRow {
  const db = getDb();
  db.prepare("UPDATE project_context SET is_active = 0 WHERE is_active = 1").run();
  const result = db
    .prepare(
      "INSERT INTO project_context (name, description, goal) VALUES (?, ?, ?)"
    )
    .run(name, description, goal);
  return {
    id: Number(result.lastInsertRowid),
    name,
    description,
    goal,
    is_active: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Get the most recently updated active project context.
 * Returns null when no project is active.
 */
export function getActiveProjectContext(): ProjectContextRow | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM project_context WHERE is_active = 1 ORDER BY updatedAt DESC LIMIT 1"
    )
    .get() as ProjectContextRow | undefined;
  return row ?? null;
}

/**
 * Update the description/goal of the active project context (in place).
 * Does NOT create a memory row.
 */
export function updateActiveProjectContext(updates: {
  description?: string;
  goal?: string;
}): ProjectContextRow | null {
  const current = getActiveProjectContext();
  if (!current) return null;
  const db = getDb();
  const description = updates.description ?? current.description;
  const goal = updates.goal ?? current.goal;
  db.prepare(
    "UPDATE project_context SET description = ?, goal = ?, updatedAt = datetime('now') WHERE id = ?"
  ).run(description, goal, current.id);
  return {
    ...current,
    description,
    goal,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Phrases that strongly indicate the user is starting or actively building a
 * specific project (not a general statement or a question).
 */
const PROJECT_INTRO_PATTERNS: RegExp[] = [
  /\b(?:i'm|i am|im)\s+(?:building|creating|making|developing|working\s+on)\b/i,
  /\b(?:i(?:'m|\s+am)?)\s+(?:starting|starting\s+to)\s+(?:build|create|make|develop|work\s+on)\b/i,
  /\b(?:i\s+started|started)\s+(?:building|creating|making|developing|working\s+on)\b/i,
  /\b(?:let'?s\s+build|let'?s\s+create|let'?s\s+make)\b/i,
  /\b(?:i(?:'m|\s+am)?)\s+(?:building|creating|making|developing)\s+a\s+new\b/i,
];

/**
 * Detect whether a user message introduces a new project or goal.
 * Conservative: only matches explicit creation/development statements.
 * Does NOT match questions, general chatter, or vague mentions.
 */
export function detectProjectIntroduction(message: string): boolean {
  const lower = message.toLowerCase();
  const hasSignal = PROJECT_INTRO_PATTERNS.some((re) => re.test(lower));
  if (!hasSignal) return false;
  if (message.trim().length < 15) return false;
  const category = categorizeMemory(message);
  if (category === "general") return false;
  return true;
}

/**
 * Extract a project name from an introductory message.
 * Uses the fact-slot extractor and falls back to keyword extraction.
 * Returns null when no project name can be determined.
 */
export function extractProjectName(message: string): string | null {
  // Fall back to keyword extraction from the ORIGINAL (cased) message so
  // proper nouns like "ESP32" or "Zyron" keep their capitalization.
  const m = message.match(
    /\b(?:i'm|i am|im|let'?s)\s+(?:building|build|creating|create|making|make|developing|develop|working\s+on)\s+(?:a\s+|an\s+|the\s+|my\s+)?(.+)/i
  );
  if (m) {
    let name = m[1].trim().replace(/[.!?]+$/, "").trim();
    if (name.length > 0) {
      name = name.charAt(0).toUpperCase() + name.slice(1);
      if (name.length > 40) name = name.slice(0, 40).trim();
      return name;
    }
  }

  return null;
}

/**
 * Words/phrases that revisit an ongoing project's progress rather than
 * introducing a brand-new topic. Combined with existing conversation context
 * they provide evidence that a message continues the active project.
 */
const PROJECT_REFERENCE_KEYWORDS = new Set([
  "stage", "phase", "step", "version", "milestone", "prototype", "iteration",
  "status", "progress", "finished", "finishing", "done", "complete", "next",
]);

/**
 * Deterministically detect whether a message is a follow-up to the active
 * project. Uses the message's OWN entities (no pronoun resolution), the user
 * message intent, and recent conversation topics as evidence.
 */
function isProjectFollowUp(
  message: string,
  ownEntities: string[],
  recentTopics: string[],
  isTrivial: boolean,
  activeProject: ProjectContextRow | null
): boolean {
  if (!activeProject) return false;
  if (isTrivial) return false;

  const intent = classifyUserIntent(message);
  if (intent === "general_knowledge" || intent === "greeting") return false;

  const ownEntitySet = new Set(ownEntities.map((e) => e.toLowerCase()));
  const projectNameLower = activeProject.name.toLowerCase();
  const projectWords = projectNameLower.split(/\s+/).filter((w) => w.length >= 3);

  const overlapsProject = (value: string): boolean => {
    const v = value.toLowerCase();
    if (v === projectNameLower) return true;
    return projectWords.some((w) => v.split(/\s+/).includes(w));
  };

  // Message introduces its own topic entities — project continuity holds only
  // when one of them overlaps the active project.
  if (ownEntities.length > 0) {
    if (ownEntitySet.has(projectNameLower)) return true;
    for (const word of projectWords) {
      if (ownEntitySet.has(word)) return true;
    }
    // "I finished Stage 6." under an active project is only a follow-up when
    // the recent conversation already mentions the project (strong evidence).
    const referencesProjectWork = extractTopicTokens(message).some((t) =>
      PROJECT_REFERENCE_KEYWORDS.has(t)
    );
    if (referencesProjectWork && recentTopics.some(overlapsProject)) {
      return true;
    }
    return false;
  }

  // Bare message (no entities of its own). Only attach when the project is
  // specific enough to anchor on and the message is substantive, and it is not
  // an unrelated question (general-knowledge/greeting already excluded above).
  const nonGenericProjectWords = projectWords.filter(
    (w) => !GENERIC_TOPIC_WORDS.has(w) && !STOPWORDS.has(w)
  );
  if (nonGenericProjectWords.length === 0) return false;
  if (message.trim().length < 5) return false;

  return true;
}

/**
 * Build the project context for the current user message.
 * Ephemeral per-request context that helps Zyron understand ongoing projects.
 * Only produces a section when an active project exists. Deterministic, no LLM.
 */
export function buildProjectContext(
  message: string,
  recentTopics: string[],
  isTrivial: boolean
): { section: string; isFollowUp: boolean } {
  const activeProject = getActiveProjectContext();
  if (!activeProject) return { section: "", isFollowUp: false };

  const ownEntities = extractEntities(message);
  const isFollowUp = isProjectFollowUp(
    message,
    ownEntities,
    recentTopics,
    isTrivial,
    activeProject
  );

  const parts: string[] = [];
  parts.push(`Active project: ${activeProject.name}`);

  if (activeProject.goal) {
    parts.push(`Current goal: ${activeProject.goal}`);
  }
  if (activeProject.description) {
    parts.push(`Project details: ${activeProject.description}`);
  }
  if (isFollowUp) {
    parts.push(
      "This message appears to be a follow-up about the active project."
    );
  }

  return {
    section:
      "\n\nProject context:\n" +
      parts.join("\n") +
      "\n(This is internal context about the user's active project. Use it to understand project-related follow-ups. Do not mention this context to the user unless they ask about their project.)",
    isFollowUp,
  };
}

/**
 * Clear all project context rows. Used by tests and debugging to reset the
 * Project & Goal Awareness state without touching the memories table.
 */
export function clearAllProjectContext(): number {
  const db = getDb();
  return db.prepare("DELETE FROM project_context").run().changes;
}

// ============================================================
// STAGE 8: PLANNING & TASK AWARENESS
// ============================================================
//
// Lightweight, persistent tracking of the user's current task or plan step.
// Separate from long-term memories and from project context — updates here do
// NOT create memory rows, and the task_context table is purely additive. All
// detection is deterministic and rule-based (no additional LLM calls).

/** The lifecycle state of a tracked task. */
export type TaskStatus = "planned" | "in_progress" | "done";

interface TaskContextRow {
  id: number;
  title: string;
  status: TaskStatus;
  project_ref: string;
  is_active: number;
  createdAt: string;
  updatedAt: string;
}

/** Kinds of explicit task-related questions recognized deterministically. */
export type TaskQuestionKind = "next" | "doneHistory" | "taskDetail";

/**
 * Result of deterministic task-statement detection on a user message.
 * `kind` tells the caller what to persist:
 * - "create": a new active task should be created (status may be "in_progress").
 * - "progress": the active task should be marked in progress.
 * - "done": the active task should be completed/archived.
 * - "question": never persisted; may drive prompt injection via qtype.
 * - "none": not a task, nothing to do.
 */
export interface TaskStatement {
  kind: "create" | "progress" | "done" | "question" | "none";
  title: string | null;
  status?: "planned" | "in_progress";
  qtype?: TaskQuestionKind;
}

// Everyday verbs that would turn "I need to go now." into noise instead of a
// tracked task. A candidate title whose significant tokens are ALL fillers is
// not a task.
const TASK_FILLER_VERBS = new Set([
  "go", "leave", "run", "sleep", "eat", "dinner", "lunch", "break", "rest",
  "shower", "nap", "bathroom", "toilet",
]);

// First-person commitments to a future action.
const TASK_CREATE_PATTERNS: RegExp[] = [
  /\bi\s+need\s+(?:to\s+|a\s+|an\s+|the\s+|some\s+)?(.+)/i,
  /\bi\s+(?:have|got)\s+to\s+(.+)/i,
  /\bi\s+want\s+to\s+(.+)/i,
  /\bi\s+plan\s+to\s+(.+)/i,
  /\bi\s+intend\s+to\s+(.+)/i,
  /\bi'?m\s+about\s+to\s+(.+)/i,
  /\bi'?m\s+going\s+to\s+(.+)/i,
  /\bi'?m\s+gonna\s+(.+)/i,
  /\bmy\s+next\s+step\s+is\s+(?:to\s+)?(.+)/i,
  /\bnext\s+(?:i'?ll|i\s+will)\s+(.+)/i,
];

// Phrases describing ongoing/in-progress work.
const TASK_PROGRESS_PATTERNS: RegExp[] = [
  /\bi'?m\s+currently\s+working\s+on\s+(.+)/i,
  /\bi'?m\s+still\s+working\s+on\s+(.+)/i,
  /\bi'?m\s+working\s+on\s+(.+)/i,
  /\bi'?m\s+trying\s+to\s+(.+)/i,
  /\bi'?m\s+stuck\s+(?:on|with)\s+(.+)/i,
  /\bi'?m\s+continuing\s+(?:with\s+)?(.+)/i,
  /\bi'?m\s+still\s+on\s+(.+)/i,
];

// Phrases declaring a completed action.
const TASK_DONE_PATTERNS: RegExp[] = [
  /\bi\s+finished\s+(.+)/i,
  /\bi'?ve\s+finished\s+(.+)/i,
  /\bi\s+completed\s+(.+)/i,
  /\bi'?ve\s+completed\s+(.+)/i,
  /\bi'?m\s+done\s+with\s+(.+)/i,
  /\bi\s+got\s+(?:the\s+)?(.+)\s+working\b/i,
  /\bi\s+fixed\s+(.+)/i,
];

// Explicit "what should I do next?" style questions.
const TASK_NEXT_QUESTION_PATTERNS: RegExp[] = [
  /\bwhat'?s\s+next\b/i,
  /\bwhat\s+next\b/i,
  /\bwhat\s+should\s+i\s+do\s+(?:next|now)\b/i,
  /\bwhat'?s\s+the\s+next\s+(?:step|thing|task)\b/i,
  /\bnow\s+what\b/i,
];

// Explicit "what have I done?" style questions.
const TASK_DONE_HISTORY_PATTERNS: RegExp[] = [
  /\bwhat\s+(?:have|did|do)\s+i\s+(?:done|do|finish(?:ed)?|complete(?:d)?|accomplish(?:ed)?)\b/i,
  /\bwhat\s+have\s+i\s+(?:got|gotten)\s+done\b/i,
];

/**
 * Normalize a raw task phrase for storage/display: strip surrounding
 * punctuation, collapse whitespace, drop leading articles, capitalize.
 */
function normalizeTaskTitle(raw: string): string {
  let title = raw
    .trim()
    .replace(/[.!?;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:the|a|an|my)\s+/i, "")
    .trim();
  if (title.length > 0) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }
  return title;
}

/**
 * Significant (non-stopword) tokens of a task title, used for matching.
 */
function significantTaskTokens(title: string): string[] {
  return extractTopicTokens(title);
}

/**
 * Deterministically decide whether two task titles describe the same work.
 * True when their significant-token sets are equal, or one is a subset of the
 * other, or they share at least two significant tokens. This prevents a "done"
 * statement about an unrelated object from hijacking the active task.
 */
export function taskTitlesMatch(aTitle: string, bTitle: string): boolean {
  const aTokens = significantTaskTokens(aTitle);
  const bTokens = significantTaskTokens(bTitle);
  if (aTokens.length === 0 || bTokens.length === 0) return false;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  const intersection = aTokens.filter((t) => b.has(t)).length;
  if (intersection === Math.min(a.size, b.size)) return true; // equal or subset
  return intersection >= 2;
}

/**
 * Return the object phrase captured by the first matching pattern.
 */
function matchTaskPattern(message: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const m = message.match(pattern);
    if (m) {
      const phrase = m[1]?.trim();
      if (phrase && phrase.length > 0) return phrase;
    }
  }
  return null;
}

/**
 * Deterministically detect whether a user message is about a task.
 * Never persists anything itself — it only classifies. Questions (including
 * "What's next?" and "What have I done?") are classified as "question" and are
 * never persisted as tasks. "done"/"progress" are only returned when they
 * actually apply to the current active task (or are anaphoric to it), so an
 * unrelated statement can never hijack the active task.
 */
export function detectTaskStatement(message: string): TaskStatement {
  const trimmed = message.trim();
  if (!trimmed) return { kind: "none", title: null };

  const lower = trimmed.toLowerCase();

  // Greetings and trivial chit-chat are never tasks.
  const intent = classifyUserIntent(trimmed);
  if (intent === "greeting") return { kind: "none", title: null };

  // Requests for assistance and commands to the assistant are not tasks.
  // Checked before question classification so "Can you help me?"-style asks
  // are never treated as task questions.
  if (/\bhelp\b/.test(lower)) return { kind: "none", title: null };
  if (
    /^(?:can you|could you|please|tell me|show me|give me|let me)\b/.test(lower)
  ) {
    return { kind: "none", title: null };
  }

  // Questions are never persisted as tasks. Recognized explicitly so the
  // prompt builder can inject the right context deterministically.
  const isQuestion =
    /[?]\s*$/.test(trimmed) ||
    /^(what|which|who|whom|whose|when|where|why|how|does|do|is|are|can|could|should|would|did|will)\b/.test(
      lower
    );
  if (isQuestion) {
    if (TASK_NEXT_QUESTION_PATTERNS.some((re) => re.test(lower))) {
      return { kind: "question", title: null, qtype: "next" };
    }
    if (TASK_DONE_HISTORY_PATTERNS.some((re) => re.test(lower))) {
      return { kind: "question", title: null, qtype: "doneHistory" };
    }
    return { kind: "question", title: null };
  }

  // Guard against short fragments and vague chatter.
  if (trimmed.length < 8) return { kind: "none", title: null };

  const activeTask = getActiveTaskContext();

  // "done" only applies when it matches the active task (or is anaphoric to it).
  const donePhrase = matchTaskPattern(trimmed, TASK_DONE_PATTERNS);
  if (donePhrase) {
    const candidate = normalizeTaskTitle(donePhrase);
    if (candidate.length === 0) return { kind: "none", title: null };
    const tokens = significantTaskTokens(candidate);
    if (
      activeTask !== null &&
      (tokens.length === 0 || taskTitlesMatch(candidate, activeTask.title))
    ) {
      return { kind: "done", title: null };
    }
    return { kind: "none", title: null };
  }

  // "progress" marks the active task in progress, or starts a new task when the
  // object is clearly different and self-contained.
  const progressPhrase = matchTaskPattern(trimmed, TASK_PROGRESS_PATTERNS);
  if (progressPhrase) {
    const candidate = normalizeTaskTitle(progressPhrase);
    const tokens = significantTaskTokens(candidate);
    if (
      activeTask !== null &&
      (tokens.length === 0 || taskTitlesMatch(candidate, activeTask.title))
    ) {
      return { kind: "progress", title: null };
    }
    if (tokens.length > 0 && !tokens.every((t) => TASK_FILLER_VERBS.has(t))) {
      return { kind: "create", title: candidate, status: "in_progress" };
    }
    return { kind: "none", title: null };
  }

  // "create" commits to a future action; filter out filler endings.
  const createPhrase = matchTaskPattern(trimmed, TASK_CREATE_PATTERNS);
  if (createPhrase) {
    const candidate = normalizeTaskTitle(createPhrase);
    const tokens = significantTaskTokens(candidate);
    if (tokens.length === 0 || tokens.every((t) => TASK_FILLER_VERBS.has(t))) {
      return { kind: "none", title: null };
    }
    return { kind: "create", title: candidate };
  }

  return { kind: "none", title: null };
}

/**
 * Create a new active task, deactivating any previously active task (only one
 * current task at a time). Snapshots the active project's name into project_ref
 * for lightweight traceability. Does NOT create a memory row.
 */
export function createTaskContext(
  title: string,
  status: TaskStatus = "planned"
): TaskContextRow {
  const db = getDb();
  db.prepare("UPDATE task_context SET is_active = 0 WHERE is_active = 1").run();
  const activeProject = getActiveProjectContext();
  const result = db
    .prepare(
      "INSERT INTO task_context (title, status, project_ref) VALUES (?, ?, ?)"
    )
    .run(title, status, activeProject?.name ?? "");
  return {
    id: Number(result.lastInsertRowid),
    title,
    status,
    project_ref: activeProject?.name ?? "",
    is_active: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Get the most recently updated active task. Returns null when there is no
 * current task being tracked.
 */
export function getActiveTaskContext(): TaskContextRow | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM task_context WHERE is_active = 1 ORDER BY updatedAt DESC, id DESC LIMIT 1"
    )
    .get() as TaskContextRow | undefined;
  return row ?? null;
}

/**
 * Get the most recently updated tasks (any status, including completed) for
 * "what have I done?" style questions. Capped at the given limit.
 */
export function getRecentTasks(limit: number = 3): TaskContextRow[] {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(limit, 10));
  return db
    .prepare(
      "SELECT * FROM task_context ORDER BY updatedAt DESC, id DESC LIMIT ?"
    )
    .all(safeLimit) as TaskContextRow[];
}

/**
 * Mark the current task as in progress. No-op when no task is active.
 */
export function markActiveTaskInProgress(): TaskContextRow | null {
  const active = getActiveTaskContext();
  if (!active) return null;
  const db = getDb();
  db.prepare(
    "UPDATE task_context SET status = 'in_progress', updatedAt = datetime('now') WHERE id = ?"
  ).run(active.id);
  return { ...active, status: "in_progress", updatedAt: new Date().toISOString() };
}

/**
 * Complete (archive) the current task. No-op when no task is active.
 */
export function completeActiveTask(): TaskContextRow | null {
  const active = getActiveTaskContext();
  if (!active) return null;
  const db = getDb();
  db.prepare(
    "UPDATE task_context SET status = 'done', is_active = 0, updatedAt = datetime('now') WHERE id = ?"
  ).run(active.id);
  return { ...active, status: "done", is_active: 0, updatedAt: new Date().toISOString() };
}

/**
 * Format the current-task prompt section.
 */
function formatCurrentTask(task: TaskContextRow): string {
  return (
    "\n\nTask context:\n" +
    `- Current task: ${task.title}\n` +
    `- Status: ${task.status}` +
    "\n(This is internal context about the user's current task. Use it to answer task-related follow-ups and questions like \"What's next?\". Do not mention this context to the user unless they ask about their task.)"
  );
}

/**
 * Format recent-task history for "what have I done?" style questions.
 */
function formatRecentTasks(tasks: TaskContextRow[]): string {
  return (
    "\n\nTask context:\n" +
    tasks.map((t) => `- ${t.title} (${t.status})`).join("\n") +
    "\n(These are the user's recent tasks. Use them to answer questions about what has been done. Do not mention this context to the user unless they ask about their tasks.)"
  );
}

/**
 * Deterministically decide whether a message is a follow-up to the current
 * task. Conservative: requires a question (or pronoun ambiguity) that is not
 * general knowledge or trivial, with some evidence tying it to the active task.
 */
function isTaskFollowUp(
  message: string,
  ownEntities: string[],
  recentTopics: string[],
  isTrivial: boolean,
  activeTask: TaskContextRow
): boolean {
  if (isTrivial) return false;

  const intent = classifyUserIntent(message);
  if (intent === "general_knowledge" || intent === "greeting") return false;

  const lower = message.toLowerCase().trim();
  const isQuestion =
    lower.endsWith("?") ||
    /^(does|is|are|can|could|should|would|did|do|what|which|how|why|where|when|who)\b/.test(
      lower
    );
  if (!isQuestion) return false;

  const taskTokens = significantTaskTokens(activeTask.title);
  if (taskTokens.length === 0) return false;

  const messageTokens = significantTaskTokens(message);
  const overlapsTask = messageTokens.some((t) => taskTokens.includes(t));

  // Anaphora ("it", "that", "this") most plausibly points at the current task.
  const explicitPronoun = /\b(it|that|this|there)\b/i.test(lower);
  // Evidence from the recent conversation that the task is still being discussed.
  const recentEvidence = recentTopics.some((rt) => {
    const rtTokens = significantTaskTokens(rt);
    return rtTokens.length > 0 && rtTokens.some((t) => taskTokens.includes(t));
  });

  if (overlapsTask) return true;
  if (explicitPronoun) return true;
  // A bare question right after task-related conversation is a follow-up.
  if (recentEvidence && ownEntities.length === 0) return true;

  return false;
}

/**
 * Build the planning & task awareness context for the current user message.
 * Ephemeral per-request context, never persisted by this function. Only
 * produces a section when a task exists (or for explicit "What have I done?"
 * questions about task history). Deterministic, no LLM.
 */
export function buildTaskContext(
  message: string,
  recentTopics: string[],
  isTrivial: boolean
): { section: string; isTaskRelated: boolean } {
  const statement = detectTaskStatement(message);

  // "What have I done?" works from history even without a current task.
  if (statement.kind === "question" && statement.qtype === "doneHistory") {
    const recent = getRecentTasks(3);
    if (recent.length === 0) return { section: "", isTaskRelated: false };
    return { section: formatRecentTasks(recent), isTaskRelated: true };
  }

  const activeTask = getActiveTaskContext();
  if (!activeTask) return { section: "", isTaskRelated: false };

  // "What's next?" surfaces the current task without inventing a step.
  if (statement.kind === "question" && statement.qtype === "next") {
    return { section: formatCurrentTask(activeTask), isTaskRelated: true };
  }

  // A message that is itself a task statement, or a follow-up/ambiguous
  // question about the current task.
  const isOwnStatement =
    statement.kind === "create" ||
    statement.kind === "progress" ||
    statement.kind === "done";
  const isFollowUp = isTaskFollowUp(
    message,
    extractEntities(message),
    recentTopics,
    isTrivial,
    activeTask
  );

  if (!isOwnStatement && !isFollowUp) {
    return { section: "", isTaskRelated: false };
  }

  return { section: formatCurrentTask(activeTask), isTaskRelated: true };
}

/**
 * Clear all task context rows. Used by tests and debugging to reset the
 * Planning & Task Awareness state without touching memories or projects.
 */
export function clearAllTaskContext(): number {
  const db = getDb();
  return db.prepare("DELETE FROM task_context").run().changes;
}
