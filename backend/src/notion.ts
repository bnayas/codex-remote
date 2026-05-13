import { AppConfig, ProjectConfig } from './config';
import { upsertProject } from './db';

const NOTION_VERSION = '2025-09-03';

interface NotionPage {
  id: string;
  url: string;
  properties: Record<string, NotionProperty>;
}

interface NotionRichText {
  plain_text?: string;
}

interface NotionProperty {
  type: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  status?: { name?: string };
  select?: { name?: string };
  checkbox?: boolean;
  number?: number;
  url?: string;
  date?: { start?: string };
}

interface NotionQueryResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor?: string;
}

export interface NotionSyncResult {
  enabled: boolean;
  synced: number;
  skipped: number;
  reason?: string;
}

export async function syncProjectsFromNotion(config: AppConfig): Promise<NotionSyncResult> {
  const dataSourceId = config.notion.projectsDataSourceId;
  const tokenEnv = config.notion.tokenEnv || 'NOTION_TOKEN';
  const token = process.env[tokenEnv];

  if (!dataSourceId) return { enabled: false, synced: 0, skipped: 0, reason: 'No Notion projects data source configured' };
  if (!token) return { enabled: false, synced: 0, skipped: 0, reason: `Missing ${tokenEnv}` };

  let synced = 0;
  let skipped = 0;
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(`https://api.notion.com/v1/data_sources/${stripCollectionPrefix(dataSourceId)}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Notion project sync failed (${res.status}): ${text || res.statusText}`);
    }

    const data = await res.json() as NotionQueryResponse;
    for (const page of data.results) {
      const project = pageToProject(page);
      if (!project) {
        skipped += 1;
        continue;
      }
      upsertProject(project);
      synced += 1;
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return { enabled: true, synced, skipped };
}

function pageToProject(page: NotionPage): (ProjectConfig & {
  notionPageUrl?: string;
  developmentPlan?: string;
  nextStep?: string;
  planStatus?: string;
  lastUpdate?: string;
}) | undefined {
  const include = checkbox(page, 'Include in Codex Remote');
  const name = text(page, 'Project name');
  const repoPath = text(page, 'Repo path');
  if (!include || !name || !repoPath) return undefined;

  return {
    id: text(page, 'Repo ID') || slugify(name),
    name,
    repoPath,
    defaultCodexCommand: text(page, 'Codex command') || '/bin/zsh',
    notionProjectId: page.id,
    notionPageUrl: page.url,
    githubUrl: url(page, 'Git remote') || url(page, 'URL'),
    developmentPlan: text(page, 'Development plan') || text(page, 'Summary'),
    nextStep: text(page, 'Next step'),
    planStatus: selectName(page, 'Plan status'),
    lastUpdate: dateStart(page, 'Last update'),
    largeFileThresholdKb: number(page, 'Large file threshold KB') || 256,
  };
}

function text(page: NotionPage, property: string): string | undefined {
  const prop = page.properties[property];
  if (!prop) return undefined;
  if (prop.type === 'title') return prop.title?.map(t => t.plain_text ?? '').join('').trim() || undefined;
  if (prop.type === 'rich_text') return prop.rich_text?.map(t => t.plain_text ?? '').join('').trim() || undefined;
  return undefined;
}

function checkbox(page: NotionPage, property: string): boolean {
  const prop = page.properties[property];
  return prop?.type === 'checkbox' ? prop.checkbox === true : false;
}

function number(page: NotionPage, property: string): number | undefined {
  const prop = page.properties[property];
  return prop?.type === 'number' ? prop.number : undefined;
}

function url(page: NotionPage, property: string): string | undefined {
  const prop = page.properties[property];
  return prop?.type === 'url' ? prop.url || undefined : undefined;
}

function selectName(page: NotionPage, property: string): string | undefined {
  const prop = page.properties[property];
  if (prop?.type === 'select') return prop.select?.name;
  if (prop?.type === 'status') return prop.status?.name;
  return undefined;
}

function dateStart(page: NotionPage, property: string): string | undefined {
  const prop = page.properties[property];
  return prop?.type === 'date' ? prop.date?.start : undefined;
}

function stripCollectionPrefix(id: string): string {
  return id.replace(/^collection:\/\//, '');
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
