import React, { useState, useEffect } from 'react';
import { Plan } from '../types';
import { api } from '../api';
import { timeSince } from '../utils';
import { showToast } from './Toast';

export function PlanEditor({ sessionId }: { sessionId: string }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [activePlanId, setActivePlanId] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.getPlans(sessionId).then(setPlans).catch(err => {
      console.error('Failed to load plans:', err);
    });
  }, [sessionId]);

  const latestPlan = plans[0];

  function startNew() {
    setEditText(latestPlan?.editedText || latestPlan?.originalText || '');
    setActivePlanId(latestPlan?.id);
    setEditing(true);
  }

  async function handleSave() {
    setSending(true);
    try {
      if (activePlanId) {
        const updated = await api.updatePlan(activePlanId, { editedText: editText });
        setPlans(ps => ps.map(p => p.id === updated.id ? updated : p));
      } else {
        const plan = await api.createPlan(sessionId, { originalText: editText });
        setPlans(ps => [plan, ...ps]);
        setActivePlanId(plan.id);
      }
      setStatus('Saved');
      showToast('Plan saved', 'success');
    } catch (err) {
      setStatus('Save failed');
      showToast((err as Error).message || 'Save failed', 'error');
    } finally {
      setSending(false);
    }
  }

  async function doSendAction(action: string) {
    setSending(true);
    try {
      await api.sendPlan(sessionId, {
        planId: activePlanId,
        text: editText,
        action,
      });
      setStatus('Sent to Codex');
      setEditing(false);
      showToast('Plan sent to Codex', 'success');
      if (activePlanId) {
        setPlans(ps => ps.map(p => p.id === activePlanId ? { ...p, status: 'sent' } : p));
      }
    } catch (err) {
      setStatus('Send failed');
      showToast((err as Error).message || 'Send failed', 'error');
    } finally {
      setSending(false);
    }
  }

  async function handleSchedule() {
    setSending(true);
    try {
      await api.scheduleMessage(sessionId, { text: editText, delayMs: 2 * 60 * 60 * 1000 });
      setStatus('Scheduled for 2 hours from now');
      setEditing(false);
      showToast('Scheduled for 2 hours from now', 'success');
    } catch (err) {
      setStatus('Schedule failed');
      showToast((err as Error).message || 'Schedule failed', 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="plan-panel">
      <div className="plan-header">
        <span className="plan-title">Plan</span>
        <button className="btn-ghost btn-sm" onClick={startNew}>
          {latestPlan ? 'Edit Plan' : '+ New Plan'}
        </button>
      </div>

      {!editing && latestPlan && (
        <div className="plan-preview">
          <div className="plan-status-row">
            <span className={`plan-badge ${latestPlan.status}`}>{latestPlan.status}</span>
            <span className="meta-muted">{timeSince(latestPlan.updatedAt)}</span>
          </div>
          <pre className="plan-text">{latestPlan.editedText || latestPlan.originalText}</pre>
        </div>
      )}

      {editing && (
        <div className="plan-editor">
          <textarea
            className="plan-textarea"
            value={editText}
            onChange={e => setEditText(e.target.value)}
            placeholder="Paste or write the plan here…"
            rows={8}
          />
          <div className="plan-actions-grid">
            <button className="btn-plan-action" onClick={handleSave} disabled={sending}>Save</button>
            <button className="btn-plan-action secondary" onClick={handleSchedule} disabled={sending}>
              🕒 Schedule (2h)
            </button>
            <button className="btn-plan-action btn-send-plan" onClick={() => doSendAction('revise')} disabled={sending}>
              Send Revised
            </button>
            <button className="btn-plan-action" onClick={() => doSendAction('approve')} disabled={sending}>
              ✓ Approve
            </button>
            <button className="btn-plan-action" onClick={() => doSendAction('step1')} disabled={sending}>
              Step 1 only
            </button>
            <button className="btn-plan-action btn-danger" onClick={() => doSendAction('stop')} disabled={sending}>
              Stop &amp; Summarize
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          {status && <div className="plan-status-msg">{status}</div>}
        </div>
      )}

      {!editing && !latestPlan && (
        <div className="plan-empty">No plan yet. Save terminal text as a plan or paste one.</div>
      )}
    </div>
  );
}
