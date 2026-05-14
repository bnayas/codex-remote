import fs from 'fs';
import os from 'os';
import path from 'path';

export interface CodexConversation {
  id: string;
  threadName: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  source?: string;
  cliVersion?: string;
  path: string;
}

interface SessionIndexEntry {
  id: string;
  thread_name?: string;
  updated_at?: string;
}

interface SessionMetaPayload {
  id?: string;
  timestamp?: string;
  cwd?: string;
  source?: string;
  cli_version?: string;
}

const MAX_SESSION_FILES = 5000;

export async function listCodexConversationsForRepo(
  repoPath: string,
  limit = 50
): Promise<CodexConversation[]> {
  const [index, sessionFiles] = await Promise.all([
    readSessionIndex(),
    findSessionFiles(path.join(codexHome(), 'sessions')),
  ]);

  const conversations: CodexConversation[] = [];
  const files = sessionFiles.slice(-MAX_SESSION_FILES);

  for (const filePath of files) {
    const meta = await readSessionMeta(filePath);
    if (!meta?.id || !meta.cwd || !isWithinRepo(repoPath, meta.cwd)) continue;

    const indexed = index.get(meta.id);
    conversations.push({
      id: meta.id,
      threadName: indexed?.thread_name || meta.id,
      cwd: meta.cwd,
      createdAt: meta.timestamp || indexed?.updated_at || '',
      updatedAt: indexed?.updated_at || meta.timestamp || '',
      source: meta.source,
      cliVersion: meta.cli_version,
      path: filePath,
    });
  }

  return conversations
    .sort((a, b) => timestampValue(b.updatedAt) - timestampValue(a.updatedAt))
    .slice(0, limit);
}

async function readSessionIndex(): Promise<Map<string, SessionIndexEntry>> {
  const result = new Map<string, SessionIndexEntry>();
  const indexPath = path.join(codexHome(), 'session_index.jsonl');
  const raw = await fs.promises.readFile(indexPath, 'utf-8').catch(() => '');

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as SessionIndexEntry;
      if (!entry.id) continue;
      const existing = result.get(entry.id);
      if (!existing || timestampValue(entry.updated_at) >= timestampValue(existing.updated_at)) {
        result.set(entry.id, entry);
      }
    } catch {
      // Ignore corrupt index lines; the session JSONL files are still authoritative.
    }
  }

  return result;
}

async function findSessionFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = await fs.promises.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        results.push(child);
      }
    }
  }

  return results.sort();
}

async function readSessionMeta(filePath: string): Promise<SessionMetaPayload | undefined> {
  const firstLine = await readFirstLine(filePath);
  if (!firstLine) return undefined;

  try {
    const event = JSON.parse(firstLine) as { type?: string; payload?: SessionMetaPayload };
    return event.type === 'session_meta' ? event.payload : undefined;
  } catch {
    return undefined;
  }
}

async function readFirstLine(filePath: string): Promise<string | undefined> {
  const handle = await fs.promises.open(filePath, 'r').catch(() => undefined);
  if (!handle) return undefined;

  try {
    const buffer = Buffer.alloc(128 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const chunk = buffer.subarray(0, bytesRead).toString('utf-8');
    return chunk.split(/\r?\n/, 1)[0];
  } finally {
    await handle.close();
  }
}

function isWithinRepo(repoPath: string, cwd: string): boolean {
  const repo = path.resolve(repoPath);
  const sessionCwd = path.resolve(cwd);
  const relative = path.relative(repo, sessionCwd);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function timestampValue(value?: string): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}
