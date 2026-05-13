import React, { useState, useEffect } from 'react';
import { Project, Session, RepoContext } from '../types';
import { api } from '../api';
import { statusColor, timeSince, agentDisplayName } from '../utils';

function NewSessionModal({
  project,
  onStart,
  onCancel,
}: {
  project: Project;
  onStart: (session: Session) => void;
  onCancel: () => void;
}) {
  const agentName = agentDisplayName(project.defaultCodexCommand);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleStart() {
    setLoading(true);
    setError('');
    try {
      const session = await api.createSession({
        projectId: project.id,
        title: title.trim() || undefined,
        initialPrompt: prompt.trim() || undefined,
      });
      onStart(session);
    } catch (e: unknown) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-title">New Session — {project.name}</div>
        <label className="field-label">Title (optional)</label>
        <input
          className="field-input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Fix AGENTS.md path issue"
        />
        <label className="field-label">Initial prompt (optional)</label>
        <textarea
          className="field-textarea"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={`What should ${agentName} do first?`}
          rows={4}
        />
        {error && <div className="setup-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={handleStart} disabled={loading}>
            {loading ? 'Starting…' : `Start ${agentName}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProjectScreen({
  project,
  onBack,
  onOpenSession,
}: {
  project: Project;
  onBack: () => void;
  onOpenSession: (s: Session) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>(project.sessions || []);
  const [showNew, setShowNew] = useState(false);
  const [context, setContext] = useState<RepoContext | null>(null);
  const [contextError, setContextError] = useState('');

  useEffect(() => {
    api.getProject(project.id).then(p => setSessions(p.sessions || [])).catch(err => {
      console.error('Failed to load project:', err);
    });
    api.getRepoContext(project.id)
      .then(c => {
        setContext(c);
        setContextError('');
      })
      .catch(e => setContextError((e as Error).message));
  }, [project.id]);

  function handleNewSession(session: Session) {
    setShowNew(false);
    setSessions(ss => [session, ...ss]);
    onOpenSession(session);
  }

  return (
    <div className="screen">
      <div className="top-bar">
        <button className="btn-back" onClick={onBack}>‹</button>
        <span className="top-bar-title">{project.name}</span>
        <button className="btn-primary btn-sm" onClick={() => setShowNew(true)}>+ Session</button>
      </div>

      <div className="project-detail-path">{project.repoPath}</div>
      <div className="section-title" style={{ marginTop: 16 }}>Context</div>
      <div className="project-plan-card">
        {contextError && <div className="setup-error">{contextError}</div>}
        {!context && !contextError && <div className="meta-muted">Loading context…</div>}
        {context && (
          <>
            <div className="project-plan-meta">
              <span className="meta-tag">{context.branch}</span>
              <span className={`dirty-pill ${context.changedFilesCount > 0 ? 'dirty' : ''}`}>
                {context.changedFilesCount > 0 ? `${context.changedFilesCount} changed` : 'clean'}
              </span>
              {context.project.planStatus && <span className="meta-tag">{context.project.planStatus}</span>}
              {context.project.lastUpdate && <span className="meta-muted">{timeSince(context.project.lastUpdate)}</span>}
            </div>
            {context.project.developmentPlan && <div className="project-plan-text">{context.project.developmentPlan}</div>}
            {context.project.nextStep && <div className="project-next-step">Next: {context.project.nextStep}</div>}
            <div className="section-title compact">Last Commits</div>
            {context.lastCommits.length > 0 ? context.lastCommits.slice(0, 5).map(commit => (
              <div key={commit.hash} className="commit-row">
                <span className="commit-hash">{commit.hash}</span>
                <div className="commit-body">
                  <div className="commit-subject">{commit.subject}</div>
                  <div className="commit-meta">{commit.author}{commit.date ? ` · ${timeSince(commit.date)}` : ''}</div>
                </div>
              </div>
            )) : (
              <div className="meta-muted">No commits available</div>
            )}
          </>
        )}
      </div>

      <div className="section-title" style={{ marginTop: 16 }}>Session History</div>
      <div className="list">
        {sessions.map(s => (
          <div key={s.id} className="session-card" onClick={() => onOpenSession(s)}>
            <div className="session-card-header">
              <span className="status-dot" style={{ background: statusColor(s.status) }} />
              <span className="session-card-title">{s.title || s.id.slice(0, 12)}</span>
              <span className="session-card-status" style={{ color: statusColor(s.status) }}>
                {s.alive ? 'open now' : s.status}
              </span>
            </div>
            <div className="session-card-meta">
              <span>{s.alive ? 'Agent is active' : 'Saved history'} · Started {timeSince(s.startedAt)}</span>
              {s.endedAt && <span> · Ended {timeSince(s.endedAt)}</span>}
            </div>
          </div>
        ))}
        {sessions.length === 0 && <div className="empty-state">No sessions yet</div>}
      </div>

      {showNew && (
        <NewSessionModal
          project={project}
          onStart={handleNewSession}
          onCancel={() => setShowNew(false)}
        />
      )}
    </div>
  );
}
