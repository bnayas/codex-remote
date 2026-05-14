import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useSessionStream } from '../hooks/useSessionStream';
import { ErrorBoundary } from './ErrorBoundary';
import { InputBar } from './InputBar';
import { ControlBar } from './ControlBar';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

import stripAnsi from 'strip-ansi';

// Matches OSC (Operating System Commands) like window title changes: \x1b]0;title\x07 or \x1b]0;title\x1b\\
const OSC_RE = /(?:[\u001b\u009b]\][0-9]+;.*?(?:\x07|\x1b\\))|(?:\][0-9]+;.*?\\)/g;
const USER_PROMPT_MARKER = '__CODEX_REMOTE_USER_PROMPT__';

function cleanAgentOutput(s: string): string {
  // First strip OSC, then ANSI, then remove leftovers that look like broken ANSI
  let clean = stripAnsi(s.replace(OSC_RE, ''))
    .replace(/^\s*›\s*/, `${USER_PROMPT_MARKER} `)
    .replace(/[╭╰│├┼┤]/g, '') // Strip box-drawing characters
    .replace(/─/g, '') // Strip horizontal lines
    .replace(/>_ OpenAI Codex \(v[0-9.]+\)/g, '') // Strip codex header
    .replace(/model:.*\/model to change/g, '')
    .replace(/directory: .*/g, '')
    .replace(/M M M M.*/g, '') // Strip the weird 'M M' artifact
    // Clean up specific broken OSC fragments we saw
    .replace(/\]0;.*?codex-remote/g, '')
    .replace(/7u/g, '')
    .replace(/\[\?u/g, '')
    .replace(/›/g, '')
    .replace(/gpt-5\.5.*/g, '')
    .replace(/[q╮╯]/g, '')
    .replace(/\s*Called [\w-]+(?:\.[\w-]+)?\(.+$/g, '')
    .trim();
  
  return clean;
}

interface Message {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
}

function compactBlankLines(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isAgentLine(line: string): boolean {
  return /^([•●]\s|I('|’)?ll\s|I('|’)?m\s|The\s|Current state:|Checks passed:|Branch:|Implemented:|Verified:|Chrome test is open)/.test(line);
}

function isUserPromptLine(line: string): boolean {
  return line.startsWith(USER_PROMPT_MARKER);
}

function withoutUserPromptMarker(line: string): string {
  return isUserPromptLine(line) ? line.slice(USER_PROMPT_MARKER.length).trimStart() : line;
}

function isSystemLine(line: string): boolean {
  return line.includes('Conversation interrupted') || line.includes('/feedback');
}

function isToolTraceLine(line: string): boolean {
  return line === 'System'
    || /^([└]\s?|[•●]\s*Called |Called |tool result|\<image content\>|Computer Use state|App=|Window:|The focused UI element is|<app_state>|<\/app_state>)/i.test(line)
    || /^\d+\s+(standard window|container|toolbar|button|text|image|tab|menu|HTML content|close button|full screen|minimise|row|cell|column|link|pop-up button|text field)/.test(line)
    || line.includes('/skills')
    || line === 'issue.';
}

function formatSystemLine(line: string): string {
  if (line.includes('Conversation interrupted') || line.includes('/feedback')) {
    return 'Conversation interrupted.';
  }
  return line;
}

function looksLikeUserLine(
  line: string,
  nextMeaningful?: string,
  previousRole?: Message['role'],
  previousLine?: string
): boolean {
  if (isUserPromptLine(line)) return true;
  if (!line || isAgentLine(line) || isSystemLine(line)) return false;
  if (/^(frontend|backend|android)\s+npm\s+run\s+/.test(line)) return false;
  if (/^(Commit:|Output:|Token:|Test backend:|Current state:)/.test(line)) return false;
  if (previousRole === 'agent' && previousLine && !/[.!?:)\]`'"]$/.test(previousLine)) {
    return false;
  }
  if (nextMeaningful && (isAgentLine(nextMeaningful) || isSystemLine(nextMeaningful))) return true;
  return /^[A-Z0-9"'-]/.test(line) && line.length <= 180 && /[?.!]$/.test(line);
}

function appendParsedMessage(messages: Message[], role: Message['role'], line: string, timestamp: number): void {
  const content = role === 'agent'
    ? line.replace(/^[•●]\s*/, '')
    : role === 'system'
    ? formatSystemLine(line)
    : withoutUserPromptMarker(line);
  const last = messages[messages.length - 1];
  if (last?.role === role && last.content === content) return;
  if (last?.role === role) {
    last.content = compactBlankLines(`${last.content}\n${content}`);
    return;
  }
  messages.push({
    id: `${role}-${timestamp}-${messages.length}`,
    role,
    content,
    timestamp,
  });
}

function parseScrollback(lines: string[]): Message[] {
  const visibleLines = lines
    .map(line => cleanAgentOutput(line))
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !isToolTraceLine(line));

  const messages: Message[] = [];
  const timestamp = Date.now();

  let previousRole: Message['role'] | undefined;
  let previousLine = '';

  visibleLines.forEach((line, index) => {
    const nextMeaningful = visibleLines.slice(index + 1).find(Boolean);
    const isContinuation = Boolean(
      previousRole
      && previousRole !== 'system'
      && !isUserPromptLine(line)
      && previousLine
      && !/[.!?:)\]`'"]$/.test(previousLine)
    );
    const role: Message['role'] = isSystemLine(line)
      ? 'system'
      : isAgentLine(line)
      ? 'agent'
      : isContinuation
      ? previousRole!
      : looksLikeUserLine(line, nextMeaningful, previousRole, previousLine)
      ? 'user'
      : 'agent';

    appendParsedMessage(messages, role, line, timestamp);
    previousRole = role;
    previousLine = line;
  });

  return messages.length > 0 ? messages : [{
    id: 'history-empty',
    role: 'system',
    content: 'No conversation history yet.',
    timestamp,
  }];
}

function conversationStatusLabel(
  connected: boolean,
  alive: boolean,
  status: string,
  error?: string
): { label: string; tone: 'alive' | 'dead' | 'warn' } {
  if (connected && alive) return { label: '● Live', tone: 'alive' };
  if (error) return { label: `↻ ${error}`, tone: 'warn' };
  if (connected && !alive) return { label: `○ History only · ${status}`, tone: 'dead' };
  return { label: `○ Offline · ${status}`, tone: 'dead' };
}

export function AgentConversation({
  sessionId,
  agentName,
  sessionStatus,
  onState,
  onRefresh,
}: {
  sessionId: string;
  agentName: string;
  sessionStatus?: string;
  onState?: (state: { connected: boolean; alive: boolean; status: string }) => void;
  onRefresh?: () => Promise<void> | void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [alive, setAlive] = useState(false);
  const [status, setStatus] = useState(sessionStatus ?? 'unknown');
  const [refreshing, setRefreshing] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const handleJsonEvent = useCallback((msg: any) => {
    if (msg.type !== 'agent_json_chunk' || !msg.content?.trim()) return;
    
    setMessages(prev => {
      // If the last message is from the agent and within 2 seconds, just append to it
      const last = prev[prev.length - 1];
      const now = Date.now();
      
      if (last && last.role === 'agent' && (now - last.timestamp < 2000)) {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = {
          ...last,
          content: last.content + msg.content,
          timestamp: now
        };
        return newMessages;
      }

      return [...prev, {
        id: Math.random().toString(36).substring(7),
        role: 'agent',
        content: msg.content,
        timestamp: now
      }];
    });
  }, []);

  const handleScrollback = useCallback((lines: string[]) => {
    setMessages(parseScrollback(lines));
  }, []);

  const stream = useSessionStream({
    sessionId,
    channel: 'agent',
    onJsonEvent: handleJsonEvent,
    onScrollback: handleScrollback,
    onExit: () => setAlive(false),
  });

  useEffect(() => {
    if (stream.connected) {
      setAlive(stream.alive);
      setStatus(stream.status);
      onState?.({ connected: stream.connected, alive: stream.alive, status: stream.status });
    }
  }, [stream.connected, stream.alive, stream.status, onState]);

  useEffect(() => {
    setStatus(sessionStatus ?? 'unknown');
  }, [sessionStatus]);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  async function refreshConversationStatus() {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  const statusInfo = conversationStatusLabel(stream.connected, alive, status, stream.error);

  return (
    <div className="conversation-outer">
      <div className="conversation-header">
        <span className="conversation-label">{agentName} conversation</span>
        <div className="conversation-status-wrap">
          <span className={`conversation-status ${statusInfo.tone}`}>{statusInfo.label}</span>
          {(!alive || stream.error) && onRefresh && (
            <button
              className="conversation-refresh"
              onClick={refreshConversationStatus}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          )}
        </div>
      </div>
      
      {stream.error && (
        <div className="conversation-error">
          {stream.error}
        </div>
      )}
      
      <div className="conversation-messages" ref={containerRef} onScroll={handleScroll}>
        {messages.map(msg => {
          const isUser = msg.role === 'user';
          const isSystem = msg.role === 'system';
          return (
            <div key={msg.id} className={`conversation-row ${msg.role}`}>
              {msg.role === 'agent' && (
                <img src="/agent_avatar.png" alt="Agent" className="conversation-avatar" />
              )}
              
              <div className={`conversation-bubble ${msg.role}`}>
                <div className="conversation-role-label">
                  {isUser ? 'You' : isSystem ? 'Status' : agentName}
                </div>
                {isUser || isSystem ? (
                  msg.content.trim()
                ) : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ node, ...props }) => <p className="conversation-paragraph" {...props} />,
                      a: ({ node, ...props }) => <a className="conversation-link" {...props} />,
                      ul: ({ node, ...props }) => <ul className="conversation-list" {...props} />,
                      ol: ({ node, ...props }) => <ol className="conversation-list" {...props} />,
                      blockquote: ({ node, ...props }) => <blockquote className="conversation-remark" {...props} />,
                      code({ node, inline, className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || '');
                        const text = String(children).replace(/\n$/, '');
                        const isBlock = !inline && (Boolean(match) || text.includes('\n'));
                        const language = match?.[1] ?? 'text';

                        return isBlock ? (
                          <div className="conversation-code-block">
                            <div className="conversation-code-header">
                              <div className="conversation-code-dots" aria-hidden="true">
                                <span />
                                <span />
                                <span />
                              </div>
                              <span>{language}</span>
                            </div>
                            <SyntaxHighlighter
                              style={vscDarkPlus as any}
                              language={language}
                              PreTag="div"
                              customStyle={{ margin: 0, padding: '12px', background: 'transparent' }}
                              {...props}
                            >
                              {text}
                            </SyntaxHighlighter>
                          </div>
                        ) : (
                          <code className="conversation-inline-code" {...props}>
                            {children}
                          </code>
                        );
                      }
                    }}
                  >
                    {cleanAgentOutput(msg.content)}
                  </ReactMarkdown>
                )}
              </div>

              {isUser && (
                <img src="/user_avatar.png" alt="You" className="conversation-avatar user" />
              )}
            </div>
          );
        })}
        {messages.length === 0 && (
          <div className="conversation-empty">
            No conversation history yet.
          </div>
        )}
      </div>

      <ErrorBoundary fallbackMessage="Input error">
        <InputBar 
          sessionId={sessionId} 
          disabled={!alive} 
          target="agent" 
          placeholder={`Message ${agentName}…`} 
          disabledPlaceholder="History only - refresh to check the remote"
          // Intercept input to add user messages optimistically
          onSendOptimistic={(text) => {
            setMessages(prev => [...prev, {
              id: Math.random().toString(36).substring(7),
              role: 'user',
              content: text,
              timestamp: Date.now()
            }]);
          }}
        />
        <ControlBar sessionId={sessionId} alive={alive} target="agent" agentName={agentName} />
      </ErrorBoundary>
    </div>
  );
}
