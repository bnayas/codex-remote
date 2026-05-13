import React, {
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useState,
} from 'react';
import {
  FlatList,
  Text,
  View,
  StyleSheet,
  TouchableOpacity,
  ListRenderItemInfo,
  Clipboard,
} from 'react-native';
import { Colors, Fonts } from '../theme';
import { stripAnsi } from '../utils';

export interface TerminalHandle {
  appendOutput: (data: string) => void;
  setScrollback: (lines: string[]) => void;
  appendLine: (line: string) => void;
}

interface TerminalProps {
  alive: boolean;
  connected: boolean;
  label?: string;
}

interface TerminalLine {
  id: number;
  text: string;
}

const MAX_LINES = 2000;
let _idCounter = 0;

const TerminalLineItem = React.memo(({
  item,
  selectionMode,
  selected,
  onToggle,
}: {
  item: TerminalLine;
  selectionMode: boolean;
  selected: boolean;
  onToggle: (id: number) => void;
}) => (
  <TouchableOpacity
    activeOpacity={selectionMode ? 0.75 : 1}
    onPress={selectionMode ? () => onToggle(item.id) : undefined}
    disabled={!selectionMode}
    style={[
      styles.lineWrap,
      selectionMode && styles.lineSelectable,
      selected && styles.lineSelected,
    ]}>
    <Text style={styles.line} selectable={!selectionMode}>
      {item.text || ' '}
    </Text>
  </TouchableOpacity>
));

const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  ({ alive, connected, label = 'TERMINAL' }, ref) => {
    const linesRef = useRef<TerminalLine[]>([]);
    const [, forceRender] = useState(0);
    const [copyStatus, setCopyStatus] = useState('');
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedLineIds, setSelectedLineIds] = useState<Set<number>>(() => new Set());
    const flatListRef = useRef<FlatList<TerminalLine>>(null);
    const lineBuffer = useRef('');
    const autoScrollRef = useRef(true);

    const flush = useCallback(() => {
      if (linesRef.current.length > MAX_LINES) {
        linesRef.current = linesRef.current.slice(-MAX_LINES);
      }
      forceRender(n => n + 1);
      if (autoScrollRef.current) {
        // Small delay to let layout settle
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: false });
        }, 30);
      }
    }, []);

    useImperativeHandle(ref, () => ({
      appendOutput(data: string) {
        const clean = stripAnsi(data);
        lineBuffer.current += clean;
        const parts = lineBuffer.current.split('\n');
        lineBuffer.current = parts.pop() ?? '';
        for (const part of parts) {
          linesRef.current.push({ id: _idCounter++, text: part });
        }
        flush();
      },
      setScrollback(lines: string[]) {
        linesRef.current = lines.map(t => ({ id: _idCounter++, text: stripAnsi(t) }));
        flush();
      },
      appendLine(line: string) {
        linesRef.current.push({ id: _idCounter++, text: line });
        flush();
      },
    }));

    const renderItem = useCallback(
      ({ item }: ListRenderItemInfo<TerminalLine>) => (
        <TerminalLineItem
          item={item}
          selectionMode={selectionMode}
          selected={selectedLineIds.has(item.id)}
          onToggle={toggleLine}
        />
      ),
      [selectionMode, selectedLineIds],
    );

    const keyExtractor = useCallback((item: TerminalLine) => String(item.id), []);

    function copyAll() {
      Clipboard.setString(linesRef.current.map(line => line.text).join('\n'));
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus(''), 1400);
    }

    function toggleLine(id: number) {
      setSelectedLineIds(current => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }

    function copySelected() {
      if (selectedLineIds.size === 0) {
        setCopyStatus('select lines first');
        setTimeout(() => setCopyStatus(''), 1400);
        return;
      }
      Clipboard.setString(
        linesRef.current
          .filter(line => selectedLineIds.has(line.id))
          .map(line => line.text)
          .join('\n'),
      );
      setCopyStatus('selection copied');
      setTimeout(() => setCopyStatus(''), 1400);
    }

    return (
      <View style={styles.outer}>
        <View style={styles.header}>
          <Text style={styles.headerLabel}>{label}</Text>
          <View style={styles.headerRight}>
            {!connected && (
              <Text style={styles.reconnecting}>reconnecting…</Text>
            )}
            <View style={[styles.statusDot, { backgroundColor: alive ? Colors.accent : Colors.textDim }]} />
            <Text style={[styles.statusText, { color: alive ? Colors.accent : Colors.textDim }]}>
              {alive ? 'live' : 'offline'}
            </Text>
          </View>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity onPress={copySelected} style={styles.copyBtn} activeOpacity={0.75}>
            <Text style={styles.copyBtnText}>Copy selected</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setSelectionMode(value => !value)}
            style={[styles.copyBtn, selectionMode && styles.copyBtnActive]}
            activeOpacity={0.75}>
            <Text style={styles.copyBtnText}>{selectionMode ? 'Done selecting' : 'Select lines'}</Text>
          </TouchableOpacity>
          {selectedLineIds.size > 0 && (
            <TouchableOpacity onPress={() => setSelectedLineIds(new Set())} style={styles.copyBtn} activeOpacity={0.75}>
              <Text style={styles.copyBtnText}>Clear {selectedLineIds.size}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={copyAll} style={styles.copyBtn} activeOpacity={0.75}>
            <Text style={styles.copyBtnText}>Copy all output</Text>
          </TouchableOpacity>
          {copyStatus !== '' && <Text style={styles.copyStatus}>{copyStatus}</Text>}
        </View>

        <FlatList
          ref={flatListRef}
          data={linesRef.current}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={true}
          indicatorStyle="white"
          removeClippedSubviews
          maxToRenderPerBatch={40}
          windowSize={10}
          initialNumToRender={60}
          onScrollBeginDrag={() => { autoScrollRef.current = false; }}
          ListEmptyComponent={
            <Text style={styles.empty}>Waiting for output…</Text>
          }
        />

        {!autoScrollRef.current && (
          <TouchableOpacity
            style={styles.scrollToBottomBtn}
            onPress={() => {
              autoScrollRef.current = true;
              flatListRef.current?.scrollToEnd({ animated: true });
            }}>
            <Text style={styles.scrollToBottomText}>↓ scroll to bottom</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  },
);

export default Terminal;

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    backgroundColor: Colors.terminalBg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.bgCard,
  },
  headerLabel: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.textDim,
    letterSpacing: 1.5,
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  copyBtn: {
    borderWidth: 1,
    borderColor: Colors.borderBright,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: Colors.bgElevated,
  },
  copyBtnActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentDim,
  },
  copyBtnText: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.accent,
    fontWeight: '700',
  },
  copyStatus: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.accent,
    marginRight: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  reconnecting: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.warn,
    marginRight: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontFamily: Fonts.mono,
    fontSize: 10,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  line: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.terminalText,
  },
  lineWrap: {
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
  },
  lineSelectable: {
    paddingLeft: 6,
  },
  lineSelected: {
    backgroundColor: 'rgba(0,255,157,0.12)',
    borderLeftColor: Colors.accent,
  },
  empty: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    color: Colors.textDim,
    padding: 12,
  },
  scrollToBottomBtn: {
    position: 'absolute',
    bottom: 8,
    right: 12,
    backgroundColor: Colors.bgElevated,
    borderWidth: 1,
    borderColor: Colors.borderBright,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  scrollToBottomText: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: Colors.accent,
  },
});
