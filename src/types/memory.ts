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
