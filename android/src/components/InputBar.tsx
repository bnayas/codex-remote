import React, { useState, useRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Clipboard,
} from 'react-native';
import { Colors, Fonts, Radius } from '../theme';
import { api } from '../api';

interface InputBarProps {
  sessionId: string;
  disabled?: boolean;
  target?: 'agent' | 'shell';
  placeholder?: string;
  allowSchedule?: boolean;
}

export default function InputBar({
  sessionId,
  disabled,
  target = 'agent',
  placeholder,
  allowSchedule = true,
}: InputBarProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<TextInput>(null);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || sending || disabled) return;
    setSending(true);
    try {
      if (target === 'shell') await api.sendShellInput(sessionId, trimmed);
      else await api.sendInput(sessionId, trimmed);
      setText('');
    } catch { /* ignore */ } finally {
      setSending(false);
    }
  }

  async function schedule() {
    const trimmed = text.trim();
    if (!trimmed || sending || disabled) return;
    setSending(true);
    try {
      await api.scheduleMessage(sessionId, { text: trimmed, delayMs: 2 * 60 * 60 * 1000 });
      setText('');
    } catch { /* ignore */ } finally {
      setSending(false);
    }
  }

  async function sendEnter() {
    setSending(true);
    try {
      if (target === 'shell') await api.sendShellInput(sessionId, '\r');
      else await api.sendInput(sessionId, '\r');
    } catch { /* ignore */ } finally {
      setSending(false);
    }
  }

  async function pasteFromClipboard() {
    try {
      const value = await Clipboard.getString();
      if (value) setText(current => current ? `${current}\n${value}` : value);
    } catch { /* ignore */ }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}>
      <View style={styles.container}>
        <TouchableOpacity
          style={styles.enterBtn}
          onPress={sendEnter}
          disabled={disabled || sending}
          activeOpacity={0.7}>
          <Text style={[styles.enterBtnText, (disabled || sending) && styles.disabled]}>⏎</Text>
        </TouchableOpacity>

        <TextInput
          ref={inputRef}
          style={[styles.input, disabled && styles.disabledInput]}
          value={text}
          onChangeText={setText}
          placeholder={disabled ? 'Session not active' : (placeholder ?? 'Send input to Codex…')}
          placeholderTextColor={Colors.textDim}
          multiline
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={send}
          editable={!disabled}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
        />

        <TouchableOpacity
          style={[styles.pasteBtn, (disabled || sending) && styles.scheduleBtnDisabled]}
          onPress={pasteFromClipboard}
          disabled={disabled || sending}
          activeOpacity={0.8}>
          <Text style={[styles.pasteBtnText, (disabled || sending) && styles.disabled]}>
            Paste
          </Text>
        </TouchableOpacity>

        {allowSchedule && (
        <TouchableOpacity
          style={[styles.scheduleBtn, (disabled || !text.trim() || sending) && styles.scheduleBtnDisabled]}
          onPress={schedule}
          disabled={disabled || !text.trim() || sending}
          activeOpacity={0.8}>
          <Text style={[styles.scheduleBtnText, (disabled || !text.trim() || sending) && styles.disabled]}>
            2h
          </Text>
        </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.sendBtn, (disabled || !text.trim() || sending) && styles.sendBtnDisabled]}
          onPress={send}
          disabled={disabled || !text.trim() || sending}
          activeOpacity={0.8}>
          <Text style={styles.sendBtnText}>›</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bgCard,
  },
  enterBtn: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderColor: Colors.borderBright,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bgElevated,
    flexShrink: 0,
  },
  enterBtnText: {
    fontFamily: Fonts.mono,
    fontSize: 16,
    color: Colors.textDim,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: Colors.borderBright,
    borderRadius: Radius.md,
    color: Colors.textBright,
    fontFamily: Fonts.mono,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
    maxHeight: 100,
    minHeight: 36,
  },
  disabledInput: {
    opacity: 0.4,
  },
  sendBtn: {
    width: 40,
    height: 36,
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sendBtnDisabled: {
    backgroundColor: Colors.borderBright,
  },
  scheduleBtn: {
    width: 42,
    height: 36,
    borderWidth: 1,
    borderColor: 'rgba(0,255,157,0.4)',
    backgroundColor: Colors.accentDim,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pasteBtn: {
    height: 36,
    borderWidth: 1,
    borderColor: Colors.borderBright,
    backgroundColor: Colors.bgElevated,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    paddingHorizontal: 8,
  },
  pasteBtnText: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    color: Colors.text,
    fontWeight: '600',
  },
  scheduleBtnDisabled: {
    borderColor: Colors.borderBright,
    backgroundColor: Colors.bgElevated,
  },
  scheduleBtnText: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    color: Colors.accent,
    fontWeight: '700',
  },
  sendBtnText: {
    fontSize: 22,
    color: '#000',
    fontWeight: '700',
    lineHeight: 28,
  },
  disabled: {
    opacity: 0.4,
  },
});
