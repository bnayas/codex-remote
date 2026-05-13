import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import os from 'os';
import crypto from 'crypto';

export interface ProjectConfig {
  id: string;
  name: string;
  repoPath: string;
  defaultCodexCommand: string;
  notionProjectId?: string;
  githubUrl?: string;
  largeFileThresholdKb: number;
}

export interface NotionConfig {
  projectsDataSourceId?: string;
  updatesDataSourceId?: string;
  tokenEnv?: string;
  syncOnStart: boolean;
}

export interface AppConfig {
  projects: ProjectConfig[];
  notion: NotionConfig;
  authToken: string;
  port: number;
  host: string;
  dataDir: string;
}

export const DATA_DIR = path.join(os.homedir(), '.codex-remote');
const CONFIG_PATH = path.join(DATA_DIR, 'config.yaml');

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function loadConfig(): AppConfig {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(CONFIG_PATH)) {
    const token = generateToken();
    const defaultConfig = {
      authToken: token,
      port: 3742,
      host: '0.0.0.0',
      notion: {
        projectsDataSourceId: '',
        updatesDataSourceId: '',
        tokenEnv: 'NOTION_TOKEN',
        syncOnStart: false,
      },
      projects: [
        {
          id: 'example-project',
          name: 'Example Project',
          repoPath: path.join(os.homedir(), 'source', 'repos', 'my-project'),
          defaultCodexCommand: 'codex',
          largeFileThresholdKb: 256,
        },
      ],
    };
    fs.writeFileSync(CONFIG_PATH, yaml.dump(defaultConfig), 'utf-8');
    console.log(`\n✓ Created config at ${CONFIG_PATH}`);
    console.log(`✓ Auth token: ${token}`);
    console.log(`  Edit config.yaml to add your real projects.\n`);
  }

  const raw = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;

  return {
    authToken: (raw.authToken as string) || generateToken(),
    port: (raw.port as number) || 3742,
    host: (raw.host as string) || '0.0.0.0',
    dataDir: DATA_DIR,
    notion: (() => {
      const notion = (raw.notion as Record<string, unknown> | undefined) ?? {};
      return {
        projectsDataSourceId: notion.projectsDataSourceId as string | undefined,
        updatesDataSourceId: notion.updatesDataSourceId as string | undefined,
        tokenEnv: (notion.tokenEnv as string | undefined) || 'NOTION_TOKEN',
        syncOnStart: notion.syncOnStart !== false,
      };
    })(),
    projects: ((raw.projects as unknown[]) || []).map((p: unknown) => {
      const proj = p as Record<string, unknown>;
      return {
        id: proj.id as string,
        name: proj.name as string,
        repoPath: proj.repoPath as string,
        defaultCodexCommand: (proj.defaultCodexCommand as string) || 'codex',
        notionProjectId: proj.notionProjectId as string | undefined,
        githubUrl: proj.githubUrl as string | undefined,
        largeFileThresholdKb: (proj.largeFileThresholdKb as number) || 256,
      };
    }),
  };
}
