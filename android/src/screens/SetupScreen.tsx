import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Colors, Fonts, Radius } from '../theme';
import { saveCredentials } from '../api';
import { api } from '../api';

type Props = NativeStackScreenProps<RootStackParamList, 'Setup'>;

export default function SetupScreen({ navigation }: Props) {
  const [url, setUrl] = useState('http://100.117.114.128:3742');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleConnect() {
    setError('');
    if (!url.trim() || !token.trim()) {
      setError('Both fields are required.');
      return;
    }
    setLoading(true);
    await saveCredentials(url.trim(), token.trim());
    try {
      await api.health();
      navigation.replace('Projects');
    } catch {
      setError('Cannot connect. Check URL and token.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">

      {/* Logo */}
      <View style={styles.logo}>
        <Text style={styles.logoBracket}>{'{ '}</Text>
        <Text style={styles.logoText}>CODEX</Text>
        <Text style={styles.logoBracket}>{' }'}</Text>
      </View>
      <Text style={styles.logoSub}>REMOTE</Text>

      <View style={styles.card}>
        <Text style={styles.label}>BACKEND URL</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="http://100.117.114.128:3742"
          placeholderTextColor={Colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <Text style={[styles.label, { marginTop: 16 }]}>AUTH TOKEN</Text>
        <TextInput
          style={styles.input}
          value={token}
          onChangeText={setToken}
          placeholder="your-auth-token"
          placeholderTextColor={Colors.textDim}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        {error !== '' && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[styles.connectBtn, loading && styles.connectBtnLoading]}
          onPress={handleConnect}
          disabled={loading}
          activeOpacity={0.85}>
          {loading
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.connectBtnText}>Connect</Text>}
        </TouchableOpacity>
      </View>

      <Text style={styles.hint}>
        Token is in{' '}
        <Text style={styles.hintCode}>~/.codex-remote/config.yaml</Text>
        {'\n'}on your laptop
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  logo: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  logoBracket: {
    fontFamily: Fonts.mono,
    fontSize: 28,
    color: Colors.accent,
    opacity: 0.65,
  },
  logoText: {
    fontFamily: Fonts.mono,
    fontSize: 30,
    fontWeight: '700',
    color: Colors.textBright,
    letterSpacing: 4,
  },
  logoSub: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: Colors.accent,
    letterSpacing: 7,
    marginBottom: 36,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    padding: 22,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  label: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.textDim,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  input: {
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
  error: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    color: Colors.danger,
    marginTop: 10,
  },
  connectBtn: {
    marginTop: 22,
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  connectBtnLoading: { opacity: 0.7 },
  connectBtnText: {
    fontFamily: Fonts.sansMedium,
    fontWeight: '700',
    fontSize: 15,
    color: '#000',
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.textDim,
    textAlign: 'center',
    marginTop: 28,
    lineHeight: 20,
  },
  hintCode: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: Colors.text,
  },
});
