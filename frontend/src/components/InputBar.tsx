import React, { useState } from 'react';
import { api } from '../api';
import { showToast } from './Toast';

export function InputBar({
  sessionId,
  disabled,
  target = 'agent',
  terminalId,
  placeholder,
  allowSchedule = true,
  onSendOptimistic,
}: {
  sessionId: string;
  disabled?: boolean;
  target?: 'agent' | 'shell';
  terminalId?: string;
  placeholder?: string;
  allowSchedule?: boolean;
  onSendOptimistic?: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      if (onSendOptimistic) onSendOptimistic(text);
      if (target === 'shell' && terminalId) await api.sendShellTerminalInput(sessionId, terminalId, text);
      else if (target === 'shell') await api.sendShellInput(sessionId, text);
      else await api.sendInput(sessionId, text);
      setText('');
    } catch (err) {
      showToast((err as Error).message || 'Failed to send input', 'error');
    } finally {
      setSending(false);
    }
  }

  async function schedule() {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await api.scheduleMessage(sessionId, { text, delayMs: 2 * 60 * 60 * 1000 });
      setText('');
      showToast('Scheduled for 2 hours from now', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Failed to schedule', 'error');
    } finally {
      setSending(false);
    }
  }

  async function pasteFromClipboard() {
    try {
      const value = await navigator.clipboard?.readText();
      if (value) setText(current => current ? `${current}\n${value}` : value);
    } catch {
      showToast('Clipboard access denied', 'error');
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div style={{
      position: 'absolute',
      bottom: '100px', // Above bottom nav
      left: '20px',
      right: '20px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '8px 12px',
      background: 'rgba(30, 30, 40, 0.7)',
      backdropFilter: 'blur(16px)',
      borderRadius: '30px',
      border: '1px solid rgba(255,255,255,0.05)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      zIndex: 60
    }}>
      {/* Microphone button (placeholder) */}
      <button style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        background: 'rgba(255,255,255,0.1)',
        border: 'none',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        color: '#fff',
        cursor: 'pointer',
        flexShrink: 0
      }}>
        🎙️
      </button>

      {/* Input Field */}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={disabled ? 'Session not active' : (placeholder || 'Type your message...')}
        disabled={disabled}
        rows={1}
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          color: '#ffffff',
          fontFamily: 'var(--sans)',
          fontSize: '15px',
          resize: 'none',
          outline: 'none',
          padding: '8px 0',
          lineHeight: '1.4',
          maxHeight: '100px'
        }}
      />

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {allowSchedule && text.trim() && (
          <button
            onClick={schedule}
            disabled={disabled || sending}
            title="Schedule to send in 2 hours"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8b8b9e',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            {sending ? '…' : '🕒'}
          </button>
        )}
        
        {/* Send Button */}
        <button
          onClick={send}
          disabled={disabled || sending || !text.trim()}
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: text.trim() ? 'var(--accent-blue)' : 'rgba(255,255,255,0.1)',
            border: 'none',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            color: '#fff',
            cursor: text.trim() ? 'pointer' : 'default',
            boxShadow: text.trim() ? '0 0 15px rgba(59, 130, 246, 0.5)' : 'none',
            transition: 'all 0.2s',
            flexShrink: 0
          }}
        >
          {sending ? '…' : '➤'}
        </button>
      </div>
    </div>
  );
}
