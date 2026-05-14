import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ChangedFile } from '../types';
import { useSessionStream } from '../hooks/useSessionStream';
import { copyText } from '../utils';

const MAX_LINES = 2000;
const ESC = '\x1b';
const BEL = '\x07';

function trimTerminalLine(line: string): string {
  return line.replace(/[ \t]+$/g, '');
}

function parseCsiParam(sequence: string, fallback = 1): number {
  const body = sequence.slice(2, -1).replace(/^\?/, '');
  const first = body.split(';')[0];
  const parsed = Number.parseInt(first, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function looksLikeShellPrompt(line: string): boolean {
  return /^[^@\s]+@[^ ]+ .+ [#$%>]$/.test(line) || /^[#$%>]$/.test(line);
}

function commonPromptCommand(line: string): { prompt: string; command: string } | null {
  const match = /^([^@\s]+@[^ ]+ .+ [#$%>] )(.+)$/.exec(line);
  if (!match) return null;
  return { prompt: trimTerminalLine(match[1]), command: match[2].trim() };
}

export function Terminal({
  sessionId,
  channel = 'agent',
  terminalId,
  label,
  alive,
  onSubmitInput,
  onGitStatus,
  onExit,
  onState,
}: {
  sessionId: string;
  channel?: 'agent' | 'shell';
  terminalId?: string;
  label: string;
  alive: boolean;
  onSubmitInput?: (text: string) => Promise<unknown>;
  onGitStatus?: (files: ChangedFile[], branch: string) => void;
  onExit?: (status: string) => void;
  onState?: (state: { connected: boolean; alive: boolean; status: string }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inlineInputRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<string[]>([]);
  const [renderKey, setRenderKey] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copyStatus, setCopyStatus] = useState('');
  const [showCopyBox, setShowCopyBox] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedLines, setSelectedLines] = useState<Set<number>>(() => new Set());
  const [pendingLine, setPendingLine] = useState('');
  const [inputDraft, setInputDraft] = useState('');
  const [sendingInput, setSendingInput] = useState(false);
  const currentLine = useRef('');
  const cursor = useRef(0);
  const shellPrompt = useRef('');
  const skippedShellCommand = useRef('');

  const rememberShellPrompt = useCallback((line: string) => {
    if (channel === 'shell' && looksLikeShellPrompt(line)) {
      shellPrompt.current = line;
    }
  }, [channel]);

  const splitShellCommandLine = useCallback((line: string): { prompt: string; command: string } | null => {
    if (channel !== 'shell') return null;
    const knownPrompt = shellPrompt.current;
    if (knownPrompt && line.startsWith(`${knownPrompt} `)) {
      return { prompt: knownPrompt, command: line.slice(knownPrompt.length + 1).trim() };
    }
    if (knownPrompt && line.startsWith(knownPrompt)) {
      const command = line.slice(knownPrompt.length).trim();
      if (command) return { prompt: knownPrompt, command };
    }
    return commonPromptCommand(line);
  }, [channel]);

  const formatCommittedLine = useCallback((line: string): string | null => {
    if (channel !== 'shell') return line;

    const promptCommand = splitShellCommandLine(line);
    if (promptCommand?.command) {
      shellPrompt.current = promptCommand.prompt;
      skippedShellCommand.current = promptCommand.command;
      return `${promptCommand.prompt} ${promptCommand.command}`;
    }

    if (skippedShellCommand.current && line === skippedShellCommand.current) {
      skippedShellCommand.current = '';
      return null;
    }

    skippedShellCommand.current = '';
    rememberShellPrompt(line);
    return line;
  }, [channel, rememberShellPrompt, splitShellCommandLine]);

  const formatPendingLine = useCallback((line: string): string => {
    const promptCommand = splitShellCommandLine(line);
    if (promptCommand?.command) {
      return `${promptCommand.prompt} ${promptCommand.command}`;
    }
    rememberShellPrompt(line);
    return line;
  }, [rememberShellPrompt, splitShellCommandLine]);

  const writeChar = useCallback((ch: string) => {
    const line = currentLine.current;
    const index = cursor.current;
    if (index >= line.length) {
      currentLine.current = line + ' '.repeat(index - line.length) + ch;
    } else {
      currentLine.current = line.slice(0, index) + ch + line.slice(index + 1);
    }
    cursor.current = index + 1;
  }, []);

  const commitLine = useCallback(() => {
    const line = formatCommittedLine(trimTerminalLine(currentLine.current));
    if (line !== null) outputRef.current.push(line);
    if (outputRef.current.length > MAX_LINES) {
      outputRef.current = outputRef.current.slice(-MAX_LINES);
    }
    currentLine.current = '';
    cursor.current = 0;
  }, [formatCommittedLine]);

  const eraseLine = useCallback((mode: number) => {
    if (mode === 2) {
      currentLine.current = '';
      cursor.current = 0;
    } else if (mode === 1) {
      currentLine.current = ' '.repeat(cursor.current) + currentLine.current.slice(cursor.current);
    } else {
      currentLine.current = currentLine.current.slice(0, cursor.current);
    }
  }, []);

  const processTerminalData = useCallback((data: string, reset = false) => {
    if (reset) {
      outputRef.current = [];
      currentLine.current = '';
      cursor.current = 0;
      shellPrompt.current = '';
      skippedShellCommand.current = '';
    }

    for (let i = 0; i < data.length; i++) {
      const ch = data[i];

      if (ch === ESC) {
        const next = data[i + 1];
        if (next === ']') {
          const bellEnd = data.indexOf(BEL, i + 2);
          const stEnd = data.indexOf(`${ESC}\\`, i + 2);
          const end = bellEnd === -1 && stEnd === -1
            ? data.length
            : bellEnd === -1
            ? stEnd + 1
            : stEnd === -1
            ? bellEnd
            : Math.min(bellEnd, stEnd + 1);
          i = end;
          continue;
        }

        if (next === '[') {
          let end = i + 2;
          while (end < data.length && !/[@-~]/.test(data[end])) end++;
          if (end >= data.length) break;
          const sequence = data.slice(i, end + 1);
          const final = data[end];
          const n = parseCsiParam(sequence, final === 'K' || final === 'J' ? 0 : 1);
          if (final === 'K' || final === 'J') eraseLine(n === 1 || n === 2 ? n : 0);
          else if (final === 'D') cursor.current = Math.max(0, cursor.current - n);
          else if (final === 'C') cursor.current += n;
          else if (final === 'G') cursor.current = Math.max(0, n - 1);
          i = end;
          continue;
        }

        i += 1;
        continue;
      }

      if (ch === '\r') {
        cursor.current = 0;
      } else if (ch === '\n') {
        commitLine();
      } else if (ch === '\b') {
        cursor.current = Math.max(0, cursor.current - 1);
      } else if (ch === '\t') {
        const spaces = 8 - (cursor.current % 8);
        for (let n = 0; n < spaces; n++) writeChar(' ');
      } else if (ch >= ' ') {
        writeChar(ch);
      }
    }

    setPendingLine(formatPendingLine(trimTerminalLine(currentLine.current)));
    setRenderKey(k => k + 1);
  }, [commitLine, eraseLine, formatPendingLine, writeChar]);

  const appendOutput = useCallback((data: string) => {
    processTerminalData(data);
  }, [processTerminalData]);

  const handleScrollback = useCallback((lines: string[]) => {
    processTerminalData(lines.join('\n'), true);
    setSelectedLines(new Set());
  }, [processTerminalData]);

  const stream = useSessionStream({
    sessionId,
    channel,
    terminalId,
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
  }, [renderKey, autoScroll, inputDraft]);

  useEffect(() => {
    if (onSubmitInput && alive) {
      inlineInputRef.current?.focus();
    }
  }, [onSubmitInput, alive, terminalId]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  async function copyAll() {
    const lines = currentDisplayLines;
    const ok = await copyText(lines.join('\n'));
    setCopyStatus(ok ? 'copied' : 'copy failed');
    if (!ok) setShowCopyBox(true);
    setTimeout(() => setCopyStatus(''), 1400);
  }

  async function copySelection() {
    const lines = currentDisplayLines;
    const selectedText = selectedLines.size > 0
      ? lines.filter((_line, index) => selectedLines.has(index)).join('\n')
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

  async function submitInlineInput() {
    if (!onSubmitInput || sendingInput || !alive) return;
    const text = inputDraft;
    setSendingInput(true);
    setInputDraft('');
    if (inlineInputRef.current) inlineInputRef.current.textContent = '';
    try {
      await onSubmitInput(text);
    } catch (err) {
      outputRef.current.push(`[input failed: ${(err as Error).message || 'unknown error'}]`);
      setRenderKey(k => k + 1);
    } finally {
      setSendingInput(false);
      inlineInputRef.current?.focus();
    }
  }

  function handleInlineKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitInlineInput();
    } else if (e.key === 'Escape') {
      setInputDraft('');
      if (inlineInputRef.current) inlineInputRef.current.textContent = '';
    }
  }

  function formatInlineInputLine(prompt: string, draft: string): string {
    if (!draft) return prompt;
    return prompt && !/\s$/.test(prompt) ? `${prompt} ${draft}` : `${prompt}${draft}`;
  }

  const hasInlineInput = Boolean(onSubmitInput);
  const inlinePrompt = pendingLine ? `${pendingLine}${/\s$/.test(pendingLine) ? '' : ' '}` : '';
  const inlineInputLine = hasInlineInput ? formatInlineInputLine(pendingLine, inputDraft) : pendingLine;
  const currentDisplayLines = inlineInputLine ? [...outputRef.current, inlineInputLine] : outputRef.current;
  const displayLines = hasInlineInput ? outputRef.current : currentDisplayLines;

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
            value={currentDisplayLines.join('\n')}
            onFocus={e => e.currentTarget.select()}
          />
        </div>
      )}
      <div className="terminal" ref={containerRef} onScroll={handleScroll}>
        {displayLines.map((line, i) => (
          <div
            key={i}
            className={`terminal-line ${selectionMode ? 'selectable-line' : ''} ${selectedLines.has(i) ? 'selected' : ''}`}
            onClick={selectionMode ? () => toggleSelectedLine(i) : undefined}
          >
            {line || ' '}
          </div>
        ))}
        {hasInlineInput && (
          <div className="terminal-input-line" onClick={() => inlineInputRef.current?.focus()}>
            <span className="terminal-input-prompt">{inlinePrompt}</span>
            <div
              ref={inlineInputRef}
              className="terminal-inline-input"
              role="textbox"
              tabIndex={0}
              contentEditable={alive && !sendingInput}
              suppressContentEditableWarning
              onInput={e => setInputDraft(e.currentTarget.textContent || '')}
              onKeyDown={handleInlineKeyDown}
              aria-label="Shell command"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
        )}
        {currentDisplayLines.length === 0 && !hasInlineInput && (
          <div className="terminal-empty">Waiting for output…</div>
        )}
      </div>
    </div>
  );
}
