import type { Message } from "@/types/chat";

// Displays a single chat message with different styling for user vs AI
export default function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-blue-600 text-white rounded-br-md"
            : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 rounded-bl-md"
        }`}
      >
        {/* Show label above the message */}
        <div
          className={`text-xs font-medium mb-1 ${
            isUser
              ? "text-blue-200"
              : "text-zinc-500 dark:text-zinc-400"
          }`}
        >
          {isUser ? "You" : "Zyron"}
        </div>
        {/* The actual message content */}
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  );
}
