import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Session, ChangedFile, ScheduledMessage } from '../types';
import { Colors, Fonts, statusColor } from '../theme';
import { api } from '../api';
import { elapsed, noOutputWarning, timeSince } from '../utils';
import { useSessionStream } from '../useSessionStream';
import Terminal, { TerminalHandle } from '../components/Terminal';
import InputBar from '../components/InputBar';
import ControlBar from '../components/ControlBar';
import FilesPanel from '../components/FilesPanel';
import PlanEditor from '../components/PlanEditor';
import { StatusDot } from '../components/ui';

type Props = NativeStackScreenProps<RootStackParamList, 'Session'>;
type Tab = 'agent' | 'terminal' | 'files' | 'plan';

export default function SessionScreen({ route, navigation }: Props) {
  const { session: initialSession } = route.params;
  const [session, setSession] = useState<Session>(initialSession);
  const [tab, setTab] = useState<Tab>('agent');
  const [alive, setAlive] = useState(initialSession.alive ?? false);
  const [terminalAlive, setTerminalAlive] = useState(initialSession.terminalAlive ?? false);
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([]);
  const [branch, setBranch] = useState('');
  const agentTerminalRef = useRef<TerminalHandle>(null);
  const shellTerminalRef = useRef<TerminalHandle>(null);

  const fetchScheduled = useCallback(() => {
    api.getScheduledMessages(session.id).then(setScheduled).catch(() => {});
  }, [session.id]);

  // Refresh session metadata on mount
  useEffect(() => {
    api.getSession(session.id)
      .then(s => {
        setSession(s);
        setAlive(s.alive ?? false);
        setTerminalAlive(s.terminalAlive ?? false);
      })
      .catch(() => {});
    fetchScheduled();
    const interval = setInterval(fetchScheduled, 10000);
    return () => clearInterval(interval);
  }, [session.id, fetchScheduled]);

  async function cancelAllScheduled() {
    const pending = scheduled;
    setScheduled([]);
    try {
      await Promise.all(pending.map(sm => api.cancelScheduledMessage(session.id, sm.id)));
      fetchScheduled();
    } catch {
      setScheduled(pending);
    }
  }

  // Update nav title
  useEffect(() => {
    navigation.setOptions({
      title: session.title ?? session.id.slice(0, 14),
    });
  }, [navigation, session.title, session.id]);

  const handleOutput = useCallback((data: string) => {
    agentTerminalRef.current?.appendOutput(data);
  }, []);

  const handleScrollback = useCallback((lines: string[]) => {
    agentTerminalRef.current?.setScrollback(lines);
  }, []);

  const handleExit = useCallback(({ status }: { exitCode: number | null; status: string }) => {
    setAlive(false);
    setSession(s => ({ ...s, status: status as Session['status'] }));
    agentTerminalRef.current?.appendLine(`\n[session ${status}]`);
  }, []);

  const handleShellOutput = useCallback((data: string) => {
    shellTerminalRef.current?.appendOutput(data);
  }, []);

  const handleShellScrollback = useCallback((lines: string[]) => {
    shellTerminalRef.current?.setScrollback(lines);
  }, []);

  const handleShellExit = useCallback(({ status }: { exitCode: number | null; status: string }) => {
    setTerminalAlive(false);
    shellTerminalRef.current?.appendLine(`\n[terminal ${status}]`);
  }, []);

  const handleGitStatus = useCallback((files: ChangedFile[], br: string) => {
    setChangedFiles(files);
    setBranch(br);
  }, []);

  const handleConnected = useCallback((isAlive: boolean, st: string) => {
    setAlive(isAlive);
    setSession(s => ({ ...s, status: st as Session['status'] }));
  }, []);

  const { connected } = useSessionStream({
    sessionId: session.id,
    onOutput: handleOutput,
    onScrollback: handleScrollback,
    onExit: handleExit,
    onGitStatus: handleGitStatus,
    onConnected: handleConnected,
  });

  const { connected: terminalConnected } = useSessionStream({
    sessionId: session.id,
    channel: 'shell',
    onOutput: handleShellOutput,
    onScrollback: handleShellScrollback,
    onExit: handleShellExit,
    onConnected: (isAlive) => setTerminalAlive(isAlive),
  });

  const noOutput = noOutputWarning(session.lastOutputAt);

  return (
    <View style={styles.screen}>
      {/* Status bar */}
      <View style={styles.statusBar}>
        <StatusDot status={session.status} size={7} />
        <Text style={[styles.statusText, { color: statusColor(session.status) }]}>
          {session.status}
        </Text>
        <Text style={styles.statusSep}>·</Text>
        <Text style={styles.statusDim}>{elapsed(session.startedAt)}</Text>
        {session.lastOutputAt && (
          <>
            <Text style={styles.statusSep}>·</Text>
            <Text style={styles.statusDim}>out {timeSince(session.lastOutputAt)}</Text>
          </>
        )}
        {noOutput && (
          <View style={styles.noOutputBadge}>
            <Text style={styles.noOutputText}>⚠ {noOutput} silent</Text>
          </View>
        )}
        {!connected && (
          <Text style={styles.reconnectingText}>agent reconnecting…</Text>
        )}
        {tab === 'terminal' && !terminalConnected && (
          <Text style={styles.reconnectingText}>terminal reconnecting…</Text>
        )}
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TabBtn label="Agent" tab="agent" active={tab} onPress={setTab} />
        <TabBtn label="Terminal" tab="terminal" active={tab} onPress={setTab} />
        <TabBtn
          label={`Files${changedFiles.length > 0 ? ` (${changedFiles.length})` : ''}`}
          tab="files"
          active={tab}
          onPress={setTab}
        />
        <TabBtn label="Plan" tab="plan" active={tab} onPress={setTab} />
      </View>

      {scheduled.length > 0 && (
        <View style={styles.scheduledBanner}>
          <Text style={styles.scheduledText}>
            {scheduled.length} scheduled message{scheduled.length > 1 ? 's' : ''} pending
          </Text>
          <TouchableOpacity onPress={cancelAllScheduled} style={styles.cancelScheduledBtn}>
            <Text style={styles.cancelScheduledText}>Cancel All</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Tab content */}
      <View style={styles.tabContent}>
        {/* Agent and Terminal tabs stay mounted to preserve output buffers. */}
        <View style={[styles.tabPane, tab !== 'agent' && styles.hidden]}>
          <View style={styles.agentToolbar}>
            <Text style={styles.agentToolbarTitle}>Agent workspace</Text>
            {branch !== '' && <Text style={styles.agentToolbarBadge}>{branch}</Text>}
            <Text style={[
              styles.agentToolbarBadge,
              changedFiles.length > 0 && styles.agentToolbarWarn,
            ]}>
              {changedFiles.length > 0 ? `${changedFiles.length} changed` : 'clean'}
            </Text>
          </View>
          <Terminal ref={agentTerminalRef} alive={alive} connected={connected} label="AGENT OUTPUT" />
          <InputBar sessionId={session.id} disabled={!alive} target="agent" placeholder="Send instruction to Codex…" />
          <ControlBar sessionId={session.id} alive={alive} target="agent" />
        </View>

        <View style={[styles.tabPane, tab !== 'terminal' && styles.hidden]}>
          <Terminal ref={shellTerminalRef} alive={terminalAlive} connected={terminalConnected} label="TERMINAL" />
          <InputBar
            sessionId={session.id}
            disabled={!terminalAlive}
            target="shell"
            placeholder="Run shell command…"
            allowSchedule={false}
          />
          <ControlBar sessionId={session.id} alive={terminalAlive} target="shell" />
        </View>

        {tab === 'files' && (
          <FilesPanel
            sessionId={session.id}
            files={changedFiles}
            branch={branch}
          />
        )}

        {tab === 'plan' && (
          <PlanEditor sessionId={session.id} />
        )}
      </View>
    </View>
  );
}

function TabBtn({
  label,
  tab,
  active,
  onPress,
}: {
  label: string;
  tab: Tab;
  active: Tab;
  onPress: (t: Tab) => void;
}) {
  const isActive = tab === active;
  return (
    <TouchableOpacity
      style={[styles.tabBtn, isActive && styles.tabBtnActive]}
      onPress={() => onPress(tab)}
      activeOpacity={0.8}>
      <Text style={[styles.tabBtnText, isActive && styles.tabBtnTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    flexWrap: 'wrap',
  },
  statusText: {
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
  statusSep: { color: Colors.borderBright, fontSize: 12 },
  statusDim: { fontFamily: Fonts.sans, fontSize: 12, color: Colors.textDim },
  noOutputBadge: {
    backgroundColor: 'rgba(255,215,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.25)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  noOutputText: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.warn,
  },
  reconnectingText: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.warn,
    marginLeft: 'auto',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabBtnActive: {
    borderBottomColor: Colors.accent,
  },
  tabBtnText: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textDim,
  },
  tabBtnTextActive: {
    color: Colors.accent,
  },
  tabContent: { flex: 1 },
  scheduledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,255,157,0.28)',
    backgroundColor: Colors.accentDim,
  },
  scheduledText: {
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: Colors.accent,
  },
  cancelScheduledBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,255,157,0.35)',
    borderRadius: 4,
  },
  cancelScheduledText: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    color: Colors.accent,
  },
  tabPane: { flex: 1 },
  agentToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.bgCard,
  },
  agentToolbarTitle: {
    flex: 1,
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textBright,
  },
  agentToolbarBadge: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.accent,
    backgroundColor: Colors.accentDim,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  agentToolbarWarn: {
    color: Colors.warn,
    backgroundColor: 'rgba(255,215,0,0.12)',
  },
  hidden: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
    pointerEvents: 'none',
  },
});
