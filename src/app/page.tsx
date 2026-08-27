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

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-lg">
              🐉
            </div>
            <div>
              <h1 className="font-semibold text-zinc-900 dark:text-zinc-100">
                Zyron
              </h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Your Personal AI
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsMemoryOpen(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            title="View memories"
          >
            <span className="text-lg">🧠</span>
            <span className="hidden sm:inline">Memory</span>
          </button>
        </div>
      </header>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6">
          {messages.length === 0 && !streamingText && (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center text-white text-3xl mx-auto mb-4">
                🐉
              </div>
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                Hello! I&apos;m Zyron
              </h2>
              <p className="text-zinc-500 dark:text-zinc-400 mb-4">
                Your personal AI friend. Ask me anything!
              </p>
              <div className="text-sm text-zinc-400 dark:text-zinc-500 space-y-1">
                <p>Try saying: &quot;Remember that I&apos;m an ECE student.&quot;</p>
                <p>Or ask: &quot;What do you remember about me?&quot;</p>
              </div>
            </div>
          )}

          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}

          {/* Streaming response - show text as it arrives */}
          {streamingText && (
            <div className="flex justify-start mb-4">
              <div className="bg-zinc-100 dark:bg-zinc-800 rounded-2xl rounded-bl-md px-4 py-3 max-w-[80%]">
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                  Zyron
                </div>
                <div className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
                  {streamingText}
                </div>
              </div>
            </div>
          )}

          {/* Loading indicator (only shown before streaming starts) */}
          {isLoading && !streamingText && (
            <div className="flex justify-start mb-4">
              <div className="bg-zinc-100 dark:bg-zinc-800 rounded-2xl rounded-bl-md px-4 py-3">
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                  Zyron
                </div>
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-zinc-200 dark:border-zinc-800 px-4 py-3">
        <form
          onSubmit={handleSubmit}
          className="max-w-2xl mx-auto flex gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            disabled={isLoading}
            className="flex-1 px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 text-sm"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-6 py-3 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
          >
            {isLoading ? "Sending..." : "Send"}
          </button>
        </form>
      </div>

      <MemoryPanel isOpen={isMemoryOpen} onClose={() => setIsMemoryOpen(false)} />
    </div>
  );
}
