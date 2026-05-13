import * as pty from 'node-pty';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import treeKill from 'tree-kill';
import { v4 as uuidv4 } from 'uuid';
import {
  createSession, updateSessionStatus, touchSessionOutput,
  getSessionById, ensureSessionDir, Session
} from './db';
import { ProjectConfig } from './config';

export interface TerminalSession extends EventEmitter {
  id: string;
  write(input: string): void;
  interrupt(): void;
  terminate(): void;
  killTree(): void;
  getStatus(): Session['status'];
  getPid(): number | undefined;
}

type PtyChannel = 'agent' | 'shell';

interface LivePty {
  emitter: EventEmitter;
  ptyProcess: pty.IPty;
  logStream: fs.WriteStream;
  id: string;
  channel: PtyChannel;
  status: Session['status'];
  recentLines: string[];
}

const MAX_RECENT = 500;

// Agent PTYs run Codex. Shell PTYs back the user-facing Terminal tab.
const liveAgentSessions = new Map<string, LivePty>();
const liveShellSessions = new Map<string, LivePty>();

function registry(channel: PtyChannel): Map<string, LivePty> {
  return channel === 'agent' ? liveAgentSessions : liveShellSessions;
}

function shellCommand(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: process.env.COMSPEC || 'powershell.exe', args: [] };
  }
  return { command: process.env.SHELL || '/bin/zsh', args: [] };
}

function logPathFor(session: Session, channel: PtyChannel): string {
  if (channel === 'agent') return session.scrollbackPath;
  return path.join(path.dirname(session.scrollbackPath), 'shell.log');
}

function appendRecent(live: LivePty, bufferRef: { current: string }, data: string): void {
  bufferRef.current += data;
  const parts = bufferRef.current.split('\n');
  bufferRef.current = parts.pop() ?? '';
  for (const line of parts) {
    live.recentLines.push(line);
    if (live.recentLines.length > MAX_RECENT) live.recentLines.shift();
  }
}

function finalizeLivePty(live: LivePty, exitCode: number | null, status?: Session['status']): void {
  if (registry(live.channel).get(live.id) !== live) return;

  live.status = status ?? (exitCode === 0 ? 'exited' : (exitCode === null ? 'killed' : 'exited'));
  try { live.logStream.end(); } catch { /**/ }
  registry(live.channel).delete(live.id);

  if (live.channel === 'agent') {
    updateSessionStatus(live.id, live.status, {
      exitCode: exitCode ?? undefined,
      endedAt: new Date().toISOString(),
    });
  }

  live.emitter.emit('exit', { exitCode, status: live.status });
  console.log(`${live.channel} PTY ${live.id} exited with code ${exitCode}`);
}

function spawnLivePty(opts: {
  sessionId: string;
  channel: PtyChannel;
  command: string;
  args: string[];
  cwd: string;
  logPath: string;
  eventsPath: string;
}): LivePty {
  const ptyProcess = pty.spawn(opts.command, opts.args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd: opts.cwd,
    env: process.env as Record<string, string>,
  });

  const logStream = fs.createWriteStream(opts.logPath, { flags: 'a' });
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  const live: LivePty = {
    emitter,
    ptyProcess,
    logStream,
    id: opts.sessionId,
    channel: opts.channel,
    status: 'running',
    recentLines: [],
  };
  registry(opts.channel).set(opts.sessionId, live);

  const lineBuffer = { current: '' };

  // Throttle touchSessionOutput to at most once per 2 seconds
  let touchTimer: ReturnType<typeof setTimeout> | null = null;
  let touchPending = false;

  ptyProcess.onData((data: string) => {
    logStream.write(data);
    appendRecent(live, lineBuffer, data);
    emitter.emit('data', data);

    if (opts.channel === 'agent') {
      if (!touchTimer) {
        touchSessionOutput(opts.sessionId);
        touchTimer = setTimeout(() => {
          touchTimer = null;
          if (touchPending) {
            touchPending = false;
            touchSessionOutput(opts.sessionId);
          }
        }, 2000);
      } else {
        touchPending = true;
      }
    }

    const event = {
      t: new Date().toISOString(),
      k: opts.channel === 'agent' ? 'output' : 'shell_output',
      d: data,
    };
    fs.appendFile(opts.eventsPath, JSON.stringify(event) + '\n', () => {});
  });

  ptyProcess.onExit(({ exitCode }) => {
    finalizeLivePty(live, exitCode);
  });

  return live;
}

export function getActivePids(): Map<string, number> {
  const result = new Map<string, number>();
  for (const [id, s] of liveAgentSessions) {
    try { result.set(id, s.ptyProcess.pid); } catch { /**/ }
  }
  return result;
}

export function isSessionAlive(sessionId: string): boolean {
  return liveAgentSessions.has(sessionId);
}

export function isShellAlive(sessionId: string): boolean {
  return liveShellSessions.has(sessionId);
}

export function getSessionEmitter(sessionId: string): EventEmitter | undefined {
  return liveAgentSessions.get(sessionId)?.emitter;
}

export function getShellEmitter(sessionId: string): EventEmitter | undefined {
  return liveShellSessions.get(sessionId)?.emitter;
}

export function ensureShellSession(sessionId: string): boolean {
  if (liveShellSessions.has(sessionId)) return true;

  const session = getSessionById(sessionId);
  if (!session) return false;

  const shell = shellCommand();
  try {
    spawnLivePty({
      sessionId,
      channel: 'shell',
      command: shell.command,
      args: shell.args,
      cwd: session.repoPath,
      logPath: logPathFor(session, 'shell'),
      eventsPath: path.join(path.dirname(session.scrollbackPath), 'events.jsonl'),
    });
    return true;
  } catch (err) {
    console.warn(`Failed to start shell PTY for session ${sessionId}:`, (err as Error).message);
    return false;
  }
}

export function getRecentOutput(sessionId: string, lines = 200): string[] {
  return getRecentOutputForChannel(sessionId, 'agent', lines);
}

export function getShellRecentOutput(sessionId: string, lines = 200): string[] {
  return getRecentOutputForChannel(sessionId, 'shell', lines);
}

function getRecentOutputForChannel(sessionId: string, channel: PtyChannel, lines: number): string[] {
  const live = registry(channel).get(sessionId);
  if (live) {
    return live.recentLines.slice(-lines);
  }

  const session = getSessionById(sessionId);
  if (!session) return [];
  try {
    const raw = fs.readFileSync(logPathFor(session, channel), 'utf-8');
    return raw.split('\n').slice(-lines);
  } catch {
    return [];
  }
}

export async function startSession(
  project: ProjectConfig,
  opts: { title?: string; initialPrompt?: string } = {}
): Promise<string> {
  const sessionId = uuidv4();
  const dir = ensureSessionDir(sessionId);
  const scrollbackPath = path.join(dir, 'terminal.log');
  const shellScrollbackPath = path.join(dir, 'shell.log');
  const eventsPath = path.join(dir, 'events.jsonl');

  const command = project.defaultCodexCommand || 'codex';
  const args: string[] = [];

  createSession({
    id: sessionId,
    projectId: project.id,
    repoPath: project.repoPath,
    command,
    argsJson: JSON.stringify(args),
    status: 'starting',
    title: opts.title,
    scrollbackPath,
  });

  let agent: LivePty;
  try {
    agent = spawnLivePty({
      sessionId,
      channel: 'agent',
      command,
      args,
      cwd: project.repoPath,
      logPath: scrollbackPath,
      eventsPath,
    });
  } catch (err) {
    updateSessionStatus(sessionId, 'error');
    throw err;
  }

  updateSessionStatus(sessionId, 'running');

  const shell = shellCommand();
  try {
    spawnLivePty({
      sessionId,
      channel: 'shell',
      command: shell.command,
      args: shell.args,
      cwd: project.repoPath,
      logPath: shellScrollbackPath,
      eventsPath,
    });
  } catch (err) {
    console.warn(`Failed to start shell PTY for session ${sessionId}:`, (err as Error).message);
  }

  if (opts.initialPrompt) {
    setTimeout(() => {
      try {
        agent.ptyProcess.write(opts.initialPrompt + '\r');
      } catch { /**/ }
    }, 1500);
  }

  console.log(`✓ Started session ${sessionId} for project ${project.id} (agent PID: ${agent.ptyProcess.pid})`);
  return sessionId;
}

export function writeToSession(sessionId: string, text: string): boolean {
  return writeToChannel(sessionId, 'agent', text);
}

export function writeToShell(sessionId: string, text: string): boolean {
  return writeToChannel(sessionId, 'shell', text);
}

function writeToChannel(sessionId: string, channel: PtyChannel, text: string): boolean {
  const live = registry(channel).get(sessionId);
  if (!live) return false;
  live.ptyProcess.write(text.endsWith('\r') ? text : text + '\r');
  return true;
}

export function interruptSession(sessionId: string): boolean {
  return interruptChannel(sessionId, 'agent');
}

export function interruptShell(sessionId: string): boolean {
  return interruptChannel(sessionId, 'shell');
}

function interruptChannel(sessionId: string, channel: PtyChannel): boolean {
  const live = registry(channel).get(sessionId);
  if (!live) return false;
  live.ptyProcess.write('\x03');
  return true;
}

export function terminateSession(sessionId: string): boolean {
  return terminateChannel(sessionId, 'agent');
}

export function terminateShell(sessionId: string): boolean {
  return terminateChannel(sessionId, 'shell');
}

function terminateChannel(sessionId: string, channel: PtyChannel): boolean {
  const live = registry(channel).get(sessionId);
  if (!live) return false;
  live.status = 'killed';
  try {
    live.ptyProcess.kill('SIGTERM');
  } catch { /**/ }
  setTimeout(() => {
    if (registry(channel).get(sessionId) === live) {
      const pid = live.ptyProcess.pid;
      if (pid) {
        treeKill(pid, 'SIGKILL', () => finalizeLivePty(live, null, 'killed'));
      } else {
        finalizeLivePty(live, null, 'killed');
      }
    }
  }, 2500);
  return true;
}

export function killSessionTree(sessionId: string): Promise<boolean> {
  return killChannelTree(sessionId, 'agent');
}

export function killShellTree(sessionId: string): Promise<boolean> {
  return killChannelTree(sessionId, 'shell');
}

function killChannelTree(sessionId: string, channel: PtyChannel): Promise<boolean> {
  return new Promise((resolve) => {
    const live = registry(channel).get(sessionId);
    if (!live) { resolve(false); return; }
    live.status = 'killed';
    const pid = live.ptyProcess.pid;
    if (!pid) { resolve(false); return; }
    treeKill(pid, 'SIGKILL', (err) => {
      if (err) console.error(`tree-kill error for ${channel} ${sessionId}:`, err);
      if (!err) {
        setTimeout(() => finalizeLivePty(live, null, 'killed'), 250);
      }
      resolve(!err);
    });
  });
}

export function resizePty(sessionId: string, cols: number, rows: number): void {
  resizeChannelPty(sessionId, 'agent', cols, rows);
}

export function resizeShellPty(sessionId: string, cols: number, rows: number): void {
  resizeChannelPty(sessionId, 'shell', cols, rows);
}

function resizeChannelPty(sessionId: string, channel: PtyChannel, cols: number, rows: number): void {
  const live = registry(channel).get(sessionId);
  if (live) {
    try { live.ptyProcess.resize(cols, rows); } catch { /**/ }
  }
}
