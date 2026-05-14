import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  ListRenderItemInfo,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Project, Session } from '../types';
import { Colors, Fonts, statusColor } from '../theme';
import { api, clearCredentials } from '../api';
import { timeSince } from '../utils';
import { StatusDot } from '../components/ui';

type Props = NativeStackScreenProps<RootStackParamList, 'Projects'>;

export default function ProjectsScreen({ navigation }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentSessions, setRecentSessions] = useState<Session[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const [ps, ss] = await Promise.all([
        api.getProjects(),
        api.getSessions(),
      ]);
      setProjects(ps);
      setRecentSessions(ss.slice(0, 8));
      setError('');
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Reload when screen focused
  useFocusEffect(useCallback(() => { void load(true); }, [load]));

  function handleDisconnect() {
    Alert.alert('Disconnect', 'Clear saved credentials?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          await clearCredentials();
          navigation.replace('Setup');
        },
      },
    ]);
  }

  function renderProject({ item }: ListRenderItemInfo<Project>) {
    const latest = item.sessions?.[0];
    return (
      <TouchableOpacity
        style={styles.projectCard}
        onPress={() => navigation.push('ProjectDetail', { project: item })}
        activeOpacity={0.75}>
        <View style={styles.projectHeader}>
          <Text style={styles.projectName}>{item.name}</Text>
          {latest && <StatusDot status={latest.status} size={9} />}
        </View>
        <Text style={styles.projectPath} numberOfLines={1}>
          {item.repoPath}
        </Text>
        {latest && (
          <View style={styles.projectMeta}>
            <Text style={[styles.statusTag, { color: statusColor(latest.status) }]}>
              {latest.status}
            </Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaDim}>last: {timeSince(latest.startedAt)}</Text>
              {latest.title && (
              <React.Fragment key="title">
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.metaDimTrunc} numberOfLines={1}>{latest.title}</Text>
              </React.Fragment>
            )}
          </View>
        )}
        {!latest && <Text style={styles.metaDim}>No remote runs yet</Text>}
      </TouchableOpacity>
    );
  }

  function renderSession({ item }: ListRenderItemInfo<Session>) {
    return (
      <TouchableOpacity
        style={styles.sessionRow}
        onPress={() => navigation.push('Session', { session: item })}
        activeOpacity={0.75}>
        <StatusDot status={item.status} size={7} />
        <View style={styles.sessionRowInfo}>
          <Text style={styles.sessionRowTitle} numberOfLines={1}>
            {item.title ?? item.id.slice(0, 12)}
          </Text>
          <Text style={styles.sessionRowMeta}>
            {item.alive ? 'open now' : 'history'} · {item.status} · {timeSince(item.startedAt)}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          <Text style={styles.headerBracket}>{'<'}</Text>
          codex-remote
          <Text style={styles.headerBracket}>{'/>'}</Text>
        </Text>
        <TouchableOpacity onPress={handleDisconnect} style={styles.disconnectBtn}>
          <Text style={styles.disconnectText}>⏏</Text>
        </TouchableOpacity>
      </View>

      {error !== '' && (
        <TouchableOpacity style={styles.errorBanner} onPress={() => load()}>
          <Text style={styles.errorText}>{error} — tap to retry</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={projects}
        keyExtractor={p => p.id}
        renderItem={renderProject}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={load}
            tintColor={Colors.accent}
          />
        }
        ListEmptyComponent={
          !refreshing ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No projects configured.{'\n'}Edit ~/.codex-remote/config.yaml</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          recentSessions.length > 0 ? (
            <View>
              <Text style={styles.sectionLabel}>
                {recentSessions.some(s => s.alive) ? 'ACTIVE SESSIONS & RECENT HISTORY' : 'RECENT SESSION HISTORY'}
              </Text>
              {recentSessions.map((s, index) => (
                <React.Fragment key={s.id}>
                  {renderSession({ item: s, index } as ListRenderItemInfo<Session>)}
                </React.Fragment>
              ))}
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: 14,
    color: Colors.accent,
    letterSpacing: 0.5,
  },
  headerBracket: { color: Colors.textDim },
  disconnectBtn: { padding: 6 },
  disconnectText: { fontSize: 20, color: Colors.textDim },
  errorBanner: {
    backgroundColor: Colors.dangerDim,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,68,68,0.2)',
    padding: 12,
  },
  errorText: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.danger },
  projectCard: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  projectName: {
    flex: 1,
    fontFamily: Fonts.sansMedium,
    fontWeight: '600',
    fontSize: 16,
    color: Colors.textBright,
  },
  projectPath: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: Colors.textDim,
    marginBottom: 6,
  },
  projectMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  statusTag: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '500',
  },
  metaDot: { color: Colors.borderBright, fontSize: 12 },
  metaDim: { fontFamily: Fonts.sans, fontSize: 12, color: Colors.textDim },
  metaDimTrunc: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.textDim,
    flex: 1,
  },
  sectionLabel: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.textDim,
    letterSpacing: 1.5,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sessionRowInfo: { flex: 1 },
  sessionRowTitle: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    color: Colors.text,
  },
  sessionRowMeta: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    color: Colors.textDim,
    marginTop: 2,
  },
  chevron: { color: Colors.textDim, fontSize: 18 },
  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    color: Colors.textDim,
    textAlign: 'center',
    lineHeight: 22,
  },
});
