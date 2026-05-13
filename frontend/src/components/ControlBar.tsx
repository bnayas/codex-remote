import React, { useState } from 'react';
import { api } from '../api';
import { showToast } from './Toast';

export function ControlBar({
  sessionId,
  alive,
  target = 'agent',
  agentName = 'Agent',
}: {
  sessionId: string;
  alive: boolean;
  target?: 'agent' | 'shell';
  agentName?: string;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState('');

  async function doAction(action: string) {
    if (!confirming || confirming !== action) {
      setConfirming(action);
      return;
    }
    setConfirming(null);
    setActionStatus('');
    try {
      if (target === 'shell') {
        if (action === 'interrupt') await api.interruptShell(sessionId);
        else if (action === 'terminate') await api.terminateShell(sessionId);
        else if (action === 'killtree') await api.killShellTree(sessionId);
      } else {
        if (action === 'interrupt') await api.interrupt(sessionId);
        else if (action === 'terminate') await api.terminate(sessionId);
        else if (action === 'killtree') await api.killTree(sessionId);
      }
      const msg = action === 'interrupt' ? 'interrupt sent' : action === 'terminate' ? 'stop sent' : 'kill sent';
      setActionStatus(msg);
      showToast(msg, 'success');
    } catch (e: unknown) {
      const msg = (e as Error).message || 'action failed';
      setActionStatus(msg);
      showToast(msg, 'error');
    }
  }

  if (!alive) return null;
  const noun = target === 'shell' ? 'Terminal' : agentName;

  return (
    <div className="control-bar">
      <button
        className={`btn-ctrl ${confirming === 'interrupt' ? 'confirm' : ''}`}
        onClick={() => doAction('interrupt')}
      >
        {confirming === 'interrupt' ? '⚡ Confirm Ctrl+C' : '⌃C Interrupt'}
      </button>
      <button
        className={`btn-ctrl btn-warn ${confirming === 'terminate' ? 'confirm' : ''}`}
        onClick={() => doAction('terminate')}
      >
        {confirming === 'terminate' ? '⚡ Confirm Stop' : `◼ Stop ${noun}`}
      </button>
      <button
        className={`btn-ctrl btn-danger ${confirming === 'killtree' ? 'confirm' : ''}`}
        onClick={() => doAction('killtree')}
      >
        {confirming === 'killtree' ? '💀 Confirm Kill' : '☠ Kill Tree'}
      </button>
      {confirming && (
        <button className="btn-ghost btn-sm" onClick={() => setConfirming(null)}>cancel</button>
      )}
      {actionStatus && <span className="control-status">{actionStatus}</span>}
    </div>
  );
}
