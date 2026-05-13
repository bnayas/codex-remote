import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Clipboard,
} from 'react-native';
import { Colors, Fonts, Radius } from '../theme';
import { ChangedFile, DiffResult, RepoFileContent } from '../types';
import { api } from '../api';
import { fileStatusColor } from '../utils';
import { SectionHeader, GhostButton } from './ui';

interface FilesPanelProps {
  sessionId: string;
  files: ChangedFile[];
  branch: string;
}

function FileRow({
  file,
  sessionId,
}: {
  file: ChangedFile;
  sessionId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [fileContent, setFileContent] = useState<RepoFileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [showLarge, setShowLarge] = useState(false);
  const [showFile, setShowFile] = useState(false);

  const toggle = useCallback(async () => {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (!diff) {
      setLoading(true);
      try {
        const d = await api.getFileDiff(sessionId, file.path);
        setDiff(d);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    }
  }, [expanded, diff, sessionId, file.path]);

  const viewFile = useCallback(async () => {
    setShowFile(true);
    if (fileContent) return;
    setLoadingFile(true);
    try {
      setFileContent(await api.getRepoFile(sessionId, file.path));
    } catch { /* ignore */ } finally {
      setLoadingFile(false);
    }
  }, [fileContent, sessionId, file.path]);

  const statusColor = fileStatusColor(file.status);

  return (
    <View style={styles.fileItem}>
      <TouchableOpacity style={styles.fileRow} onPress={toggle} activeOpacity={0.7}>
        <Text style={[styles.fileStatus, { color: statusColor }]}>{file.status}</Text>
        <Text style={styles.filePath} numberOfLines={2}>{file.path}</Text>
        <View style={styles.fileStat}>
          {file.additions != null && (
            <Text style={styles.add}>+{file.additions}</Text>
          )}
          {file.deletions != null && (
            <Text style={styles.del}>-{file.deletions}</Text>
          )}
          {file.isLarge && <Text style={styles.largeTag}>large</Text>}
        </View>
        <Text style={styles.chevron}>{expanded ? '▾' : '›'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.diffContainer}>
          {loading && (
            <View style={styles.diffLoading}>
              <ActivityIndicator color={Colors.accent} size="small" />
              <Text style={styles.diffLoadingText}>Loading diff…</Text>
            </View>
          )}
          {diff && !loading && (
            <>
              <View style={styles.diffActions}>
                <GhostButton label="View file" onPress={viewFile} small />
                <GhostButton label="Copy path" onPress={() => Clipboard.setString(file.path)} small />
              </View>
              {diff.isLarge && !showLarge ? (
                <View style={styles.largeNotice}>
                  <Text style={styles.largeNoticeText}>
                    Large diff ({diff.lineCount} lines).{' '}
                  </Text>
                  <GhostButton label="Load anyway" onPress={() => setShowLarge(true)} small />
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator>
                  <Text style={styles.diffText} selectable>
                    {diff.content || '(no diff available)'}
                  </Text>
                </ScrollView>
              )}
              {diff.isTruncated && (
                <Text style={styles.truncatedNote}>⚠ Diff truncated</Text>
              )}
              {showFile && (
                <View style={styles.filePreview}>
                  {loadingFile && (
                    <View style={styles.diffLoading}>
                      <ActivityIndicator color={Colors.accent} size="small" />
                      <Text style={styles.diffLoadingText}>Loading file…</Text>
                    </View>
                  )}
                  {fileContent && (
                    <>
                      <View style={styles.filePreviewHeader}>
                        <Text style={styles.filePreviewTitle} numberOfLines={1}>{fileContent.path}</Text>
                        {!fileContent.isBinary && (
                          <GhostButton
                            label="Copy file"
                            onPress={() => Clipboard.setString(fileContent.content)}
                            small
                          />
                        )}
                      </View>
                      {fileContent.isBinary ? (
                        <Text style={styles.truncatedNote}>Binary file preview is not available</Text>
                      ) : (
                        <ScrollView horizontal showsHorizontalScrollIndicator>
                          <Text style={styles.diffText} selectable>{fileContent.content}</Text>
                        </ScrollView>
                      )}
                      {fileContent.isTruncated && (
                        <Text style={styles.truncatedNote}>File truncated</Text>
                      )}
                    </>
                  )}
                </View>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

export default function FilesPanel({ sessionId, files, branch }: FilesPanelProps) {
  if (files.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No changed files</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator>
      <SectionHeader
        title={`${files.length} changed file${files.length === 1 ? '' : 's'}`}
        right={
          branch ? (
            <View style={styles.branchBadge}>
              <Text style={styles.branchText}>{branch}</Text>
            </View>
          ) : undefined
        }
      />
      {files.map(f => (
        <FileRow key={f.path} file={f} sessionId={sessionId} />
      ))}
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fileItem: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 10,
  },
  fileStatus: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    fontWeight: '700',
    width: 14,
    flexShrink: 0,
  },
  filePath: {
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: 12,
    color: Colors.text,
  },
  fileStat: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    flexShrink: 0,
  },
  add: { fontFamily: Fonts.mono, fontSize: 11, color: Colors.accent },
  del: { fontFamily: Fonts.mono, fontSize: 11, color: Colors.danger },
  largeTag: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.warn,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.3)',
    borderRadius: 2,
    paddingHorizontal: 3,
  },
  chevron: { color: Colors.textDim, fontSize: 16, flexShrink: 0 },
  diffContainer: {
    backgroundColor: '#060609',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    maxHeight: 300,
  },
  diffLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
  },
  diffLoadingText: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    color: Colors.textDim,
  },
  diffText: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    lineHeight: 17,
    color: Colors.text,
    padding: 10,
  },
  diffActions: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  filePreview: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  filePreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.bgCard,
  },
  filePreviewTitle: {
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: Colors.textBright,
  },
  largeNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    padding: 12,
  },
  largeNoticeText: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.warn,
  },
  truncatedNote: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: Colors.warn,
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  branchBadge: {
    backgroundColor: Colors.accentDim,
    borderRadius: Radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  branchText: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: Colors.accent,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyText: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    color: Colors.textDim,
  },
});
