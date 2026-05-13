import React, { useState, useEffect, useCallback } from 'react';
import { ChangedFile, DiffResult, RepoFileEntry, RepoFileContent } from '../types';
import { api } from '../api';
import { copyText, fileStatusBadge, fileStatusColor } from '../utils';

function RepoBrowser({ sessionId }: { sessionId: string }) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<RepoFileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<RepoFileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');

  const loadTree = useCallback(async (repoPath: string) => {
    setLoading(true);
    setError('');
    try {
      const tree = await api.getRepoTree(sessionId, repoPath);
      setCurrentPath(tree.path);
      setEntries(tree.entries);
      setSelectedFile(null);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { void loadTree(''); }, [loadTree]);

  async function openEntry(entry: RepoFileEntry) {
    if (entry.type === 'directory') {
      await loadTree(entry.path);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setSelectedFile(await api.getRepoFile(sessionId, entry.path));
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function copyFileContent() {
    const ok = await copyText(selectedFile?.content ?? '');
    setCopyStatus(ok ? 'copied' : 'copy failed');
    setTimeout(() => setCopyStatus(''), 1400);
  }

  const parentPath = currentPath.split('/').slice(0, -1).join('/');

  return (
    <div className="repo-browser">
      <div className="files-header">
        <span className="files-title">Repository</span>
        <span className="branch-tag">{currentPath || '/'}</span>
        {currentPath && <button className="btn-link btn-sm" onClick={() => loadTree(parentPath)}>up</button>}
      </div>
      {error && <div className="error-banner compact">{error}</div>}
      {loading && <div className="diff-loading">Loading…</div>}
      <div className="repo-browser-grid">
        <div className="repo-entry-list">
          {entries.map(entry => (
            <button
              key={entry.path}
              className={`repo-entry ${selectedFile?.path === entry.path ? 'active' : ''}`}
              onClick={() => openEntry(entry)}
            >
              <span className="repo-entry-kind">{entry.type === 'directory' ? 'dir' : 'file'}</span>
              <span className="repo-entry-name">{entry.name}</span>
            </button>
          ))}
          {!loading && entries.length === 0 && <div className="files-empty compact">Empty directory</div>}
        </div>
        <div className="file-viewer">
          {selectedFile ? (
            <>
              <div className="file-viewer-header">
                <span className="file-viewer-title">{selectedFile.path}</span>
                <button className="btn-link btn-sm" onClick={() => copyText(selectedFile.path)}>copy path</button>
                {!selectedFile.isBinary && <button className="btn-link btn-sm" onClick={copyFileContent}>copy file</button>}
                {copyStatus && <span className="copy-status">{copyStatus}</span>}
              </div>
              {selectedFile.isBinary ? (
                <div className="files-empty compact">Binary file preview is not available</div>
              ) : (
                <pre className="file-viewer-content">{selectedFile.content}</pre>
              )}
              {selectedFile.isTruncated && <div className="diff-truncated">File truncated</div>}
            </>
          ) : (
            <div className="files-empty compact">Select a file to preview</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function FilesPanel({
  sessionId,
  initialFiles,
  branch,
}: {
  sessionId: string;
  initialFiles?: ChangedFile[];
  branch?: string;
}) {
  const [files, setFiles] = useState<ChangedFile[]>(initialFiles || []);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [showFullDiff, setShowFullDiff] = useState(false);

  useEffect(() => {
    if (initialFiles) setFiles(initialFiles);
  }, [initialFiles]);

  async function loadDiff(filePath: string) {
    if (expanded === filePath) { setExpanded(null); setDiff(null); return; }
    setExpanded(filePath);
    setDiff(null);
    setLoadingDiff(true);
    try {
      const d = await api.getFileDiff(sessionId, filePath);
      setDiff(d);
    } catch (err) {
      console.error('Failed to load diff:', err);
    } finally {
      setLoadingDiff(false);
    }
  }

  return (
    <div className="files-panel">
      <RepoBrowser sessionId={sessionId} />
      <div className="files-header">
        <span className="files-title">Changed Files</span>
        {branch && <span className="branch-tag">{branch}</span>}
        <span className="files-count">{files.length}</span>
      </div>
      {files.length === 0 && <div className="files-empty compact">No changed files</div>}
      {files.map(f => (
        <div key={f.path} className="file-item">
          <div className="file-row" onClick={() => loadDiff(f.path)}>
            <span className="file-status" style={{ color: fileStatusColor(f.status) }}>
              {fileStatusBadge(f.status)}
            </span>
            <span className="file-path">{f.path}</span>
            <span className="file-stat">
              {f.additions != null && <span className="add">+{f.additions}</span>}
              {f.deletions != null && <span className="del">-{f.deletions}</span>}
              {f.isLarge && <span className="large-tag">large</span>}
            </span>
            <span className="chevron">{expanded === f.path ? '▾' : '›'}</span>
          </div>
          {expanded === f.path && (
            <div className="diff-container">
              {loadingDiff && <div className="diff-loading">Loading diff…</div>}
              {diff && (
                <>
                  {diff.isLarge && !showFullDiff ? (
                    <div className="diff-large-notice">
                      Large diff ({diff.lineCount} lines).{' '}
                      <button className="btn-link" onClick={() => setShowFullDiff(true)}>Load anyway</button>
                    </div>
                  ) : (
                    <pre className="diff-content">{diff.content || '(no diff available)'}</pre>
                  )}
                  {diff.isTruncated && <div className="diff-truncated">⚠ Diff truncated</div>}
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
