import { useEffect, useRef, useCallback, useState } from 'react';
import { WsMessage, ChangedFile } from '../types';
import { buildWsUrl } from '../api';

interface UseSessionStreamOptions {
  sessionId: string | null;
  channel?: 'agent' | 'shell';
  terminalId?: string;
  onOutput?: (data: string) => void;
  onScrollback?: (lines: string[]) => void;
  onExit?: (info: { exitCode: number | null; status: string }) => void;
  onGitStatus?: (files: ChangedFile[], branch: string) => void;
  onJsonEvent?: (msg: any) => void;
}

interface StreamState {
  connected: boolean;
  alive: boolean;
  status: string;
  lastPing: number;
  error?: string;
}

const MAX_RECONNECT_DELAY_MS = 30000;
const INITIAL_RECONNECT_DELAY_MS = 2000;
const PING_INTERVAL_MS = 15000;
const MAX_RECONNECT_ATTEMPTS = 50;

export function useSessionStream(opts: UseSessionStreamOptions): StreamState {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmounted = useRef(false);
  const generation = useRef(0);
  const reconnectAttempts = useRef(0);
  const reconnectDelay = useRef(INITIAL_RECONNECT_DELAY_MS);

  // Use refs for callbacks to avoid stale closure bugs
  const onOutputRef = useRef(opts.onOutput);
  const onScrollbackRef = useRef(opts.onScrollback);
  const onExitRef = useRef(opts.onExit);
  const onGitStatusRef = useRef(opts.onGitStatus);
  const onJsonEventRef = useRef(opts.onJsonEvent);

  // Keep refs in sync with latest props
  useEffect(() => { onOutputRef.current = opts.onOutput; }, [opts.onOutput]);
  useEffect(() => { onScrollbackRef.current = opts.onScrollback; }, [opts.onScrollback]);
  useEffect(() => { onExitRef.current = opts.onExit; }, [opts.onExit]);
  useEffect(() => { onGitStatusRef.current = opts.onGitStatus; }, [opts.onGitStatus]);
  useEffect(() => { onJsonEventRef.current = opts.onJsonEvent; }, [opts.onJsonEvent]);

  const [state, setState] = useState<StreamState>({
    connected: false,
    alive: false,
    status: 'unknown',
    lastPing: 0,
    error: undefined,
  });

  const cleanup = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (pingTimer.current) {
      clearInterval(pingTimer.current);
      pingTimer.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback((connectGeneration = generation.current) => {
    if (!opts.sessionId || unmounted.current || connectGeneration !== generation.current) return;

    // Prevent duplicate connections
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('[WS] Max reconnect attempts reached');
      setState(s => ({ ...s, connected: false, error: 'Connection lost (max retries reached)' }));
      return;
    }

    const url = buildWsUrl(opts.sessionId, opts.channel ?? 'agent', opts.terminalId);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.error('[WS] Failed to create WebSocket:', err);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (connectGeneration !== generation.current) {
        ws.close();
        return;
      }
      reconnectAttempts.current = 0;
      reconnectDelay.current = INITIAL_RECONNECT_DELAY_MS;
      setState(s => ({ ...s, connected: true, error: undefined }));

      // Ping keepalive
      if (pingTimer.current) clearInterval(pingTimer.current);
      pingTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (ev) => {
      if (connectGeneration !== generation.current) return;
      try {
        const msg = JSON.parse(ev.data as string) as WsMessage;
        if (msg.type === 'connected') {
          setState(s => ({ ...s, alive: msg.alive, status: msg.status }));
        } else if (msg.type === 'scrollback') {
          onScrollbackRef.current?.(msg.lines);
        } else if (msg.type === 'output') {
          onOutputRef.current?.(msg.data);
          setState(s => ({ ...s, alive: true, status: 'running' }));
        } else if (msg.type === 'agent_json_chunk') {
          onJsonEventRef.current?.(msg);
          setState(s => ({ ...s, alive: true, status: 'running' }));
        } else if (msg.type === 'exit') {
          setState(s => ({ ...s, alive: false, status: msg.status }));
          onExitRef.current?.({ exitCode: msg.exitCode, status: msg.status });
        } else if (msg.type === 'git_status') {
          onGitStatusRef.current?.(msg.changedFiles, msg.branch);
        } else if (msg.type === 'status') {
          setState(s => ({ ...s, alive: msg.alive, status: msg.status }));
        } else if (msg.type === 'pong') {
          setState(s => ({ ...s, lastPing: Date.now() }));
        }
      } catch (err) {
        console.error('[WS] Failed to parse message:', err);
      }
    };

    ws.onclose = () => {
      if (connectGeneration !== generation.current) return;
      if (pingTimer.current) {
        clearInterval(pingTimer.current);
        pingTimer.current = null;
      }
      wsRef.current = null;
      setState(s => ({ ...s, connected: false, error: 'Reconnecting...' }));

      if (!unmounted.current) {
        reconnectAttempts.current++;
        // Exponential backoff: 2s → 4s → 8s → ... → 30s max
        const delay = reconnectDelay.current;
        reconnectDelay.current = Math.min(delay * 1.5, MAX_RECONNECT_DELAY_MS);

        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(() => connect(connectGeneration), delay);
      }
    };

    ws.onerror = (err) => {
      if (connectGeneration !== generation.current) return;
      console.error('[WS] WebSocket error:', err);
      setState(s => ({ ...s, error: 'WebSocket Error' }));
      ws.close();
    };
  }, [opts.sessionId, opts.channel, opts.terminalId]);

  useEffect(() => {
    const effectGeneration = generation.current + 1;
    generation.current = effectGeneration;
    unmounted.current = false;
    reconnectAttempts.current = 0;
    reconnectDelay.current = INITIAL_RECONNECT_DELAY_MS;
    connect(effectGeneration);
    return () => {
      if (generation.current === effectGeneration) generation.current++;
      unmounted.current = true;
      cleanup();
    };
  }, [connect, cleanup]);

  return state;
}
