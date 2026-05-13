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

function cleanAgentOutput(s: string): string {
  // First strip OSC, then ANSI, then remove leftovers that look like broken ANSI
  let clean = stripAnsi(s.replace(OSC_RE, ''))
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
    .trim();
  
  return clean;
}

interface Message {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
}

export function AgentConversation({
  sessionId,
  agentName,
}: {
  sessionId: string;
  agentName: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [alive, setAlive] = useState(false);
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
    // When connecting, we get the whole scrollback history.
    // Parse it as a single block for now.
    const text = lines.join('\n');
    setMessages([{
      id: 'history',
      role: 'agent',
      content: text,
      timestamp: Date.now()
    }]);
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
    }
  }, [stream.connected, stream.alive]);

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

  return (
    <div className="conversation-outer">
      <div className="conversation-header">
        <span className="conversation-label">{agentName} conversation</span>
        <span className={`conversation-status ${alive ? 'alive' : 'dead'}`}>{alive ? '● live' : '○ offline'}</span>
      </div>
      
      {stream.error && (
        <div className="conversation-error">
          {stream.error}
        </div>
      )}
      
      <div className="conversation-messages" ref={containerRef} onScroll={handleScroll}>
        {messages.map(msg => {
          const isUser = msg.role === 'user';
          return (
            <div key={msg.id} className={`conversation-row ${isUser ? 'user' : 'agent'}`}>
              {!isUser && (
                <img src="/agent_avatar.png" alt="Agent" className="conversation-avatar" />
              )}
              
              <div className={`conversation-bubble ${isUser ? 'user' : 'agent'}`}>
                {isUser ? (
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
