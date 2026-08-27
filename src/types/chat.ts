// Represents a single chat message
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

// Props for the ChatMessage component
export interface ChatMessageProps {
  message: Message;
}
