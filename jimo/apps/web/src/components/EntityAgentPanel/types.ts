export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  progressLines?: string[];  // tool progress notes — shown in UI but NOT sent to model
  streaming?: boolean;
}
