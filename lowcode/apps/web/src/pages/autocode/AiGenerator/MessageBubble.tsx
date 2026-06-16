import type { AiMessage } from './types';

export function MessageBubble({ msg }: { msg: AiMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 8,
      }}
    >
      <div
        style={{
          maxWidth: '80%',
          padding: '8px 12px',
          borderRadius: 8,
          background: isUser ? '#1677ff' : '#fff',
          border: isUser ? 'none' : '1px solid #f0f0f0',
          color: isUser ? '#fff' : '#000',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        {msg.content || (msg.streaming ? '' : '(空)')}
        {msg.streaming ? (
          <span style={{ animation: 'erblink 1s step-end infinite' }}>▍</span>
        ) : null}
      </div>
      <style>{`@keyframes erblink { 0%,50% { opacity: 1; } 51%,100% { opacity: 0; } }`}</style>
    </div>
  );
}
