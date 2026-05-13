import React, { useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { Colors } from '../theme';
import { CtrlButton, GhostButton } from './ui';
import { api } from '../api';

const haptic = () =>
  ReactNativeHapticFeedback.trigger('impactMedium', {
    enableVibrateFallback: true,
    ignoreAndroidSystemSettings: false,
  });

const hapticHeavy = () =>
  ReactNativeHapticFeedback.trigger('impactHeavy', {
    enableVibrateFallback: true,
    ignoreAndroidSystemSettings: false,
  });

interface ControlBarProps {
  sessionId: string;
  alive: boolean;
  target?: 'agent' | 'shell';
}

type ConfirmAction = 'interrupt' | 'terminate' | 'killtree' | null;

export default function ControlBar({ sessionId, alive, target = 'agent' }: ControlBarProps) {
  const [confirming, setConfirming] = useState<ConfirmAction>(null);
  const [statusMsg, setStatusMsg] = useState('');

  async function handlePress(action: 'interrupt' | 'terminate' | 'killtree') {
    if (confirming !== action) {
      haptic();
      setConfirming(action);
      // Auto-cancel confirm after 3s
      setTimeout(() => setConfirming(c => (c === action ? null : c)), 3000);
      return;
    }
    hapticHeavy();
    setConfirming(null);
    setStatusMsg('');
    try {
      if (target === 'shell') {
        if (action === 'interrupt') await api.interruptShell(sessionId);
        else if (action === 'terminate') await api.terminateShell(sessionId);
        else await api.killShellTree(sessionId);
      } else {
        if (action === 'interrupt') await api.interrupt(sessionId);
        else if (action === 'terminate') await api.terminate(sessionId);
        else await api.killTree(sessionId);
      }
      setStatusMsg(action === 'interrupt' ? 'interrupt sent' : action === 'terminate' ? 'stop sent' : 'kill sent');
    } catch (e: unknown) {
      setStatusMsg((e as Error).message || 'action failed');
    }
  }

  if (!alive) return null;
  const noun = target === 'shell' ? 'Terminal' : 'Codex';

  return (
    <View style={styles.container}>
      <CtrlButton
        label={confirming === 'interrupt' ? '⚡ Confirm Ctrl+C' : '⌃C  Interrupt'}
        onPress={() => handlePress('interrupt')}
        variant="default"
        confirming={confirming === 'interrupt'}
      />
      <CtrlButton
        label={confirming === 'terminate' ? '⚡ Confirm Stop' : `◼  Stop ${noun}`}
        onPress={() => handlePress('terminate')}
        variant="warn"
        confirming={confirming === 'terminate'}
      />
      <CtrlButton
        label={confirming === 'killtree' ? '💀 Confirm Kill' : '☠  Kill Tree'}
        onPress={() => handlePress('killtree')}
        variant="danger"
        confirming={confirming === 'killtree'}
      />
      {confirming && (
        <GhostButton
          label="cancel"
          onPress={() => setConfirming(null)}
          small
          color={Colors.textDim}
        />
      )}
      {statusMsg !== '' && <Text style={styles.statusMsg}>{statusMsg}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bg,
    alignItems: 'center',
  },
  statusMsg: {
    width: '100%',
    fontSize: 11,
    color: Colors.accent,
  },
});
