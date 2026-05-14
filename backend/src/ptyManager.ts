import * as pty from 'node-pty';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import treeKill from 'tree-kill';
import { v4 as uuidv4 } from 'uuid';
import {
  createSession, updateSessionStatus, touchSessionOutput,
  getSessionById, ensureSessionDir, Session,
  createShellTerminal, getShellTerminalById, getShellTerminalsBySession,
  updateShellTerminalStatus, touchShellTerminalOutput, ShellTerminal
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
  sessionId: string;
  channel: PtyChannel;
  status: Session['status'];
  recentLines: string[];
  pendingLine: string;
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

function appendRecent(live: LivePty, bufferRef: { current: string }, data: string): void {
  bufferRef.current += data;
  const parts = bufferRef.current.split('\n');
  bufferRef.current = parts.pop() ?? '';
  live.pendingLine = bufferRef.current;
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
  } else {
    updateShellTerminalStatus(live.id, live.status, {
      exitCode: exitCode ?? undefined,
      endedAt: new Date().toISOString(),
    });
  }

  live.emitter.emit('exit', { exitCode, status: live.status });
  console.log(`${live.channel} PTY ${live.id} exited with code ${exitCode}`);
}

function spawnLivePty(opts: {
  id: string;
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
    id: opts.id,
    sessionId: opts.sessionId,
    channel: opts.channel,
    status: 'running',
    recentLines: [],
    pendingLine: '',
  };
  registry(opts.channel).set(opts.id, live);

  const lineBuffer = { current: '' };

  // Throttle touchSessionOutput to at most once per 2 seconds
  let touchTimer: ReturnType<typeof setTimeout> | null = null;
  let touchPending = false;

  ptyProcess.onData((data: string) => {
    logStream.write(data);
    appendRecent(live, lineBuffer, data);
    emitter.emit('data', data);

    if (!touchTimer) {
      if (opts.channel === 'agent') touchSessionOutput(opts.sessionId);
      else touchShellTerminalOutput(opts.id);
      touchTimer = setTimeout(() => {
        touchTimer = null;
        if (touchPending) {
          touchPending = false;
          if (opts.channel === 'agent') touchSessionOutput(opts.sessionId);
          else touchShellTerminalOutput(opts.id);
        }
      }, 2000);
    } else {
      touchPending = true;
    }

    const event = {
      t: new Date().toISOString(),
      k: opts.channel === 'agent' ? 'output' : 'shell_output',
      terminalId: opts.channel === 'shell' ? opts.id : undefined,
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
  return getShellTerminalsBySession(sessionId).some(t => liveShellSessions.has(t.id));
}

export function isShellTerminalAlive(terminalId: string): boolean {
  return liveShellSessions.has(terminalId);
}

export function getSessionEmitter(sessionId: string): EventEmitter | undefined {
  return liveAgentSessions.get(sessionId)?.emitter;
}

export function getShellEmitter(sessionId: string): EventEmitter | undefined {
  const terminal = getDefaultShellTerminal(sessionId);
  return terminal ? liveShellSessions.get(terminal.id)?.emitter : undefined;
}

export function getShellTerminalEmitter(terminalId: string): EventEmitter | undefined {
  return liveShellSessions.get(terminalId)?.emitter;
}

function shellLogPath(session: Session, terminalId: string, legacy = false): string {
  const sessionDir = path.dirname(session.scrollbackPath);
  if (legacy) return path.join(sessionDir, 'shell.log');
  const shellsDir = path.join(sessionDir, 'shells');
  fs.mkdirSync(shellsDir, { recursive: true });
  return path.join(shellsDir, `${terminalId}.log`);
}

export function getDefaultShellTerminal(sessionId: string): ShellTerminal | undefined {
  const existing = getShellTerminalsBySession(sessionId)[0];
  if (existing) return existing;

  const session = getSessionById(sessionId);
  if (!session) return undefined;

  const terminalId = uuidv4();
  return createShellTerminal({
    id: terminalId,
    sessionId,
    title: 'Terminal 1',
    status: 'starting',
    scrollbackPath: shellLogPath(session, terminalId, true),
  });
}

export function listShellTerminals(sessionId: string): ShellTerminal[] {
  getDefaultShellTerminal(sessionId);
  return getShellTerminalsBySession(sessionId).map(t => ({
    ...t,
    status: liveShellSessions.has(t.id) ? 'running' : t.status,
  }));
}

export function ensureShellSession(sessionId: string): boolean {
  const terminal = getDefaultShellTerminal(sessionId);
  if (!terminal) return false;
  return ensureShellTerminal(terminal.id);
}

export function ensureShellTerminal(terminalId: string): boolean {
  if (liveShellSessions.has(terminalId)) return true;
  const terminal = getShellTerminalById(terminalId);
  if (!terminal) return false;
  if (terminal.status === 'exited' || terminal.status === 'killed' || terminal.status === 'error') {
    return false;
  }
  const session = getSessionById(terminal.sessionId);
  if (!session) return false;

  const shell = shellCommand();
  try {
    spawnLivePty({
      id: terminal.id,
      sessionId: terminal.sessionId,
      channel: 'shell',
      command: shell.command,
      args: shell.args,
      cwd: session.repoPath,
      logPath: terminal.scrollbackPath,
      eventsPath: path.join(path.dirname(session.scrollbackPath), 'events.jsonl'),
    });
    updateShellTerminalStatus(terminal.id, 'running');
    return true;
  } catch (err) {
    updateShellTerminalStatus(terminal.id, 'error');
    console.warn(`Failed to start shell terminal ${terminal.id}:`, (err as Error).message);
    return false;
  }
}

export function createShellTerminalForSession(sessionId: string, title?: string): ShellTerminal | undefined {
  const session = getSessionById(sessionId);
  if (!session) return undefined;

  const count = getShellTerminalsBySession(sessionId).length;
  const terminalId = uuidv4();
  const terminal = createShellTerminal({
    id: terminalId,
    sessionId,
    title: title?.trim() || `Terminal ${count + 1}`,
    status: 'starting',
    scrollbackPath: shellLogPath(session, terminalId),
  });
  ensureShellTerminal(terminal.id);
  return getShellTerminalById(terminal.id) ?? terminal;
}

export function getRecentOutput(sessionId: string, lines = 200): string[] {
  const live = liveAgentSessions.get(sessionId);
  if (live) return recentWithPending(live, lines);

  const session = getSessionById(sessionId);
  if (!session) return [];
  return readRecentLog(session.scrollbackPath, lines);
}

export function getShellRecentOutput(sessionId: string, lines = 200): string[] {
  const terminal = getDefaultShellTerminal(sessionId);
  return terminal ? getShellTerminalRecentOutput(terminal.id, lines) : [];
}

export function getShellTerminalRecentOutput(terminalId: string, lines = 200): string[] {
  const live = liveShellSessions.get(terminalId);
  if (live) return recentWithPending(live, lines);

  const terminal = getShellTerminalById(terminalId);
  if (!terminal) return [];
  return readRecentLog(terminal.scrollbackPath, lines);
}

function readRecentLog(logPath: string, lines: number): string[] {
  try {
    const raw = fs.readFileSync(logPath, 'utf-8');
    return raw.split('\n').slice(-lines);
  } catch {
    return [];
  }
}

function recentWithPending(live: LivePty, lines: number): string[] {
  const recent = live.recentLines.slice(-lines);
  if (live.pendingLine) {
    return [...recent, live.pendingLine].slice(-lines);
  }
  return recent;
}

export async function startSession(
  project: ProjectConfig,
  opts: { title?: string; initialPrompt?: string; command?: string; args?: string[] } = {}
): Promise<string> {
  const sessionId = uuidv4();
  const dir = ensureSessionDir(sessionId);
  const scrollbackPath = path.join(dir, 'terminal.log');
  const eventsPath = path.join(dir, 'events.jsonl');

  const command = opts.command || project.defaultCodexCommand || 'codex';
  const args = opts.args ?? [];

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
      id: sessionId,
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
    const terminalId = uuidv4();
    const terminal = createShellTerminal({
      id: terminalId,
      sessionId,
      title: 'Terminal 1',
      status: 'starting',
      scrollbackPath: path.join(dir, 'shell.log'),
    });
    spawnLivePty({
      id: terminal.id,
      sessionId,
      channel: 'shell',
      command: shell.command,
      args: shell.args,
      cwd: project.repoPath,
      logPath: terminal.scrollbackPath,
      eventsPath,
    });
    updateShellTerminalStatus(terminal.id, 'running');
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
  const terminal = getDefaultShellTerminal(sessionId);
  if (!terminal) return false;
  ensureShellTerminal(terminal.id);
  return writeToShellTerminal(terminal.id, text);
}

export function writeToShellTerminal(terminalId: string, text: string): boolean {
  return writeToChannel(terminalId, 'shell', text);
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
  const terminal = getDefaultShellTerminal(sessionId);
  return terminal ? interruptShellTerminal(terminal.id) : false;
}

export function interruptShellTerminal(terminalId: string): boolean {
  return interruptChannel(terminalId, 'shell');
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
  const terminal = getDefaultShellTerminal(sessionId);
  return terminal ? terminateShellTerminal(terminal.id) : false;
}

export function terminateShellTerminal(terminalId: string): boolean {
  return terminateChannel(terminalId, 'shell');
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
  const terminal = getDefaultShellTerminal(sessionId);
  return terminal ? killShellTerminalTree(terminal.id) : Promise.resolve(false);
}

export function killShellTerminalTree(terminalId: string): Promise<boolean> {
  return killChannelTree(terminalId, 'shell');
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
  const terminal = getDefaultShellTerminal(sessionId);
  if (terminal) resizeShellTerminalPty(terminal.id, cols, rows);
}

export function resizeShellTerminalPty(terminalId: string, cols: number, rows: number): void {
  resizeChannelPty(terminalId, 'shell', cols, rows);
}

function resizeChannelPty(sessionId: string, channel: PtyChannel, cols: number, rows: number): void {
  const live = registry(channel).get(sessionId);
  if (live) {
    try { live.ptyProcess.resize(cols, rows); } catch { /**/ }
  }
}
