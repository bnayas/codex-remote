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
  onConnected?: (alive: boolean, status: string) => void;
}

export interface StreamState {
  connected: boolean;
  alive: boolean;
  status: string;
}

const RECONNECT_MS = 2500;
const PING_MS = 15_000;

export function useSessionStream(opts: UseSessionStreamOptions): StreamState {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmounted = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [state, setState] = useState<StreamState>({
    connected: false,
    alive: false,
    status: 'unknown',
  });

  const connect = useCallback(() => {
    if (!optsRef.current.sessionId || unmounted.current) return;
    const url = buildWsUrl(optsRef.current.sessionId, optsRef.current.channel ?? 'agent');

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState(s => ({ ...s, connected: true }));
      pingTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_MS);
    };

    ws.onmessage = (ev: { data?: unknown }) => {
      try {
        if (typeof ev.data !== 'string') return;
        const msg = JSON.parse(ev.data) as WsMessage;
        switch (msg.type) {
          case 'connected':
            setState(s => ({ ...s, alive: msg.alive, status: msg.status }));
            optsRef.current.onConnected?.(msg.alive, msg.status);
            break;
          case 'scrollback':
            optsRef.current.onScrollback?.(msg.lines);
            break;
          case 'output':
            optsRef.current.onOutput?.(msg.data);
            setState(s => ({ ...s, alive: true, status: 'running' }));
            break;
          case 'exit':
            setState(s => ({ ...s, alive: false, status: msg.status }));
            optsRef.current.onExit?.({ exitCode: msg.exitCode, status: msg.status });
            break;
          case 'git_status':
            optsRef.current.onGitStatus?.(msg.changedFiles, msg.branch);
            break;
          case 'status':
            setState(s => ({ ...s, alive: msg.alive, status: msg.status }));
            break;
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      if (pingTimer.current) clearInterval(pingTimer.current);
      setState(s => ({ ...s, connected: false }));
      if (!unmounted.current) {
        reconnectTimer.current = setTimeout(connect, RECONNECT_MS);
      }
    };

    ws.onerror = () => ws.close();
  }, []); // stable - opts accessed via ref

  useEffect(() => {
    unmounted.current = false;
    if (opts.sessionId) connect();
    return () => {
      unmounted.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pingTimer.current) clearInterval(pingTimer.current);
      wsRef.current?.close();
    };
  }, [opts.sessionId, opts.channel, connect]);

  return state;
}
