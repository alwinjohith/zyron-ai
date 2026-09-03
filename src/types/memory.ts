// Represents a stored memory in the database
export interface Memory {
  id: number;
  content: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

// Valid memory categories
export type MemoryCategory =
  | "personal"
  | "education"
  | "projects"
  | "goals"
  | "preferences"
  | "general";

// API response for memory operations
export interface MemoryApiResponse {
  success: boolean;
  memory?: Memory;
  memories?: Memory[];
  error?: string;
  message?: string;
}

// A memory selected as relevant to the current chat message.
// `score` is the combined relevance score used to rank and filter it.
export interface RelevantMemory extends Memory {
  score: number;
}

// The subset of stored memories retrieved for a single user message.
export interface RelevantMemoryContext {
  // Latest user message the memories were selected for.
  query: string;
  // Relevant memories, best match first.
  memories: RelevantMemory[];
  // Number of relevant memories retrieved (memories.length).
  count: number;
}

// Emotional / conversational tone detected from a user message.
// This is ephemeral (per-request) and is NEVER written to the database.
export type ToneIntent =
  | "positive"     // achievement, good news, excitement
  | "distress"     // failure, frustration, sadness, being stuck
  | "casual"       // informal, colloquial ("bro", "hey", slang)
  | "educational"  // neutral explanation / knowledge request
  | "neutral";     // no clear tone signal

export interface ToneContext {
  // The dominant tone intent for the message.
  tone: ToneIntent;
  // True when a tone directive should be injected into the prompt.
  hasTone: boolean;
}

// ============================================================
// STAGE 9: USER PREFERENCES
// ============================================================

/** Confidence level for a detected user preference. */
export type PreferenceConfidence = "high" | "medium" | "low";

/** Category of a user preference (subset of memory categories). */
export type PreferenceCategory =
  | "communication"
  | "coding"
  | "workflow"
  | "technology"
  | "content"
  | "general";

/** A stored user preference row. */
export interface UserPreference {
  id: number;
  category: PreferenceCategory;
  key: string;
  value: string;
  confidence: PreferenceConfidence;
  is_active: number;
  createdAt: string;
  updatedAt: string;
}

/** Result of deterministic preference detection on a user message. */
export interface PreferenceDetectionResult {
  detected: boolean;
  key: string | null;
  value: string | null;
  category: PreferenceCategory | null;
  confidence: PreferenceConfidence;
  /** True when the message is a temporary request, NOT a durable preference. */
  isTemporary: boolean;
}
