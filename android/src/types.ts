export interface Project {
  id: string;
  name: string;
  repoPath: string;
  defaultCodexCommand: string;
  notionPageUrl?: string;
  githubUrl?: string;
  developmentPlan?: string;
  nextStep?: string;
  planStatus?: string;
  lastUpdate?: string;
  largeFileThresholdKb: number;
  createdAt: string;
  updatedAt: string;
  sessions?: Session[];
}

export interface GitCommit {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

export interface RepoContext {
  project: Project;
  branch: string;
  isClean: boolean;
  changedFilesCount: number;
  lastCommits: GitCommit[];
}

export interface Session {
  id: string;
  projectId: string;
  repoPath: string;
  command: string;
  status: 'starting' | 'running' | 'exited' | 'killed' | 'error' | 'unknown';
  exitCode?: number;
  title?: string;
  startedAt: string;
  endedAt?: string;
  lastOutputAt?: string;
  scrollbackPath: string;
  alive?: boolean;
  terminalAlive?: boolean;
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

export interface ChangedFile {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | 'U' | '?';
  statusLabel: string;
  additions?: number;
  deletions?: number;
  isLarge: boolean;
}

export interface GitStatus {
  changedFiles: ChangedFile[];
  branch: string;
  isClean: boolean;
  timestamp: string;
  diffStat?: string;
}

export interface DiffResult {
  filePath?: string;
  content: string;
  isTruncated: boolean;
  lineCount: number;
  isLarge: boolean;
}

export interface RepoFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt?: string;
}

export interface RepoTree {
  path: string;
  entries: RepoFileEntry[];
  truncated: boolean;
}

export interface RepoFileContent {
  path: string;
  content: string;
  size: number;
  isBinary: boolean;
  isTruncated: boolean;
  lineCount: number;
}

export type WsMessage =
  | { type: 'connected'; sessionId: string; status: string; alive: boolean; timestamp: string }
  | { type: 'scrollback'; lines: string[] }
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number | null; status: string; timestamp: string }
  | { type: 'status'; status: string; alive: boolean }
  | { type: 'git_status'; changedFiles: ChangedFile[]; branch: string; isClean: boolean; timestamp: string }
  | { type: 'pong'; timestamp: string }
  | { type: 'error'; message: string };

// Navigation param types
export type RootStackParamList = {
  Setup: undefined;
  Projects: undefined;
  ProjectDetail: { project: Project };
  Session: { session: Session };
};
