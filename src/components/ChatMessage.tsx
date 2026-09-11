import type { Message } from "@/types/chat";

// Displays a single chat message with different styling for user vs AI
export default function ChatMessage({
  message,
  isSpeaking = false,
}: {
  message: Message;
  isSpeaking?: boolean;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="mb-4 flex justify-end animate-[fade-up_0.3s_ease-out]">
        <div className="max-w-[80%]">
          <div className="mb-1 text-right text-[10px] font-semibold uppercase tracking-widest text-orange-200/70">
            You
          </div>
          <div className="ember-glow rounded-2xl rounded-br-md border border-white/10 bg-gradient-to-br from-orange-500/90 to-red-700/90 px-4 py-3 text-sm leading-relaxed text-white">
            <div className="whitespace-pre-wrap">{message.content}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-start justify-start gap-3 animate-[fade-up_0.3s_ease-out]">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 via-orange-600 to-red-700 text-xs ring-1 ring-white/20">
        🐉
      </div>
      <div className="max-w-[80%]">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-orange-200/80">
          Zyron
        </div>
        <div
          className={`glass rounded-2xl rounded-bl-md px-4 py-3 text-sm leading-relaxed text-stone-100 ${
            isSpeaking ? "ring-1 ring-orange-500/70" : ""
          }`}
        >
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
        {isSpeaking && (
          <div
            role="status"
            className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-orange-300"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400" />
            Speaking…
          </div>
        )}
      </div>
    </div>
  );
}