import {
  createMemory,
  getAllMemories,
  deleteMemory,
  clearAllMemories,
  findDuplicateMemory,
  updateMemory,
  getMemoryById,
  categorizeMemory,
  recategorizeAllMemories,
  getRelevantMemories,
  hasRemovalSignal,
  hasUpdateSignal,
  resolveMemoryConflict,
} from "@/lib/db";
import type { RelevantMemory, RelevantMemoryContext } from "@/types/memory";

// Fix categories for any existing memories on startup
try {
  const fixed = recategorizeAllMemories();
  if (fixed > 0) console.log(`[Memory V2] Recategorized ${fixed} memories`);
} catch {
  // DB may not exist yet on first run — safe to ignore
}

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.MODEL || "qwen3:1.7b";

const SYSTEM_PROMPT = `You are Zyron, a friendly personal AI assistant. You help the user with their daily tasks, questions, and goals.

CRITICAL RULES ABOUT STORED MEMORIES:
- Relevant stored facts about the user are listed in the "Relevant information about the user" section below, when present.
- Use these facts naturally to personalize your answer when they help answer the message.
- If the user asks about their own information (name, studies, projects, preferences) and a relevant fact is listed, answer with it.
- NEVER say you don't know if the answer is in the listed facts.
- If no listed fact helps answer the question, just answer normally and do not mention stored memories.
- NEVER invent or guess personal information. Only use what is actually listed.
- Do not mention that facts are stored memories unless the user explicitly asks what you remember.

YOUR IDENTITY:
- Your name is Zyron. Always identify yourself as Zyron.
- You are an AI assistant, not a human.

RESPONSE STYLE:
- Be friendly and natural.
- Be concise by default.
- Answer simple questions in 1–3 sentences.
- Do not give long explanations unless the user asks for detail.
- Do not repeat the user's question unnecessarily.
- Do not repeat the same greeting or introduction.
- Do not mention internal reasoning.
- Never expose thinking/reasoning.
- Use stored memories when relevant.
- Never invent memories.
- If information isn't stored or known, say so honestly.
- Keep the Zyron identity consistent.
- Be slightly playful when appropriate, but don't force jokes or emojis into every response.

IMPORTANT:
- If the user explicitly asks for detail, code, tutorials, or long explanations, provide them.
- Do not be overly restrictive — adapt to what the user is asking for.

GENERAL BEHAVIOR:
- Be friendly, helpful, and concise.
- When confirming a memory was saved, respond briefly and warmly.`;

type MemoryCommandResult =
  | { type: "save"; content: string }
  | { type: "update"; memoryId: number; content: string }
  | { type: "forget"; content: string }
  | { type: "forget_all" }
  | { type: "list" }
  | null;

/**
 * Detect memory commands from the user message.
 * Uses a normalized copy for pattern matching, but preserves the
 * original casing in the returned content.
 */
function detectMemoryCommand(message: string): MemoryCommandResult {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  // --- Forget everything ---
  if (
    /forget\s+(everything|all)/.test(lower) ||
    /clear\s+(all\s+)?(memories?|remembered)/.test(lower)
  ) {
    return { type: "forget_all" };
  }

  // --- Update memory N to ... ---
  const updateMatch = lower.match(
    /^(?:update|change)\s+memory\s+(\d+)\s+to\s+(.+)/
  );
  if (updateMatch) {
    const memoryId = parseInt(updateMatch[1], 10);
    const contentStart =
      lower.indexOf("to ", lower.indexOf(updateMatch[1])) + 3;
    const content = trimmed.slice(contentStart).trim();
    if (content.length > 0 && !isNaN(memoryId)) {
      return { type: "update", memoryId, content };
    }
  }

  // --- Forget a specific memory ---
  const forgetMatch = lower.match(/^forget\s+(that\s+)?(.+)$/);
  if (forgetMatch) {
    return { type: "forget", content: forgetMatch[2].trim() };
  }

  // --- List memories ---
  if (
    /what\s+(do\s+)?you\s+remember/.test(lower) ||
    /(list|show|view)\s+(my\s+)?(memories?|remembered)/.test(lower)
  ) {
    return { type: "list" };
  }

  // --- Remember / save patterns ---
  const rememberPatterns = [
    /remember\s+that\s+(.+)/,
    /remember\s+(.+)/,
    /save\s+this\s*:\s*(.+)/,
    /save\s+this\s+(.+)/,
    /keep\s+this\s+in\s+(memory|mind)\s*:\s*(.+)/,
    /keep\s+this\s+in\s+(memory|mind)\s+(.+)/,
    /don'?t\s+forget\s+that\s+(.+)/,
    /don'?t\s+forget\s+(.+)/,
  ];

  for (const pattern of rememberPatterns) {
    const match = lower.match(pattern);
    if (match) {
      const captured = match[match.length - 1];
      const capturedStart = lower.indexOf(captured);
      const originalContent = trimmed.slice(capturedStart).trim();
      if (originalContent.length > 0) {
        return { type: "save", content: originalContent };
      }
    }
  }

  return null;
}

/**
 * Detect if a user message is a declarative fact statement about themselves.
 * Returns true only for sentences that look like useful long-term memory.
 * Returns false for questions, commands, greetings, and vague chatter.
 */
function isUserFactStatement(message: string): boolean {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  // Must be a statement (ends with period, not ? or !)
  if (!trimmed.endsWith(".")) return false;

  // Must be long enough to be meaningful
  if (trimmed.length < 15) return false;

  // Must contain a self-reference pronoun
  if (!/\b(i\s|my\s|i'm|i've|i'll|i'd)\b/.test(lower)) return false;

  // Skip explicit memory commands
  if (/^(remember|save|forget|what do you remember)/i.test(lower)) return false;

  // Skip questions and imperatives
  if (/^(can you|could you|please|help me|what|how|why|when|where|who|do you|are you|is there|tell me|show me|give me|i need|i want help|let me)/i.test(lower)) return false;

  // Skip very short or vague statements
  if (/^(yes\.|no\.|ok\.|okay\.|sure\.|thanks\.|hello\.|hi\.|hey\.)/i.test(lower)) return false;

  // Must match a specific category pattern (not "general").
  // If it matches a category keyword, it's likely a useful fact.
  const category = categorizeMemory(trimmed);
  if (category === "general") return false;

  return true;
}

/**
 * Rewrite a first-person memory into the user's perspective so the prompt
 * reads naturally: "I am an ECE student." -> "The user is an ECE student."
 */
function toUserPerspective(content: string): string {
  const rewritten = content
    .replace(/\bi\s+am\b/i, "the user is")
    .replace(/\bi'm\b/i, "the user is")
    .replace(/\bi\b/gi, "the user")
    .replace(/\bmy\b/gi, "the user's");
  return rewritten.charAt(0).toUpperCase() + rewritten.slice(1);
}

/**
 * Build the "Relevant information about the user" prompt section.
 * Returns an empty string when there are no relevant memories so nothing
 * is added to the prompt for unrelated questions.
 */
function formatRelevantMemoryContext(memories: RelevantMemory[]): string {
  if (memories.length === 0) return "";
  return (
    "\n\nRelevant information about the user:\n" +
    memories.map((m) => `- ${toUserPerspective(m.content)}`).join("\n") +
    "\n\nUse this information naturally when it helps answer the user's message. " +
    "Do not mention that these are stored memories unless the user explicitly asks what you remember. " +
    "Do not invent information."
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return Response.json(
        { error: "Messages array is required" },
        { status: 400 }
      );
    }

    const lastUserMessage = [...messages]
      .reverse()
      .find((m: { role: string }) => m.role === "user");

    if (!lastUserMessage) {
      return Response.json(
        { error: "No user message found" },
        { status: 400 }
      );
    }

    const userText = lastUserMessage.content as string;
    const memoryCommand = detectMemoryCommand(userText);

    if (memoryCommand) {
      switch (memoryCommand.type) {
        case "save": {
          const content = memoryCommand.content;
          const existing = findDuplicateMemory(content);
          if (existing) {
            return Response.json({
              message: "I already remember that.",
              memorySaved: false,
            });
          }
          const category = categorizeMemory(content);
          // Archive any active memory describing the same underlying fact,
          // then store the newly stated value as the current one.
          const resolution = resolveMemoryConflict(content, category);
          createMemory(content, category);
          const updated = resolution.action === "archived";
          return Response.json({
            message: updated
              ? `Got it! I've updated that: "${content}"`
              : `Got it! I'll remember that: "${content}"`,
            memorySaved: true,
          });
        }
        case "update": {
          const existing = getMemoryById(memoryCommand.memoryId);
          if (!existing) {
            return Response.json({
              message: `I couldn't find memory #${memoryCommand.memoryId}. Nothing was updated.`,
            });
          }
          const category = categorizeMemory(memoryCommand.content);
          const updated = updateMemory(
            memoryCommand.memoryId,
            memoryCommand.content,
            category
          );
          return Response.json({
            message: `Updated memory #${memoryCommand.memoryId}: "${updated!.content}"`,
            memorySaved: true,
          });
        }
        case "forget": {
          const allMemories = getAllMemories();
          const matchingMemories = allMemories.filter((m) =>
            m.content.toLowerCase().includes(memoryCommand.content!.toLowerCase())
          );
          if (matchingMemories.length === 0) {
            return Response.json({
              message: `I couldn't find a memory matching "${memoryCommand.content}". Nothing was deleted.`,
            });
          }
          let deletedCount = 0;
          for (const m of matchingMemories) {
            if (deleteMemory(m.id)) deletedCount++;
          }
          return Response.json({
            message: `Done! I've forgotten ${deletedCount} memory about "${memoryCommand.content}".`,
          });
        }
        case "forget_all": {
          const count = clearAllMemories();
          return Response.json({
            message:
              count > 0
                ? `Done! I've cleared all ${count} memories. I no longer have any stored information about you.`
                : "I don't have any stored memories to clear.",
          });
        }
        case "list": {
          const memories = getAllMemories();
          if (memories.length === 0) {
            return Response.json({
              message:
                "I don't have any stored memories about you yet. You can ask me to remember things like \"Remember that I'm an ECE student.\"",
            });
          }
          const memoryList = memories
            .map((m, i) => `${i + 1}. ${m.content}`)
            .join("\n");
          return Response.json({
            message: `Here's what I remember about you:\n\n${memoryList}`,
          });
        }
      }
    }

    // --- Memory V4/V5: Update or archive stale memories from conversation ---
    // Only for non-question statements that clearly indicate a change.
    // Conflicting memories describing the same fact are archived (history is
    // preserved) and the newest statement becomes the active value.
    let handledByV4 = false;
    const trimmedUserText = userText.trim();
    if (!trimmedUserText.endsWith("?") && trimmedUserText.length >= 12) {
      const removalSignal = hasRemovalSignal(userText);
      const updateSignal = hasUpdateSignal(userText);

      if (removalSignal || updateSignal) {
        const newCategory = categorizeMemory(userText);
        const resolution = resolveMemoryConflict(userText, newCategory);
        if (resolution.action === "archived") {
          if (removalSignal && !updateSignal) {
            // Removal: the old fact is archived and nothing new is stored.
            console.log(
              `[Memory V5] Archived ${resolution.archived.length} memory: ${resolution.archived.map((m) => `"${m.content}"`).join(", ")}`
            );
          } else {
            // Update: archive the old value, store the new statement as active.
            const category =
              newCategory === "general"
                ? resolution.archived[0].category
                : newCategory;
            createMemory(userText, category);
            console.log(
              `[Memory V5] Replaced ${resolution.archived.length} memory with "${trimmedUserText}" (${category})`
            );
          }
          handledByV4 = true;
        } else if (resolution.action === "noop") {
          // Negation without a matching memory: don't store it as a new fact.
          handledByV4 = true;
        }
        // "no-conflict": no existing fact matched — fall through to V3,
        // which decides whether the statement is a new fact worth storing.
      }
    }

    // --- Memory V3/V5: Auto-extract facts from natural conversation ---
    // Only runs for non-command messages that look like personal fact statements.
    if (!handledByV4 && isUserFactStatement(userText)) {
      const existing = findDuplicateMemory(userText);
      if (!existing) {
        const category = categorizeMemory(userText);
        // Archive any active memory describing the same underlying fact so
        // only the newest statement remains active.
        const resolution = resolveMemoryConflict(userText, category);
        if (resolution.action !== "noop") {
          createMemory(userText, category);
          if (resolution.action === "archived") {
            console.log(
              `[Memory V5] Archived ${resolution.archived.length} conflicting memory: ${resolution.archived.map((m) => `"${m.content}"`).join(", ")}`
            );
          }
          console.log(`[Memory V3] Auto-saved: "${userText}" → ${category}`);
        }
      }
    }

    // Retrieve only the memories relevant to the current user message.
    // Unrelated memories are excluded so the model never sees the full table.
    // Pass recent conversation history for context-aware relevance.
    const recentMessages = messages.slice(-6); // last 6 messages for context
    const relevantMemories = getRelevantMemories(userText, recentMessages);
    const memoryContext: RelevantMemoryContext = {
      query: userText,
      memories: relevantMemories,
      count: relevantMemories.length,
    };
    const memoryPromptSection = formatRelevantMemoryContext(
      memoryContext.memories
    );

    const ollamaMessages = [
      {
        role: "system",
        content: SYSTEM_PROMPT + memoryPromptSection,
      },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    // think: false disables Qwen3 reasoning for fast responses on CPU.
    // With think:false, the model outputs only the final answer in message.content.
    const ollamaResponse = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: ollamaMessages,
        stream: true,
        think: false,
        keep_alive: "5m",
        options: {
          num_predict: 256,
          temperature: 0.3,
          top_p: 0.9,
        },
      }),
    });

    if (!ollamaResponse.ok) {
      const errorText = await ollamaResponse.text();
      console.error("Ollama error:", errorText);
      return Response.json(
        { error: "Failed to get response from AI" },
        { status: 502 }
      );
    }

    // Transform Ollama NDJSON stream into a plain text stream.
    // With think: false, each chunk has only message.content (the final answer).
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = ollamaResponse.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const json = JSON.parse(line);
                const msg = json.message;
                // ONLY forward content, NEVER forward thinking
                if (msg?.content) {
                  controller.enqueue(encoder.encode(msg.content));
                }
                // msg.thinking is intentionally ignored
              } catch {
                // Skip malformed JSON lines
              }
            }
          }

          // Process remaining buffer
          if (buffer.trim()) {
            try {
              const json = JSON.parse(buffer);
              const msg = json.message;
              if (msg?.content) {
                controller.enqueue(encoder.encode(msg.content));
              }
            } catch {
              // Skip malformed JSON
            }
          }
        } catch (err) {
          console.error("Stream error:", err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return Response.json(
      { error: "Something went wrong. Is Ollama running?" },
      { status: 500 }
    );
  }
}
