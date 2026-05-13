import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ChangedFile } from '../types';
import { useSessionStream } from '../hooks/useSessionStream';
import { copyText } from '../utils';

const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export function Terminal({
  sessionId,
  channel = 'agent',
  label,
  alive,
  onGitStatus,
  onExit,
  onState,
}: {
  sessionId: string;
  channel?: 'agent' | 'shell';
  label: string;
  alive: boolean;
  onGitStatus?: (files: ChangedFile[], branch: string) => void;
  onExit?: (status: string) => void;
  onState?: (state: { connected: boolean; alive: boolean; status: string }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<string[]>([]);
  const [renderKey, setRenderKey] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copyStatus, setCopyStatus] = useState('');
  const [showCopyBox, setShowCopyBox] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedLines, setSelectedLines] = useState<Set<number>>(() => new Set());
  const lineBuffer = useRef('');

  const appendOutput = useCallback((data: string) => {
    const clean = stripAnsi(data);
    lineBuffer.current += clean;
    const parts = lineBuffer.current.split('\n');
    lineBuffer.current = parts.pop() ?? '';
    outputRef.current.push(...parts);
    if (outputRef.current.length > 2000) {
      outputRef.current = outputRef.current.slice(-2000);
    }
    setRenderKey(k => k + 1);
  }, []);

  const handleScrollback = useCallback((lines: string[]) => {
    outputRef.current = lines.map(stripAnsi);
    setRenderKey(k => k + 1);
  }, []);

  const stream = useSessionStream({
    sessionId,
    channel,
    onOutput: appendOutput,
    onScrollback: handleScrollback,
    onGitStatus,
    onExit: ({ status }) => {
      outputRef.current.push(`\n[session ${status}]`);
      setRenderKey(k => k + 1);
      onExit?.(status);
    },
  });

  useEffect(() => {
    if (stream.connected || stream.status !== 'unknown') {
      onState?.({ connected: stream.connected, alive: stream.alive, status: stream.status });
    }
  }, [stream.connected, stream.alive, stream.status, onState]);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [renderKey, autoScroll]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  async function copyAll() {
    const ok = await copyText(outputRef.current.join('\n'));
    setCopyStatus(ok ? 'copied' : 'copy failed');
    if (!ok) setShowCopyBox(true);
    setTimeout(() => setCopyStatus(''), 1400);
  }

  async function copySelection() {
    const selectedText = selectedLines.size > 0
      ? outputRef.current.filter((_line, index) => selectedLines.has(index)).join('\n')
      : '';
    const browserSelection = window.getSelection()?.toString() || '';
    const textToCopy = selectedText || browserSelection;
    const ok = await copyText(textToCopy);
    setCopyStatus(ok ? 'selection copied' : (textToCopy ? 'copy failed' : 'select lines first'));
    if (!ok) setShowCopyBox(true);
    setTimeout(() => setCopyStatus(''), 1400);
  }

  function toggleSelectedLine(index: number) {
    setSelectedLines(current => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="terminal-outer">
      <div className="terminal-header">
        <span className="terminal-label">{label}</span>
        {!autoScroll && (
          <button className="btn-link btn-sm" onClick={() => {
            setAutoScroll(true);
            if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
          }}>↓ scroll to bottom</button>
        )}
        <span className={`terminal-status ${alive ? 'alive' : 'dead'}`}>{alive ? '● live' : '○ offline'}</span>
      </div>
      <div className="terminal-action-row">
        <button className="terminal-action-btn" onClick={copySelection}>Copy selected text</button>
        <button
          className={`terminal-action-btn ${selectionMode ? 'active' : ''}`}
          onClick={() => setSelectionMode(v => !v)}
        >
          {selectionMode ? 'Done selecting' : 'Select lines'}
        </button>
        {selectedLines.size > 0 && (
          <button className="terminal-action-btn" onClick={() => setSelectedLines(new Set())}>
            Clear {selectedLines.size}
          </button>
        )}
        <button className="terminal-action-btn" onClick={copyAll}>Copy all output</button>
        <button className="terminal-action-btn" onClick={() => setShowCopyBox(v => !v)}>
          {showCopyBox ? 'Hide copy box' : 'Show copy box'}
        </button>
        {copyStatus && <span className="copy-status">{copyStatus}</span>}
      </div>
      {showCopyBox && (
        <div className="terminal-copy-box-wrap">
          <textarea
            className="terminal-copy-box"
            readOnly
            value={outputRef.current.join('\n')}
            onFocus={e => e.currentTarget.select()}
          />
        </div>
      )}
      <div className="terminal" ref={containerRef} onScroll={handleScroll}>
        {outputRef.current.map((line, i) => (
          <div
            key={i}
            className={`terminal-line ${selectionMode ? 'selectable-line' : ''} ${selectedLines.has(i) ? 'selected' : ''}`}
            onClick={selectionMode ? () => toggleSelectedLine(i) : undefined}
          >
            {line || ' '}
          </div>
        ))}
        {outputRef.current.length === 0 && (
          <div className="terminal-empty">Waiting for output…</div>
        )}
      </div>
    </div>
  );
}
