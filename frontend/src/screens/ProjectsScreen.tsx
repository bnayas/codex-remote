import React, { useState, useEffect, useCallback } from 'react';
import { Project, Session } from '../types';
import { api } from '../api';
import { statusColor, timeSince } from '../utils';

function RecentSessions({ onSelect }: { onSelect: (s: Session) => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    api.getSessions().then(data => setSessions(data.slice(0, 8))).catch(err => {
      console.error('Failed to load sessions:', err);
    });
  }, []);

  if (sessions.length === 0) return null;
  const hasActive = sessions.some(s => s.alive);

  return (
    <div className="section">
      <div className="section-title">{hasActive ? 'Active Sessions & Recent History' : 'Recent Session History'}</div>
      {sessions.map(s => (
        <div key={s.id} className="session-row" onClick={() => onSelect(s)}>
          <span className="status-dot sm" style={{ background: statusColor(s.status) }} />
          <div className="session-row-info">
            <div className="session-row-title">{s.title || s.id.slice(0, 8)}</div>
            <div className="session-row-meta">
              {s.alive ? 'open now' : 'history'} · {s.status} · {timeSince(s.startedAt)}
            </div>
          </div>
          <span className="chevron">›</span>
        </div>
      ))}
    </div>
  );
}

export function ProjectsScreen({
  onSelectProject,
  onSelectSession,
  onDisconnect,
}: {
  onSelectProject: (p: Project) => void;
  onSelectSession: (s: Session) => void;
  onDisconnect: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.getProjects();
      setProjects(data);
      setError('');
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function latestSession(p: Project): Session | undefined {
    return p.sessions?.[0];
  }

  return (
    <div className="screen">
      <div className="top-bar">
        <span className="top-bar-title">
          <span className="title-bracket">&lt;</span>
          codex-remote
          <span className="title-bracket">/&gt;</span>
        </span>
        <button className="btn-ghost btn-sm" onClick={onDisconnect}>⏏</button>
      </div>

      {loading && <div className="loading-msg">Loading projects…</div>}
      {error && <div className="error-banner">{error} <button onClick={load} className="btn-link">retry</button></div>}

      <div className="list">
        {projects.map(p => {
          const latest = latestSession(p);
          return (
            <div key={p.id} className="project-card" onClick={() => onSelectProject(p)}>
              <div className="project-header">
                <span className="project-name">{p.name}</span>
                {latest && (
                  <span className="status-dot" style={{ background: statusColor(latest.status) }} />
                )}
              </div>
              <div className="project-path">{p.repoPath.split(/[/\\]/).pop()}</div>
              {latest && (
                <div className="project-meta">
                  <span className="meta-tag" style={{ color: statusColor(latest.status) }}>
                    {latest.status}
                  </span>
                  <span className="meta-sep">·</span>
                  <span className="meta-muted">last: {timeSince(latest.startedAt)}</span>
                  {latest.title && <><span className="meta-sep">·</span><span className="meta-muted truncate">{latest.title}</span></>}
                </div>
              )}
              {!latest && <div className="meta-muted">No remote runs yet</div>}
            </div>
          );
        })}
        {!loading && projects.length === 0 && (
          <div className="empty-state">No projects configured.<br />Edit <code>~/.codex-remote/config.yaml</code></div>
        )}
      </div>

      {/* Recent sessions quick list */}
      <RecentSessions onSelect={onSelectSession} />
    </div>
  );
}
