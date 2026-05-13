import { FastifyInstance, FastifyRequest } from 'fastify';
import type { SocketStream } from '@fastify/websocket';
import { WebSocket } from 'ws';
import { getSessionById } from '../db';
import {
  getSessionEmitter, getRecentOutput, isSessionAlive,
  resizePty, writeToSession,
  getShellEmitter, getShellRecentOutput, isShellAlive,
  resizeShellPty, writeToShell, ensureShellSession
} from '../ptyManager';
import { getGitStatus } from '../git';
import { AgentParser } from '../agentParser';

const GIT_POLL_INTERVAL = 4000; // ms

export async function registerWsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/sessions/:sessionId/stream',
    { websocket: true },
    async (connection: SocketStream, req: FastifyRequest<{ Params: { sessionId: string }; Querystring: { token?: string } }>) => {
      const socket = connection.socket;
      const { sessionId } = req.params;
      const session = getSessionById(sessionId);

      if (!session) {
        socket.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
        socket.close();
        return;
      }

      ensureShellSession(sessionId);

      const send = (msg: object) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(msg));
        }
      };

      // Send connection ACK + session metadata
      send({
        type: 'connected',
        sessionId,
        status: session.status,
        alive: isSessionAlive(sessionId),
        timestamp: new Date().toISOString(),
      });

      // Send recent scrollback
      const scrollback = getRecentOutput(sessionId, 300);
      if (scrollback.length > 0) {
        send({ type: 'scrollback', lines: scrollback });
      }

      // Subscribe to live output if session is active
      const emitter = getSessionEmitter(sessionId);
      let onData: ((data: string) => void) | undefined;
      let onExit: ((info: { exitCode: number | null; status: string }) => void) | undefined;
      let parser: AgentParser | undefined;

      if (emitter) {
        parser = new AgentParser();
        parser.on('message', (msg) => {
          send({ ...msg, type: 'agent_json_chunk' });
        });

        onData = (data: string) => {
          parser!.push(data);
          // Still send raw output for the fallback raw terminal tab
          send({ type: 'output', data });
        };
        onExit = (info) => {
          parser?.flush();
          send({ type: 'exit', ...info, timestamp: new Date().toISOString() });
        };
        emitter.on('data', onData);
        emitter.on('exit', onExit);
      } else {
        // Session not alive - send final status
        send({ type: 'status', status: session.status, alive: false });
      }

      // Git polling
      let gitPollTimer: NodeJS.Timeout | undefined;
      let lastGitJson = '';

      const pollGit = async () => {
        try {
          const status = await getGitStatus(session.repoPath);
          const json = JSON.stringify(status);
          if (json !== lastGitJson) {
            lastGitJson = json;
            send({ type: 'git_status', ...status });
          }
        } catch (err) { 
          // Silently ignore git polling errors to avoid log spam,
          // but log if it's not a generic ENOENT.
        }
      };

      if (isSessionAlive(sessionId)) {
        void pollGit();
        gitPollTimer = setInterval(() => { void pollGit(); }, GIT_POLL_INTERVAL);
      }

      // Handle incoming messages from client
      socket.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString()) as { type: string; [k: string]: unknown };
          if (msg.type === 'input' && typeof msg.text === 'string') {
            writeToSession(sessionId, msg.text);
          } else if (msg.type === 'resize') {
            resizePty(sessionId, (msg.cols as number) || 120, (msg.rows as number) || 40);
          } else if (msg.type === 'ping') {
            send({ type: 'pong', timestamp: new Date().toISOString() });
          }
        } catch (err) {
          console.error(`[WS] Failed to handle incoming message for session ${sessionId}:`, err);
        }
      });

      // Cleanup on disconnect
      socket.on('close', () => {
        if (gitPollTimer) clearInterval(gitPollTimer);
        if (emitter && onData) emitter.off('data', onData);
        if (emitter && onExit) emitter.off('exit', onExit);
      });

      socket.on('error', () => {
        if (gitPollTimer) clearInterval(gitPollTimer);
        if (emitter && onData) emitter.off('data', onData);
        if (emitter && onExit) emitter.off('exit', onExit);
      });
    }
  );

  app.get(
    '/sessions/:sessionId/shell/stream',
    { websocket: true },
    async (connection: SocketStream, req: FastifyRequest<{ Params: { sessionId: string }; Querystring: { token?: string } }>) => {
      const socket = connection.socket;
      const { sessionId } = req.params;
      const session = getSessionById(sessionId);

      if (!session) {
        socket.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
        socket.close();
        return;
      }

      const send = (msg: object) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(msg));
        }
      };

      send({
        type: 'connected',
        sessionId,
        status: isShellAlive(sessionId) ? 'running' : 'exited',
        alive: isShellAlive(sessionId),
        timestamp: new Date().toISOString(),
      });

      const scrollback = getShellRecentOutput(sessionId, 300);
      if (scrollback.length > 0) {
        send({ type: 'scrollback', lines: scrollback });
      }

      const emitter = getShellEmitter(sessionId);
      let onData: ((data: string) => void) | undefined;
      let onExit: ((info: { exitCode: number | null; status: string }) => void) | undefined;

      if (emitter) {
        onData = (data: string) => {
          send({ type: 'output', data });
        };
        onExit = (info) => {
          send({ type: 'exit', ...info, timestamp: new Date().toISOString() });
        };
        emitter.on('data', onData);
        emitter.on('exit', onExit);
      } else {
        send({ type: 'status', status: 'exited', alive: false });
      }

      socket.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString()) as { type: string; [k: string]: unknown };
          if (msg.type === 'input' && typeof msg.text === 'string') {
            writeToShell(sessionId, msg.text);
          } else if (msg.type === 'resize') {
            resizeShellPty(sessionId, (msg.cols as number) || 120, (msg.rows as number) || 40);
          } else if (msg.type === 'ping') {
            send({ type: 'pong', timestamp: new Date().toISOString() });
          }
        } catch { /**/ }
      });

      const cleanup = () => {
        if (emitter && onData) emitter.off('data', onData);
        if (emitter && onExit) emitter.off('exit', onExit);
      };

      socket.on('close', cleanup);
      socket.on('error', cleanup);
    }
  );
}
