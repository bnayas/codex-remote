import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ChangedFile {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | 'U' | '?';
  statusLabel: string;
  additions?: number;
  deletions?: number;
  isLarge: boolean;
  diffLines?: number;
}

export interface GitStatus {
  changedFiles: ChangedFile[];
  branch: string;
  isClean: boolean;
  timestamp: string;
}

export interface DiffResult {
  filePath?: string;
  content: string;
  isTruncated: boolean;
  lineCount: number;
  isLarge: boolean;
}

export interface GitCommit {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    // Return stdout even on non-zero exit (e.g. git diff returns 1 when there are changes)
    if (e.stdout) return e.stdout;
    throw err;
  }
}

function statusCode(code: string): ChangedFile['status'] {
  if (code.includes('M')) return 'M';
  if (code.includes('A')) return 'A';
  if (code.includes('D')) return 'D';
  if (code.includes('R')) return 'R';
  if (code.includes('?')) return '?';
  return 'U';
}

function statusLabel(status: ChangedFile['status']): string {
  const map: Record<ChangedFile['status'], string> = {
    M: 'modified', A: 'added', D: 'deleted', R: 'renamed', U: 'updated', '?': 'untracked'
  };
  return map[status];
}

const LARGE_DIFF_LINES = 1000;
const LARGE_DIFF_BYTES = 256 * 1024;

export async function getGitStatus(repoPath: string): Promise<GitStatus> {
  const [statusOut, branchOut] = await Promise.all([
    git(repoPath, ['status', '--porcelain']).catch(() => ''),
    git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'unknown'),
  ]);

  // Parse diff --stat for additions/deletions
  let diffStatMap: Map<string, { additions: number; deletions: number }> = new Map();
  try {
    const diffStat = await git(repoPath, ['diff', '--numstat']);
    for (const line of diffStat.trim().split('\n')) {
      if (!line) continue;
      const parts = line.split('\t');
      if (parts.length >= 3) {
        diffStatMap.set(parts[2], {
          additions: parseInt(parts[0]) || 0,
          deletions: parseInt(parts[1]) || 0,
        });
      }
    }
  } catch { /**/ }

  const changedFiles: ChangedFile[] = [];
  for (const line of statusOut.trim().split('\n')) {
    if (!line) continue;
    const code = line.slice(0, 2).trim();
    const filePath = line.slice(3).trim().replace(/^"(.*)"$/, '$1');
    if (!filePath) continue;
    const sc = statusCode(code);
    const stat = diffStatMap.get(filePath);
    changedFiles.push({
      path: filePath,
      status: sc,
      statusLabel: statusLabel(sc),
      additions: stat?.additions,
      deletions: stat?.deletions,
      isLarge: false,
    });
  }

  return {
    changedFiles,
    branch: branchOut.trim(),
    isClean: changedFiles.length === 0,
    timestamp: new Date().toISOString(),
  };
}

export async function getDiff(repoPath: string, filePath?: string, maxLines = 2000): Promise<DiffResult> {
  const args = filePath
    ? ['diff', '--', filePath]
    : ['diff'];

  let content: string;
  try {
    content = await git(repoPath, args);
  } catch {
    content = '';
  }

  // Also try staged diff
  if (!content.trim()) {
    try {
      const stagedArgs = filePath ? ['diff', '--cached', '--', filePath] : ['diff', '--cached'];
      content = await git(repoPath, stagedArgs);
    } catch { /**/ }
  }

  const lines = content.split('\n');
  const lineCount = lines.length;
  const byteCount = Buffer.byteLength(content, 'utf8');
  const isLarge = lineCount > LARGE_DIFF_LINES || byteCount > LARGE_DIFF_BYTES;

  let isTruncated = false;
  let finalContent = content;
  if (lineCount > maxLines) {
    finalContent = lines.slice(0, maxLines).join('\n') + `\n... (truncated, ${lineCount - maxLines} more lines)`;
    isTruncated = true;
  }

  return { filePath, content: finalContent, isTruncated, lineCount, isLarge };
}

export async function getDiffStat(repoPath: string): Promise<string> {
  try {
    return await git(repoPath, ['diff', '--stat']);
  } catch {
    return '';
  }
}

export async function getLastCommits(repoPath: string, limit = 5): Promise<GitCommit[]> {
  try {
    const count = Math.max(1, Math.min(limit, 20)).toString();
    const out = await git(repoPath, [
      'log',
      `-${count}`,
      '--date=iso-strict',
      '--pretty=format:%h%x1f%ad%x1f%an%x1f%s',
    ]);

    return out.trim().split('\n').filter(Boolean).map(line => {
      const [hash, date, author, subject] = line.split('\x1f');
      return {
        hash: hash ?? '',
        date: date ?? '',
        author: author ?? '',
        subject: subject ?? '',
      };
    });
  } catch {
    return [];
  }
}
