import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { DATA_DIR } from './config';

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  defaultCodexCommand: string;
  notionProjectId?: string;
  notionPageUrl?: string;
  githubUrl?: string;
  developmentPlan?: string;
  nextStep?: string;
  planStatus?: string;
  lastUpdate?: string;
  largeFileThresholdKb: number;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  projectId: string;
  repoPath: string;
  command: string;
  argsJson: string;
  status: 'starting' | 'running' | 'exited' | 'killed' | 'error' | 'unknown';
  exitCode?: number;
  title?: string;
  startedAt: string;
  endedAt?: string;
  lastOutputAt?: string;
  scrollbackPath: string;
}

export interface ShellTerminal {
  id: string;
  sessionId: string;
  title: string;
  status: 'starting' | 'running' | 'exited' | 'killed' | 'error' | 'unknown';
  exitCode?: number;
  startedAt: string;
  endedAt?: string;
  lastOutputAt?: string;
  scrollbackPath: string;
}

export interface Plan {
  id: string;
  sessionId: string;
  status: 'draft' | 'sent' | 'approved' | 'rejected';
  originalText?: string;
  editedText?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledMessage {
  id: string;
  sessionId: string;
  text: string;
  status: 'pending' | 'sent' | 'cancelled';
  createdAt: string;
  sendAfter: string;
}

export interface FileSnapshot {
  id: number;
  sessionId: string;
  timestamp: string;
  gitStatusJson: string;
  diffStat?: string;
  changedFilesJson?: string;
}

let db: Database.Database;

export function getDb(): Database.Database {
  return db;
}

export function initDb(): void {
  const dbPath = path.join(DATA_DIR, 'codex-remote.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      default_codex_command TEXT DEFAULT 'codex',
      notion_project_id TEXT,
      notion_page_url TEXT,
      github_url TEXT,
      development_plan TEXT,
      next_step TEXT,
      plan_status TEXT,
      last_update TEXT,
      large_file_threshold_kb INTEGER DEFAULT 256,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      command TEXT NOT NULL,
      args_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'starting',
      exit_code INTEGER,
      title TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      last_output_at TEXT,
      scrollback_path TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT,
      payload_json TEXT,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS shell_terminals (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'starting',
      exit_code INTEGER,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      last_output_at TEXT,
      scrollback_path TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      original_text TEXT,
      edited_text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS file_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      git_status_json TEXT NOT NULL,
      diff_stat TEXT,
      changed_files_json TEXT,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      send_after TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );
  `);

  migrateProjectColumns();

  console.log(`✓ Database ready at ${dbPath}`);
}

function migrateProjectColumns(): void {
  const existing = new Set(
    (db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map(c => c.name)
  );
  const columns: Record<string, string> = {
    notion_page_url: 'TEXT',
    development_plan: 'TEXT',
    next_step: 'TEXT',
    plan_status: 'TEXT',
    last_update: 'TEXT',
  };
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) {
      db.prepare(`ALTER TABLE projects ADD COLUMN ${name} ${type}`).run();
    }
  }
}

export function upsertProject(p: Omit<Project, 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string }): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO projects (
      id, name, repo_path, default_codex_command, notion_project_id, notion_page_url,
      github_url, development_plan, next_step, plan_status, last_update,
      large_file_threshold_kb, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      repo_path = excluded.repo_path,
      default_codex_command = excluded.default_codex_command,
      notion_project_id = excluded.notion_project_id,
      notion_page_url = excluded.notion_page_url,
      github_url = excluded.github_url,
      development_plan = excluded.development_plan,
      next_step = excluded.next_step,
      plan_status = excluded.plan_status,
      last_update = excluded.last_update,
      large_file_threshold_kb = excluded.large_file_threshold_kb,
      updated_at = excluded.updated_at
  `).run(
    p.id, p.name, p.repoPath, p.defaultCodexCommand,
    p.notionProjectId ?? null, p.notionPageUrl ?? null,
    p.githubUrl ?? null, p.developmentPlan ?? null, p.nextStep ?? null,
    p.planStatus ?? null, p.lastUpdate ?? null,
    p.largeFileThresholdKb, p.createdAt ?? now, now
  );
}

export function getAllProjects(): Project[] {
  return (db.prepare('SELECT * FROM projects').all() as Record<string, unknown>[]).map(rowToProject);
}

export function getProjectById(id: string): Project | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToProject(row) : undefined;
}

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    repoPath: row.repo_path as string,
    defaultCodexCommand: (row.default_codex_command as string) || 'codex',
    notionProjectId: row.notion_project_id as string | undefined,
    notionPageUrl: row.notion_page_url as string | undefined,
    githubUrl: row.github_url as string | undefined,
    developmentPlan: row.development_plan as string | undefined,
    nextStep: row.next_step as string | undefined,
    planStatus: row.plan_status as string | undefined,
    lastUpdate: row.last_update as string | undefined,
    largeFileThresholdKb: (row.large_file_threshold_kb as number) || 256,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function createSession(s: Omit<Session, 'startedAt'> & { startedAt?: string }): Session {
  const now = new Date().toISOString();
  const session: Session = { ...s, startedAt: s.startedAt ?? now };
  db.prepare(`
    INSERT INTO sessions (id, project_id, repo_path, command, args_json, status, title, started_at, scrollback_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id, session.projectId, session.repoPath,
    session.command, session.argsJson, session.status,
    session.title ?? null, session.startedAt, session.scrollbackPath
  );
  return session;
}

export function updateSessionStatus(
  id: string,
  status: Session['status'],
  extras: { exitCode?: number; endedAt?: string; lastOutputAt?: string } = {}
): void {
  db.prepare(`
    UPDATE sessions SET status = ?, exit_code = COALESCE(?, exit_code),
      ended_at = COALESCE(?, ended_at), last_output_at = COALESCE(?, last_output_at)
    WHERE id = ?
  `).run(
    status,
    extras.exitCode ?? null,
    extras.endedAt ?? null,
    extras.lastOutputAt ?? null,
    id
  );
}

export function touchSessionOutput(id: string): void {
  db.prepare('UPDATE sessions SET last_output_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}

export function getSessionById(id: string): Session | undefined {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : undefined;
}

export function getSessionsByProject(projectId: string): Session[] {
  return (db.prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 50').all(projectId) as Record<string, unknown>[]).map(rowToSession);
}

export function getAllSessions(): Session[] {
  return (db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT 100').all() as Record<string, unknown>[]).map(rowToSession);
}

function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    repoPath: row.repo_path as string,
    command: row.command as string,
    argsJson: row.args_json as string,
    status: row.status as Session['status'],
    exitCode: row.exit_code as number | undefined,
    title: row.title as string | undefined,
    startedAt: row.started_at as string,
    endedAt: row.ended_at as string | undefined,
    lastOutputAt: row.last_output_at as string | undefined,
    scrollbackPath: row.scrollback_path as string,
  };
}

export function createShellTerminal(t: Omit<ShellTerminal, 'startedAt'> & { startedAt?: string }): ShellTerminal {
  const now = new Date().toISOString();
  const terminal: ShellTerminal = { ...t, startedAt: t.startedAt ?? now };
  db.prepare(`
    INSERT INTO shell_terminals (
      id, session_id, title, status, exit_code, started_at, ended_at, last_output_at, scrollback_path
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    terminal.id,
    terminal.sessionId,
    terminal.title,
    terminal.status,
    terminal.exitCode ?? null,
    terminal.startedAt,
    terminal.endedAt ?? null,
    terminal.lastOutputAt ?? null,
    terminal.scrollbackPath
  );
  return terminal;
}

export function getShellTerminalById(id: string): ShellTerminal | undefined {
  const row = db.prepare('SELECT * FROM shell_terminals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToShellTerminal(row) : undefined;
}

export function getShellTerminalsBySession(sessionId: string): ShellTerminal[] {
  return (db.prepare('SELECT * FROM shell_terminals WHERE session_id = ? ORDER BY started_at ASC').all(sessionId) as Record<string, unknown>[])
    .map(rowToShellTerminal);
}

export function updateShellTerminalStatus(
  id: string,
  status: ShellTerminal['status'],
  extras: { exitCode?: number; endedAt?: string; lastOutputAt?: string } = {}
): void {
  db.prepare(`
    UPDATE shell_terminals SET status = ?, exit_code = COALESCE(?, exit_code),
      ended_at = COALESCE(?, ended_at), last_output_at = COALESCE(?, last_output_at)
    WHERE id = ?
  `).run(
    status,
    extras.exitCode ?? null,
    extras.endedAt ?? null,
    extras.lastOutputAt ?? null,
    id
  );
}

export function touchShellTerminalOutput(id: string): void {
  db.prepare('UPDATE shell_terminals SET last_output_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}

function rowToShellTerminal(row: Record<string, unknown>): ShellTerminal {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    title: row.title as string,
    status: row.status as ShellTerminal['status'],
    exitCode: row.exit_code as number | undefined,
    startedAt: row.started_at as string,
    endedAt: row.ended_at as string | undefined,
    lastOutputAt: row.last_output_at as string | undefined,
    scrollbackPath: row.scrollback_path as string,
  };
}

export function createPlan(p: Omit<Plan, 'createdAt' | 'updatedAt'>): Plan {
  const now = new Date().toISOString();
  const plan: Plan = { ...p, createdAt: now, updatedAt: now };
  db.prepare(`
    INSERT INTO plans (id, session_id, status, original_text, edited_text, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(plan.id, plan.sessionId, plan.status, plan.originalText ?? null, plan.editedText ?? null, plan.createdAt, plan.updatedAt);
  return plan;
}

export function updatePlan(id: string, updates: { status?: Plan['status']; editedText?: string }): Plan | undefined {
  const now = new Date().toISOString();
  db.prepare(`UPDATE plans SET status = COALESCE(?, status), edited_text = COALESCE(?, edited_text), updated_at = ? WHERE id = ?`)
    .run(updates.status ?? null, updates.editedText ?? null, now, id);
  const row = db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToPlan(row) : undefined;
}

export function getPlansBySession(sessionId: string): Plan[] {
  return (db.prepare('SELECT * FROM plans WHERE session_id = ? ORDER BY created_at DESC').all(sessionId) as Record<string, unknown>[]).map(rowToPlan);
}

function rowToPlan(row: Record<string, unknown>): Plan {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    status: row.status as Plan['status'],
    originalText: row.original_text as string | undefined,
    editedText: row.edited_text as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function createScheduledMessage(sm: Omit<ScheduledMessage, 'createdAt'>): ScheduledMessage {
  const now = new Date().toISOString();
  const msg: ScheduledMessage = { ...sm, createdAt: now };
  db.prepare(`
    INSERT INTO scheduled_messages (id, session_id, text, status, created_at, send_after)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(msg.id, msg.sessionId, msg.text, msg.status, msg.createdAt, msg.sendAfter);
  return msg;
}

export function getPendingScheduledMessages(): ScheduledMessage[] {
  return (db.prepare('SELECT * FROM scheduled_messages WHERE status = ?').all('pending') as Record<string, unknown>[]).map(rowToScheduledMessage);
}

export function getScheduledMessagesBySession(sessionId: string): ScheduledMessage[] {
  return (db.prepare('SELECT * FROM scheduled_messages WHERE session_id = ? ORDER BY send_after ASC').all(sessionId) as Record<string, unknown>[]).map(rowToScheduledMessage);
}

export function updateScheduledMessageStatus(id: string, status: ScheduledMessage['status']): void {
  db.prepare('UPDATE scheduled_messages SET status = ? WHERE id = ?').run(status, id);
}

function rowToScheduledMessage(row: Record<string, unknown>): ScheduledMessage {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    text: row.text as string,
    status: row.status as ScheduledMessage['status'],
    createdAt: row.created_at as string,
    sendAfter: row.send_after as string,
  };
}

export function saveFileSnapshot(snap: Omit<FileSnapshot, 'id'>): void {
  db.prepare(`
    INSERT INTO file_snapshots (session_id, timestamp, git_status_json, diff_stat, changed_files_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(snap.sessionId, snap.timestamp, snap.gitStatusJson, snap.diffStat ?? null, snap.changedFilesJson ?? null);
}

export function getLatestFileSnapshot(sessionId: string): FileSnapshot | undefined {
  const row = db.prepare('SELECT * FROM file_snapshots WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(sessionId) as Record<string, unknown> | undefined;
  return row ? {
    id: row.id as number,
    sessionId: row.session_id as string,
    timestamp: row.timestamp as string,
    gitStatusJson: row.git_status_json as string,
    diffStat: row.diff_stat as string | undefined,
    changedFilesJson: row.changed_files_json as string | undefined,
  } : undefined;
}

export function markStaleSessionsUnknown(): void {
  db.prepare(`UPDATE sessions SET status = 'unknown' WHERE status IN ('starting','running')`)
    .run();
}

export function ensureSessionDir(sessionId: string): string {
  const dir = path.join(DATA_DIR, 'sessions', sessionId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
