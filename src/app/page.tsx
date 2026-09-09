"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import ChatMessage from "@/components/ChatMessage";
import MemoryPanel from "@/components/MemoryPanel";
import type { Message } from "@/types/chat";

// Generate a unique ID for each message
function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  // Holds the AI response text while streaming
  const [streamingText, setStreamingText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to the latest message whenever messages or streaming text changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Send a message to the AI
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setStreamingText("");

    try {
      const chatHistory = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatHistory }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to get response");
      }

      // Check if the response is streaming (text/plain) or JSON
      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("text/plain")) {
        // Handle streaming response
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            fullText += chunk;
            setStreamingText(fullText);
          }
        }

        // Add the complete message to chat
        const aiMessage: Message = {
          id: generateId(),
          role: "assistant",
          content: fullText,
        };
        setMessages((prev) => [...prev, aiMessage]);
        setStreamingText("");
      } else {
        // Handle JSON response (memory commands)
        const data = await response.json();
        const aiMessage: Message = {
          id: generateId(),
          role: "assistant",
          content: data.message,
        };
        setMessages((prev) => [...prev, aiMessage]);
      }
    } catch (error) {
      const errorMessage: Message = {
        id: generateId(),
        role: "assistant",
        content:
          "Sorry, I couldn't connect. Make sure Ollama is running on your computer.",
      };
      setMessages((prev) => [...prev, errorMessage]);
      console.error("Chat error:", error);
    } finally {
      setIsLoading(false);
      setStreamingText("");
      inputRef.current?.focus();
    }
  }

  // Fill the composer with a suggested prompt
  function fillSuggestion(text: string) {
    setInput(text);
    inputRef.current?.focus();
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/30 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="ember-glow flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 via-orange-600 to-red-700 text-base ring-1 ring-white/20">
              🐉
            </div>
            <div>
              <h1 className="font-bold text-stone-50">Zyron</h1>
              <p className="text-xs text-stone-400">Your Personal AI</p>
            </div>
          </div>
          <button
            onClick={() => setIsMemoryOpen(true)}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-stone-200 transition-colors hover:border-orange-500/40 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70"
            title="View memories"
          >
            <span className="text-base">🧠</span>
            <span className="hidden sm:inline">Memory</span>
          </button>
        </div>
      </header>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-6">
          {messages.length === 0 && !streamingText && (
            <div className="py-16 text-center">
              <div className="ember-glow mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 via-orange-600 to-red-700 text-4xl ring-4 ring-white/10">
                🐉
              </div>
              <h2 className="mb-3 text-3xl font-bold tracking-tight text-stone-100 sm:text-4xl">
                Hello! I&apos;m <span className="text-ember-gradient">Zyron</span>
              </h2>
              <p className="mb-7 text-stone-400">
                Your personal AI friend. Ask me anything!
              </p>
              <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => fillSuggestion("Remember that I'm an ECE student.")}
                  className="w-full max-w-xs rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-stone-300 transition-colors hover:border-orange-500/40 hover:text-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70 sm:w-auto"
                >
                  Remember that I&apos;m an ECE student
                </button>
                <button
                  type="button"
                  onClick={() => fillSuggestion("What do you remember about me?")}
                  className="w-full max-w-xs rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-stone-300 transition-colors hover:border-orange-500/40 hover:text-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70 sm:w-auto"
                >
                  What do you remember about me?
                </button>
              </div>
            </div>
          )}

          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}

          {/* Streaming response - show text as it arrives */}
          {streamingText && (
            <div className="mb-4 flex items-start justify-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 via-orange-600 to-red-700 text-xs ring-1 ring-white/20">
                🐉
              </div>
              <div className="glass max-w-[80%] rounded-2xl rounded-bl-md px-4 py-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-orange-200/80">
                  Zyron
                </div>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-stone-100">
                  {streamingText}
                </div>
              </div>
            </div>
          )}

          {/* Loading indicator (only shown before streaming starts) */}
          {isLoading && !streamingText && (
            <div className="mb-4 flex items-start justify-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 via-orange-600 to-red-700 text-xs ring-1 ring-white/20">
                🐉
              </div>
              <div className="glass rounded-2xl rounded-bl-md px-4 py-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-orange-200/80">
                  Zyron
                </div>
                <div className="flex gap-1">
                  <span className="h-2 w-2 rounded-full bg-orange-500 animate-bounce [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 rounded-full bg-orange-500 animate-bounce [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 rounded-full bg-orange-500 animate-bounce" />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-white/10 bg-black/30 px-4 py-3 backdrop-blur-xl">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-2xl gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            disabled={isLoading}
            className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-stone-100 placeholder-stone-500 focus:border-orange-500/40 focus:outline-none focus:ring-2 focus:ring-orange-500/60 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="rounded-2xl bg-gradient-to-r from-orange-500 to-red-600 px-6 py-3 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-orange-500/70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "Sending..." : "Send"}
          </button>
        </form>
      </div>

      <MemoryPanel isOpen={isMemoryOpen} onClose={() => setIsMemoryOpen(false)} />
    </div>
  );
}