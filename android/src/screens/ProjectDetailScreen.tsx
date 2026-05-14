import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  ListRenderItemInfo,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CodexConversation, RootStackParamList, RepoContext, Session } from '../types';
import { Colors, Fonts, Radius, statusColor } from '../theme';
import { api } from '../api';
import { timeSince } from '../utils';
import { StatusDot, AccentButton, GhostButton } from '../components/ui';

type Props = NativeStackScreenProps<RootStackParamList, 'ProjectDetail'>;

export default function ProjectDetailScreen({ route, navigation }: Props) {
  const { project } = route.params;
  const [sessions, setSessions] = useState<Session[]>(project.sessions ?? []);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [context, setContext] = useState<RepoContext | null>(null);
  const [contextError, setContextError] = useState('');
  const [codexConversations, setCodexConversations] = useState<CodexConversation[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [resumingId, setResumingId] = useState('');

  useFocusEffect(
    useCallback(() => {
      api.getProject(project.id)
        .then(p => setSessions(p.sessions ?? []))
        .catch(() => {});
      setHistoryLoading(true);
      api.getCodexConversations(project.id)
        .then(items => {
          setCodexConversations(items);
          setHistoryError('');
        })
        .catch(e => setHistoryError((e as Error).message))
        .finally(() => setHistoryLoading(false));
      api.getRepoContext(project.id)
        .then(c => {
          setContext(c);
          setContextError('');
        })
        .catch(e => setContextError((e as Error).message));
    }, [project.id]),
  );

  async function handleStart() {
    setStartError('');
    setStarting(true);
    try {
      const session = await api.createSession({
        projectId: project.id,
        title: newTitle.trim() || undefined,
        initialPrompt: newPrompt.trim() || undefined,
      });
      setSessions(ss => [session, ...ss]);
      setShowNew(false);
      setNewTitle('');
      setNewPrompt('');
      navigation.push('Session', { session });
    } catch (e: unknown) {
      setStartError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function handleResume(conversation: CodexConversation) {
    setHistoryError('');
    setResumingId(conversation.id);
    try {
      const session = await api.resumeCodexConversation(project.id, conversation.id);
      setSessions(ss => [session, ...ss]);
      navigation.push('Session', { session });
    } catch (e: unknown) {
      setHistoryError((e as Error).message);
    } finally {
      setResumingId('');
    }
  }

  function renderCodexConversation(item: CodexConversation) {
    return (
      <View key={item.id} style={styles.sessionCard}>
        <View style={styles.sessionHeader}>
          <View style={[styles.codexDot]} />
          <Text style={styles.sessionTitle} numberOfLines={1}>
            {item.threadName}
          </Text>
          <TouchableOpacity
            style={styles.resumeButton}
            onPress={() => handleResume(item)}
            disabled={resumingId === item.id}
            activeOpacity={0.75}>
            <Text style={styles.resumeButtonText}>
              {resumingId === item.id ? 'Resuming...' : 'Resume'}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.sessionMeta}>
          Updated {timeSince(item.updatedAt)}  ·  {item.id.slice(0, 8)}
          {item.source ? `  ·  ${item.source}` : ''}
        </Text>
      </View>
    );
  }

  function renderSession({ item }: ListRenderItemInfo<Session>) {
    return (
      <TouchableOpacity
        style={styles.sessionCard}
        onPress={() => navigation.push('Session', { session: item })}
        activeOpacity={0.75}>
        <View style={styles.sessionHeader}>
          <StatusDot status={item.status} size={8} />
          <Text style={styles.sessionTitle} numberOfLines={1}>
            {item.title ?? item.id.slice(0, 14)}
          </Text>
          <Text style={[styles.sessionStatus, { color: statusColor(item.status) }]}>
            {item.alive ? 'open now' : item.status}
          </Text>
        </View>
        <Text style={styles.sessionMeta}>
          {item.alive ? 'Agent is active' : 'Saved history'}  ·  Started {timeSince(item.startedAt)}
          {item.endedAt ? `  ·  Ended ${timeSince(item.endedAt)}` : ''}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Path */}
      <View style={styles.pathBar}>
        <View style={styles.projectInfo}>
          <Text style={styles.pathText} numberOfLines={2}>{project.repoPath}</Text>
        </View>
        <AccentButton label="+ Session" onPress={() => setShowNew(true)} small />
      </View>

      <FlatList
        data={sessions}
        keyExtractor={s => s.id}
        renderItem={renderSession}
        ListHeaderComponent={
          <View style={styles.contextSection}>
            <Text style={styles.sectionTitle}>CONTEXT</Text>
            {contextError !== '' && <Text style={styles.contextError}>{contextError}</Text>}
            {context ? (
              <View style={styles.contextCard}>
                <View style={styles.contextMeta}>
                  <Text style={styles.contextTag}>{context.branch}</Text>
                  <Text style={[
                    styles.contextTag,
                    context.changedFilesCount > 0 && styles.contextTagWarn,
                  ]}>
                    {context.changedFilesCount > 0 ? `${context.changedFilesCount} changed` : 'clean'}
                  </Text>
                  {context.project.lastUpdate && (
                    <Text style={styles.contextMetaMuted}>{timeSince(context.project.lastUpdate)}</Text>
                  )}
                </View>

                {(project.developmentPlan || project.nextStep) && (
                  <View style={styles.intentBlock}>
                    {project.developmentPlan && (
                      <Text style={styles.intentText}>{project.developmentPlan}</Text>
                    )}
                    {project.nextStep && (
                      <Text style={styles.nextStep}>Next: {project.nextStep}</Text>
                    )}
                  </View>
                )}

                <Text style={styles.commitsTitle}>LAST COMMITS</Text>
                {context.lastCommits.length > 0 ? (
                  context.lastCommits.slice(0, 5).map(commit => (
                    <View key={commit.hash} style={styles.commitRow}>
                      <Text style={styles.commitHash}>{commit.hash}</Text>
                      <View style={styles.commitBody}>
                        <Text style={styles.commitSubject} numberOfLines={1}>{commit.subject}</Text>
                        <Text style={styles.commitMeta} numberOfLines={1}>
                          {commit.author}{commit.date ? ` · ${timeSince(commit.date)}` : ''}
                        </Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.contextMuted}>No commits available</Text>
                )}
              </View>
            ) : (
              contextError === '' && <Text style={styles.contextMuted}>Loading context...</Text>
            )}
            <Text style={styles.sectionTitle}>CODEX SESSION HISTORY</Text>
            {historyError !== '' && <Text style={styles.contextError}>{historyError}</Text>}
            {historyLoading && <Text style={styles.contextMuted}>Loading Codex conversations...</Text>}
            {!historyLoading && codexConversations.map(renderCodexConversation)}
            {!historyLoading && codexConversations.length === 0 && (
              <Text style={styles.contextMuted}>No resumable Codex conversations found for this repo.</Text>
            )}
            <Text style={styles.sectionTitle}>REMOTE RUNS</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No remote runs yet.{'\n'}Tap "+ Session" to start Codex.</Text>
          </View>
        }
      />

      {/* New session modal */}
      <Modal
        visible={showNew}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowNew(false)}>
        <ScrollView
          style={styles.modal}
          contentContainerStyle={styles.modalContent}
          keyboardShouldPersistTaps="handled">
          <Text style={styles.modalTitle}>New Session</Text>
          <Text style={styles.modalProject}>{project.name}</Text>

          <Text style={styles.fieldLabel}>Title (optional)</Text>
          <TextInput
            style={styles.fieldInput}
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="e.g. Fix AGENTS.md path issue"
            placeholderTextColor={Colors.textDim}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Initial prompt (optional)</Text>
          <TextInput
            style={[styles.fieldInput, styles.fieldTextarea]}
            value={newPrompt}
            onChangeText={setNewPrompt}
            placeholder="What should Codex do first?"
            placeholderTextColor={Colors.textDim}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            textAlignVertical="top"
            numberOfLines={4}
          />

          {startError !== '' && <Text style={styles.startError}>{startError}</Text>}

          <View style={styles.modalActions}>
            <GhostButton label="Cancel" onPress={() => setShowNew(false)} />
            <AccentButton
              label={starting ? 'Starting…' : 'Start Codex'}
              onPress={handleStart}
              loading={starting}
            />
          </View>
        </ScrollView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  pathBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  projectInfo: {
    flex: 1,
    gap: 8,
  },
  pathText: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: Colors.textDim,
  },
  nextStep: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.accent,
  },
  sessionCard: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sessionTitle: {
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: 14,
    color: Colors.textBright,
  },
  sessionStatus: {
    fontFamily: Fonts.mono,
    fontSize: 11,
  },
  sessionMeta: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.textDim,
  },
  codexDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3b82f6',
  },
  resumeButton: {
    borderRadius: Radius.sm,
    backgroundColor: '#3b82f6',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  resumeButtonText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 12,
    color: '#fff',
  },
  contextSection: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sectionTitle: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.textDim,
    letterSpacing: 1.5,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  contextCard: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
  },
  contextMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  contextTag: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.accent,
    backgroundColor: Colors.accentDim,
    borderRadius: Radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  contextTagWarn: {
    color: Colors.warn,
    backgroundColor: 'rgba(255,215,0,0.12)',
  },
  contextMuted: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.textDim,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  contextMetaMuted: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.textDim,
  },
  contextError: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.danger,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  intentBlock: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.bgElevated,
    padding: 10,
    gap: 6,
  },
  intentText: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.text,
  },
  commitsTitle: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: Colors.textDim,
  },
  commitRow: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'flex-start',
  },
  commitHash: {
    width: 56,
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: Colors.textDim,
  },
  commitBody: { flex: 1 },
  commitSubject: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.textBright,
  },
  commitMeta: {
    marginTop: 2,
    fontFamily: Fonts.sans,
    fontSize: 11,
    color: Colors.textDim,
  },
  empty: { padding: 48, alignItems: 'center' },
  emptyText: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    color: Colors.textDim,
    textAlign: 'center',
    lineHeight: 22,
  },
  modal: { flex: 1, backgroundColor: Colors.bgCard },
  modalContent: { padding: 24, gap: 10 },
  modalTitle: {
    fontFamily: Fonts.sansMedium,
    fontWeight: '700',
    fontSize: 20,
    color: Colors.textBright,
    marginBottom: 2,
  },
  modalProject: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    color: Colors.accent,
    marginBottom: 20,
  },
  fieldLabel: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.textDim,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  fieldInput: {
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: Colors.borderBright,
    borderRadius: Radius.md,
    color: Colors.textBright,
    fontFamily: Fonts.mono,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fieldTextarea: { minHeight: 100, textAlignVertical: 'top' },
  startError: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    color: Colors.danger,
    marginTop: 8,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 20,
  },
});
