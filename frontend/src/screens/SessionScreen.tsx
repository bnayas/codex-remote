import React, { useState, useEffect, useCallback } from 'react';
import { Session, ChangedFile, ScheduledMessage, ShellTerminal } from '../types';
import { api } from '../api';
import { elapsed, timeSince, statusColor, agentDisplayName } from '../utils';
import { Terminal } from '../components/Terminal';
import { InputBar } from '../components/InputBar';
import { ControlBar } from '../components/ControlBar';
import { FilesPanel } from '../components/FilesPanel';
import { PlanEditor } from '../components/PlanEditor';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { AgentConversation } from '../components/AgentConversation';

type TabId = 'conversation' | 'codex-term' | 'terminal' | 'files' | 'plan';

export function SessionScreen({
  session: initialSession,
  onBack,
}: {
  session: Session;
  onBack: () => void;
}) {
  const [session, setSession] = useState(initialSession);
  const [tab, setTab] = useState<TabId>('conversation');
  const [liveFiles, setLiveFiles] = useState<ChangedFile[]>([]);
  const [liveBranch, setLiveBranch] = useState('');
  const [alive, setAlive] = useState(initialSession.alive ?? false);
  const [terminalAlive, setTerminalAlive] = useState(initialSession.terminalAlive ?? false);
  const [agentConnected, setAgentConnected] = useState(false);
  const [terminalConnected, setTerminalConnected] = useState(false);
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([]);
  const [terminals, setTerminals] = useState<ShellTerminal[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState('');
  const [creatingTerminal, setCreatingTerminal] = useState(false);
  const [refreshingSession, setRefreshingSession] = useState(false);

  const fetchScheduled = useCallback(() => {
    api.getScheduledMessages(session.id).then(setScheduled).catch(err => {
      console.error('Failed to load scheduled messages:', err);
    });
  }, [session.id]);

  const fetchTerminals = useCallback(() => {
    api.getShellTerminals(session.id).then(items => {
      setTerminals(items);
      setActiveTerminalId(current => {
        const nextId = current || items[0]?.id || '';
        const active = items.find(t => t.id === nextId) ?? items[0];
        setTerminalAlive(active?.alive ?? false);
        return nextId;
      });
    }).catch(err => {
      console.error('Failed to load terminals:', err);
    });
  }, [session.id]);

  const handleAgentState = useCallback((state: { connected: boolean; alive: boolean; status: string }) => {
    setAgentConnected(state.connected);
    setAlive(state.alive);
    setSession(s => ({ ...s, status: state.status as Session['status'] }));
  }, []);

  const handleTerminalState = useCallback((state: { connected: boolean; alive: boolean; status: string }) => {
    setTerminalConnected(state.connected);
    setTerminalAlive(state.alive);
    setTerminals(items => items.map(t => (
      t.id === activeTerminalId
        ? { ...t, alive: state.alive, status: state.status as ShellTerminal['status'] }
        : t
    )));
  }, [activeTerminalId]);

  const refreshSession = useCallback(async () => {
    setRefreshingSession(true);
    try {
      const updated = await api.getSession(session.id);
      setSession(updated);
      setAlive(updated.alive ?? false);
      setTerminalAlive(updated.terminalAlive ?? false);
      fetchTerminals();
      fetchScheduled();
    } catch (err) {
      console.error('Failed to refresh session:', err);
    } finally {
      setRefreshingSession(false);
    }
  }, [session.id, fetchScheduled, fetchTerminals]);

  // Refresh session on mount
  useEffect(() => {
    void refreshSession();
    const interval = setInterval(fetchScheduled, 10000);
    return () => clearInterval(interval);
  }, [session.id, fetchScheduled, refreshSession]);

  const noOutputSince = session.lastOutputAt
    ? Math.floor((Date.now() - new Date(session.lastOutputAt).getTime()) / 1000)
    : null;

  // Derive agent display name from the command used to start the session
  const agentName = agentDisplayName(session.command);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'conversation', label: `${agentName} Chat` },
    { id: 'codex-term', label: `${agentName} Terminal` },
    { id: 'terminal', label: `Terminals${terminals.length > 1 ? ` (${terminals.length})` : ''}` },
    { id: 'files', label: `Files${liveFiles.length ? ` (${liveFiles.length})` : ''}` },
    { id: 'plan', label: 'Plan' },
  ];

  const activeTerminal = terminals.find(t => t.id === activeTerminalId) ?? terminals[0];
  const activeTerminalAlive = activeTerminal?.alive ?? terminalAlive;
  const headerStatus = refreshingSession
    ? { label: 'Refreshing', color: '#7cb7ff', background: 'rgba(124,183,255,0.12)' }
    : alive
    ? { label: 'Live', color: '#4ade80', background: 'rgba(74,222,128,0.12)' }
    : agentConnected
    ? { label: `History · ${session.status}`, color: '#8b8b9e', background: 'rgba(139,139,158,0.12)' }
    : { label: 'Offline', color: '#fbbf24', background: 'rgba(251,191,36,0.12)' };

  async function createTerminal() {
    if (creatingTerminal) return;
    setCreatingTerminal(true);
    try {
      const terminal = await api.createShellTerminal(session.id);
      setTerminals(items => [...items, terminal]);
      setActiveTerminalId(terminal.id);
      setTerminalAlive(terminal.alive ?? false);
    } catch (err) {
      console.error('Failed to create terminal:', err);
    } finally {
      setCreatingTerminal(false);
    }
  }

  return (
    <div className="screen screen-session">
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px 20px',
        background: 'transparent',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
      }}>
        {/* Left: Live indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: headerStatus.background,
          backdropFilter: 'blur(10px)',
          padding: '6px 12px',
          borderRadius: '20px',
          border: '1px solid rgba(255,255,255,0.05)',
          color: headerStatus.color,
          fontSize: '14px',
          fontWeight: 500
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: headerStatus.color, boxShadow: `0 0 10px ${headerStatus.color}` }} />
          {headerStatus.label}
        </div>

        {/* Center: Title */}
        <div style={{
          color: '#ffffff',
          fontSize: '18px',
          fontWeight: 600,
          fontFamily: 'var(--sans)'
        }}>
          {tabs.find(t => t.id === tab)?.label || session.title}
        </div>

        {/* Right: Back Button */}
        <button onClick={onBack} style={{
          width: 40,
          height: 40,
          borderRadius: '12px',
          background: 'rgba(30, 30, 40, 0.6)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.05)',
          color: '#ffffff',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          cursor: 'pointer',
          fontSize: '20px'
        }}>
          ←
        </button>
      </div>



      {scheduled.length > 0 && (
        <div className="scheduled-banner">
          {scheduled.length} scheduled message{scheduled.length > 1 ? 's' : ''} pending.
          <button className="btn-link btn-sm" style={{ marginLeft: 8 }} onClick={async () => {
             for (const sm of scheduled) await api.cancelScheduledMessage(session.id, sm.id);
             fetchScheduled();
          }}>Cancel All</button>
        </div>
      )}

      {/* Content */}
      <div className="tab-content">
        {/* Conversation GUI tab */}
        <div className={`tab-pane ${tab !== 'conversation' ? 'tab-pane-hidden' : ''}`}>
          <ErrorBoundary fallbackMessage="Conversation rendering error">
            <AgentConversation
              sessionId={session.id}
              agentName={agentName}
              sessionStatus={session.status}
              onState={handleAgentState}
              onRefresh={refreshSession}
            />
          </ErrorBoundary>
        </div>

        {/* Codex Terminal tab — raw PTY view of Codex process */}
        <div className={`tab-pane ${tab !== 'codex-term' ? 'tab-pane-hidden' : ''}`}>
          <div className="agent-pane-toolbar">
            <span className="agent-pane-title">{agentName} Terminal</span>
            <span className="meta-muted">{agentName} PTY</span>
            {liveBranch && <span className="branch-tag">{liveBranch}</span>}
            <span className={`dirty-pill ${liveFiles.length > 0 ? 'dirty' : ''}`}>
              {liveFiles.length > 0 ? `${liveFiles.length} changed` : 'clean'}
            </span>
          </div>
          <ErrorBoundary fallbackMessage="Terminal rendering error">
            <Terminal
              sessionId={session.id}
              channel="agent"
              label={`${agentName.toUpperCase()} OUTPUT`}
              alive={alive}
              onGitStatus={(files, branch) => {
                setLiveFiles(files);
                setLiveBranch(branch);
              }}
              onExit={(status) => {
                setAlive(false);
                setSession(s => ({ ...s, status: status as Session['status'] }));
              }}
              onState={handleAgentState}
            />
          </ErrorBoundary>
          <InputBar sessionId={session.id} disabled={!alive} target="agent" placeholder={`Send instruction to ${agentName}…`} />
          <ControlBar sessionId={session.id} alive={alive} target="agent" agentName={agentName} />
        </div>

        {/* General Terminal tab — shell for manual operations */}
        <div className={`tab-pane ${tab !== 'terminal' ? 'tab-pane-hidden' : ''}`}>
          <div className="agent-pane-toolbar terminal-switcher">
            <span className="agent-pane-title">Terminals</span>
            <div className="terminal-tab-list">
              {terminals.map(t => (
                <button
                  key={t.id}
                  className={`terminal-tab-btn ${activeTerminalId === t.id ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTerminalId(t.id);
                    setTerminalAlive(t.alive ?? false);
                  }}
                >
                  <span className={`terminal-tab-dot ${t.alive ? 'alive' : ''}`} />
                  {t.title}
                </button>
              ))}
            </div>
            <button className="btn-primary btn-sm" onClick={createTerminal} disabled={creatingTerminal}>
              {creatingTerminal ? 'Creating...' : '+ New Terminal'}
            </button>
          </div>
          <ErrorBoundary fallbackMessage="Terminal rendering error">
            {activeTerminal ? (
              <Terminal
                key={activeTerminal.id}
                sessionId={session.id}
                channel="shell"
                terminalId={activeTerminal.id}
                label={activeTerminal.title.toUpperCase()}
                alive={activeTerminalAlive}
                onState={handleTerminalState}
                onSubmitInput={(text) => api.sendShellTerminalInput(session.id, activeTerminal.id, text)}
              />
            ) : (
              <div className="terminal-empty">No terminal available.</div>
            )}
          </ErrorBoundary>
          <ControlBar sessionId={session.id} alive={!!activeTerminal && activeTerminalAlive} target="shell" terminalId={activeTerminal?.id} />
        </div>

        {/* Files tab */}
        {tab === 'files' && (
          <ErrorBoundary fallbackMessage="File browser error">
            <FilesPanel sessionId={session.id} initialFiles={liveFiles} branch={liveBranch} />
          </ErrorBoundary>
        )}

        {/* Plan tab */}
        {tab === 'plan' && (
          <ErrorBoundary fallbackMessage="Plan editor error">
            <PlanEditor sessionId={session.id} />
          </ErrorBoundary>
        )}
      {/* End of content panes */}
      </div>

      {/* Bottom Nav Bar */}
      <div className="bottom-nav-bar glass-panel">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`bottom-nav-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
