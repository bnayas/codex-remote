import React, { useState } from 'react';
import { getCredentials, setCredentials, api } from '../api';

export function SetupScreen({ onConnect }: { onConnect: () => void }) {
  const { baseUrl: savedUrl, authToken: savedToken } = getCredentials();
  const [url, setUrl] = useState(savedUrl || 'http://100.117.114.128:3742');
  const [token, setToken] = useState(savedToken || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleConnect() {
    setError('');
    setLoading(true);
    setCredentials(url.trim(), token.trim());
    try {
      await api.health();
      onConnect();
    } catch {
      setError('Cannot connect. Check URL and token.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-logo">
          <span className="logo-bracket">{'{'}</span>
          <span className="logo-text">CODEX</span>
          <span className="logo-bracket">{'}'}</span>
          <div className="logo-sub">REMOTE</div>
        </div>
        <div className="setup-fields">
          <label className="field-label">Backend URL</label>
          <input
            className="field-input"
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="http://100.117.114.128:3742"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <label className="field-label">Auth Token</label>
          <input
            className="field-input"
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="your-auth-token"
          />
          {error && <div className="setup-error">{error}</div>}
          <button
            className="btn-primary btn-full"
            onClick={handleConnect}
            disabled={loading}
          >
            {loading ? 'Connecting…' : 'Connect'}
          </button>
        </div>
        <div className="setup-hint">
          Find your token in <code>~/.codex-remote/config.yaml</code>
        </div>
      </div>
    </div>
  );
}
