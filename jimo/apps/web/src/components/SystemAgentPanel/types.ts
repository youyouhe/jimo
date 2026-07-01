export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  progressLines?: string[];
  streaming?: boolean;
}
