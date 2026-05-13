import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Colors, Fonts, Radius } from '../theme';
import { Plan } from '../types';
import { api } from '../api';
import { timeSince } from '../utils';
import { Badge, SectionHeader } from './ui';

interface PlanEditorProps {
  sessionId: string;
}

function planBadgeColor(status: Plan['status']): { color: string; bg: string } {
  switch (status) {
    case 'draft': return { color: '#64b5f6', bg: 'rgba(100,181,246,0.12)' };
    case 'sent': return { color: Colors.accent, bg: Colors.accentDim };
    case 'approved': return { color: Colors.accent, bg: 'rgba(0,255,157,0.18)' };
    case 'rejected': return { color: Colors.danger, bg: Colors.dangerDim };
  }
}

export default function PlanEditor({ sessionId }: PlanEditorProps) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [activePlanId, setActivePlanId] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    api.getPlans(sessionId).then(setPlans).catch(() => {});
  }, [sessionId]);

  const latestPlan = plans[0];

  function startEdit() {
    setEditText(latestPlan?.editedText ?? latestPlan?.originalText ?? '');
    setActivePlanId(latestPlan?.id);
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (activePlanId) {
        const updated = await api.updatePlan(activePlanId, { editedText: editText });
        setPlans(ps => ps.map(p => (p.id === updated.id ? updated : p)));
      } else {
        const plan = await api.createPlan(sessionId, { originalText: editText });
        setPlans(ps => [plan, ...ps]);
        setActivePlanId(plan.id);
      }
      setStatusMsg('Saved');
    } catch { setStatusMsg('Save failed'); } finally { setSaving(false); }
  }

  async function doAction(action: string) {
    setSending(true);
    try {
      await api.sendPlan(sessionId, { planId: activePlanId, text: editText, action });
      if (activePlanId) {
        setPlans(ps => ps.map(p => (p.id === activePlanId ? { ...p, status: 'sent' } : p)));
      }
      setStatusMsg('Sent to Codex ✓');
      setEditing(false);
    } catch { setStatusMsg('Send failed'); } finally { setSending(false); }
  }

  async function handleSchedule() {
    if (!editText.trim()) return;
    setSending(true);
    try {
      await api.scheduleMessage(sessionId, { text: editText, delayMs: 2 * 60 * 60 * 1000 });
      setStatusMsg('Scheduled for 2 hours from now');
      setEditing(false);
    } catch { setStatusMsg('Schedule failed'); } finally { setSending(false); }
  }

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <SectionHeader
        title="Plan"
        right={
          <TouchableOpacity onPress={startEdit} style={styles.editBtn}>
            <Text style={styles.editBtnText}>{latestPlan ? 'Edit Plan' : '+ New Plan'}</Text>
          </TouchableOpacity>
        }
      />

      {/* Preview */}
      {!editing && latestPlan && (() => {
        const { color, bg } = planBadgeColor(latestPlan.status);
        return (
          <View style={styles.previewCard}>
            <View style={styles.previewMeta}>
              <Badge label={latestPlan.status} color={color} bg={bg} />
              <Text style={styles.metaDim}>{timeSince(latestPlan.updatedAt)}</Text>
            </View>
            <ScrollView style={styles.planTextScroll} nestedScrollEnabled>
              <Text style={styles.planText} selectable>
                {latestPlan.editedText ?? latestPlan.originalText}
              </Text>
            </ScrollView>
          </View>
        );
      })()}

      {/* Editor */}
      {editing && (
        <View style={styles.editorCard}>
          <TextInput
            style={styles.planInput}
            value={editText}
            onChangeText={setEditText}
            placeholder="Paste or write the plan here…"
            placeholderTextColor={Colors.textDim}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            textAlignVertical="top"
          />

          <View style={styles.actionsGrid}>
            <ActionBtn label="Save" onPress={handleSave} loading={saving} />
            <ActionBtn
              label="Schedule 2h"
              onPress={handleSchedule}
              loading={sending}
              accent
            />
            <ActionBtn
              label="Send Revised"
              onPress={() => doAction('revise')}
              loading={sending}
              accent
            />
            <ActionBtn label="✓ Approve" onPress={() => doAction('approve')} loading={sending} />
            <ActionBtn label="Step 1 Only" onPress={() => doAction('step1')} loading={sending} />
            <ActionBtn
              label="Stop & Summarize"
              onPress={() => doAction('stop')}
              loading={sending}
              danger
            />
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(false)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {statusMsg !== '' && (
            <Text style={styles.statusMsg}>{statusMsg}</Text>
          )}
        </View>
      )}

      {!editing && !latestPlan && (
        <View style={styles.emptyPlan}>
          <Text style={styles.emptyPlanText}>
            No plan yet.{'\n'}Tap "New Plan" to paste or write one.
          </Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function ActionBtn({
  label,
  onPress,
  loading,
  accent,
  danger,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  accent?: boolean;
  danger?: boolean;
}) {
  const bg = accent ? Colors.accentDim : danger ? Colors.dangerDim : Colors.bgElevated;
  const border = accent ? 'rgba(0,255,157,0.4)' : danger ? 'rgba(255,68,68,0.35)' : Colors.borderBright;
  const color = accent ? Colors.accent : danger ? Colors.danger : Colors.text;

  return (
    <TouchableOpacity
      style={[styles.actionBtn, { backgroundColor: bg, borderColor: border }]}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.75}>
      {loading ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Text style={[styles.actionBtnText, { color }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  editBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.borderBright,
    borderRadius: Radius.md,
  },
  editBtnText: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.accent,
  },
  previewCard: {
    margin: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.bgElevated,
    overflow: 'hidden',
  },
  previewMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  metaDim: { fontFamily: Fonts.sans, fontSize: 12, color: Colors.textDim },
  planTextScroll: { maxHeight: 280 },
  planText: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 19,
    color: Colors.text,
    padding: 12,
  },
  editorCard: {
    margin: 14,
    gap: 10,
  },
  planInput: {
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: Colors.borderBright,
    borderRadius: Radius.md,
    color: Colors.textBright,
    fontFamily: Fonts.mono,
    fontSize: 13,
    lineHeight: 20,
    padding: 12,
    minHeight: 160,
    textAlignVertical: 'top',
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionBtn: {
    minWidth: '45%',
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  cancelBtn: {
    flex: 1,
    minWidth: '45%',
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    color: Colors.textDim,
  },
  statusMsg: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    color: Colors.accent,
    textAlign: 'center',
    paddingTop: 4,
  },
  emptyPlan: {
    padding: 32,
    alignItems: 'center',
  },
  emptyPlanText: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    color: Colors.textDim,
    textAlign: 'center',
    lineHeight: 22,
  },
});
