import { useEffect, useRef, useCallback, useState } from 'react';
import { WsMessage, ChangedFile } from './types';
import { buildWsUrl } from './api';

interface UseSessionStreamOptions {
  sessionId: string | null;
  channel?: 'agent' | 'shell';
  onOutput?: (data: string) => void;
  onScrollback?: (lines: string[]) => void;
  onExit?: (info: { exitCode: number | null; status: string }) => void;
  onGitStatus?: (files: ChangedFile[], branch: string) => void;
}

interface StreamState {
  connected: boolean;
  alive: boolean;
  status: string;
  lastPing: number;
}

const RECONNECT_DELAY_MS = 2000;
const PING_INTERVAL_MS = 15000;

export function useSessionStream(opts: UseSessionStreamOptions): StreamState {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmounted = useRef(false);

  const [state, setState] = useState<StreamState>({
    connected: false,
    alive: false,
    status: 'unknown',
    lastPing: 0,
  });

  const connect = useCallback(() => {
    if (!opts.sessionId || unmounted.current) return;
    const url = buildWsUrl(opts.sessionId, opts.channel ?? 'agent');

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState(s => ({ ...s, connected: true }));
      // Ping keepalive
      pingTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as WsMessage;
        if (msg.type === 'connected') {
          setState(s => ({ ...s, alive: msg.alive, status: msg.status }));
        } else if (msg.type === 'scrollback') {
          opts.onScrollback?.(msg.lines);
        } else if (msg.type === 'output') {
          opts.onOutput?.(msg.data);
          setState(s => ({ ...s, alive: true, status: 'running' }));
        } else if (msg.type === 'exit') {
          setState(s => ({ ...s, alive: false, status: msg.status }));
          opts.onExit?.({ exitCode: msg.exitCode, status: msg.status });
        } else if (msg.type === 'git_status') {
          opts.onGitStatus?.(msg.changedFiles, msg.branch);
        } else if (msg.type === 'status') {
          setState(s => ({ ...s, alive: msg.alive, status: msg.status }));
        } else if (msg.type === 'pong') {
          setState(s => ({ ...s, lastPing: Date.now() }));
        }
      } catch { /**/ }
    };

    ws.onclose = () => {
      if (pingTimer.current) clearInterval(pingTimer.current);
      setState(s => ({ ...s, connected: false }));
      if (!unmounted.current) {
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [opts.sessionId, opts.channel]);

  useEffect(() => {
    unmounted.current = false;
    connect();
    return () => {
      unmounted.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pingTimer.current) clearInterval(pingTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return state;
}

export function sendWsInput(sessionId: string, text: string): void {
  // Input is sent via REST API for reliability
  void sessionId; void text;
}
