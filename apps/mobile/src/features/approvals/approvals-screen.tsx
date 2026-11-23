import { timeAgo, toolTarget } from '@pocket-agent/core';
import type { ApprovalDto } from '@pocket-agent/protocol';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { Check, Copy, Laptop, Lock, ShieldCheck } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useApprovals } from '@/lib/data';
import { enter, exit, layout } from '@/lib/motion';
import { alpha, radius, useTheme } from '@/lib/theme';
import { Button, Card, Divider, IconTile, Press, T, tap, toneColor } from '@/ui/core';
import { Notice, Roll, Skeleton } from '@/ui/feedback';
import { Screen } from '@/ui/screen';
import { ApprovalCard } from './approval-card';
import { APPROVAL_STATUS } from './shared';

/** How long a decided card stays, showing its result, before the list closes over its place. */
const SETTLE_MS = 1400;
const ENABLE_COMMAND = 'pocket-agent approvals enable';

/** A one-step terminal: the command to run on the PC (tap to copy) and what it answers. */
function TerminalStep({ command, output }: { command: string; output: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = () => {
    void Clipboard.setStringAsync(command);
    setCopied(true);
  };
  const Mark = copied ? Check : Copy;
  return (
    <View
      accessibilityLabel={`Terminal: ${command}`}
      testID="terminal-guide"
      style={{ borderRadius: radius.lg, backgroundColor: '#17171a', overflow: 'hidden' }}
    >
      <View
        style={{
          height: 30,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          backgroundColor: 'rgba(255,255,255,0.09)',
        }}
      >
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.25)' }}
            />
          ))}
        </View>
        <T
          variant="caption"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: 11,
            color: 'rgba(255,255,255,0.6)',
          }}
        >
          Terminal
        </T>
      </View>
      <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <T variant="mono" style={{ flex: 1, fontSize: 12.5, lineHeight: 21, color: '#f1f1f3' }}>
            <T variant="mono" style={{ fontSize: 12.5, lineHeight: 21, color: '#6f8ccf' }}>
              ~
            </T>
            <T variant="mono" style={{ fontSize: 12.5, lineHeight: 21, color: '#6ee7a8' }}>
              {'  ❯  '}
            </T>
            {command}
          </T>
          <Press
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Copied' : `Copy: ${command}`}
            onPress={copy}
            scale={0.9}
            hitSlop={6}
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: copied ? 'rgba(52,199,123,0.18)' : 'rgba(255,255,255,0.08)',
            }}
          >
            <Mark size={13} color={copied ? '#34c77b' : 'rgba(255,255,255,0.7)'} strokeWidth={2.2} />
          </Press>
        </View>
        <T variant="mono" style={{ fontSize: 12.5, lineHeight: 21, color: '#6ee7a8' }}>
          {output}
        </T>
      </View>
    </View>
  );
}

/** Nothing waiting: how to let Claude's requests reach the phone. */
function NoApprovals() {
  const { c } = useTheme();
  const router = useRouter();
  return (
    <Animated.View entering={enter.rise(0)} exiting={exit.fade} layout={layout} testID="no-approvals">
      <Card style={{ padding: 16, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconTile icon={ShieldCheck} size={40} tone="success" />
          <View style={{ flex: 1 }}>
            <T variant="subheading">No requests waiting</T>
            <T variant="small" tone="muted">
              Claude’s permission requests show up here.
            </T>
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <T variant="smallMedium">1. Allow it once on your PC</T>
          <TerminalStep command={ENABLE_COMMAND} output="Enabled." />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <T variant="small" style={{ flex: 1 }}>
            <T variant="smallMedium">2. Turn on Away mode</T>{' '}
            <T variant="small" tone="muted">
              for sessions you start in your editor.
            </T>
          </T>
          <Button
            label="Devices"
            icon={Laptop}
            variant="outline"
            size="sm"
            onPress={() => router.push('/devices')}
          />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Lock size={14} color={c.mutedForeground} strokeWidth={2} />
          <T variant="caption" tone="muted" style={{ flex: 1 }}>
            Your Claude Code permission settings are never changed.
          </T>
        </View>
      </Card>
    </Animated.View>
  );
}

/** A past request: what it was, where, and how it ended. The status word rolls when it changes. */
function RecentRow({ approval: a }: { approval: ApprovalDto }) {
  const { c } = useTheme();
  const s = APPROVAL_STATUS[a.status];
  const label = a.status === 'Pending' && a.decision ? 'Sent to PC' : s.label;
  const color = toneColor(c, s.tone);
  return (
    <View
      testID="approval-history-row"
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="mono" numberOfLines={1} style={{ fontSize: 13 }}>
          {toolTarget(a.input) || a.toolName}
        </T>
        <T variant="caption" tone="muted" numberOfLines={1}>
          {a.toolName} · {a.projectName} · {timeAgo(a.createdAt)}
        </T>
      </View>
      <View
        style={{
          height: 24,
          paddingHorizontal: 9,
          borderRadius: radius.full,
          backgroundColor: s.tone === 'muted' ? c.muted : alpha(color, 0.14),
          justifyContent: 'center',
        }}
      >
        <Roll text={label} variant="captionMedium" color={color} />
      </View>
    </View>
  );
}

/** Pending requests to decide, then the recent ones and how they ended. */
export function ApprovalsScreen() {
  const pending = useApprovals('pending');
  const history = useApprovals('all');
  // Decided cards stay a moment, showing their result, before the refresh takes them away.
  const [settling, setSettling] = useState<{ approval: ApprovalDto; index: number }[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const [pulling, setPulling] = useState(false);

  const refreshAll = useCallback(
    () => Promise.all([pending.refresh(), history.refresh()]),
    [pending, history],
  );
  const pull = () => {
    tap();
    setPulling(true);
    void refreshAll().finally(() => setPulling(false));
  };

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const decided = (a: ApprovalDto, index: number) => {
    setSettling((s) => (s.some((x) => x.approval.id === a.id) ? s : [...s, { approval: a, index }]));
    clearTimeout(timers.current.get(a.id));
    timers.current.set(
      a.id,
      setTimeout(() => {
        setSettling((s) => s.filter((x) => x.approval.id !== a.id));
        void refreshAll();
      }, SETTLE_MS),
    );
  };

  const fromApi = pending.state.data ?? [];
  // A settling card keeps its place in the list until it goes.
  const open = [...fromApi];
  for (const s of settling) {
    if (!open.some((a) => a.id === s.approval.id)) open.splice(Math.min(s.index, open.length), 0, s.approval);
  }
  const recent = (history.state.data ?? []).filter((a) => a.status !== 'Pending' || a.decision);
  const loading = pending.state.status === 'loading';

  return (
    <Screen
      title="Approvals"
      subtitle="Permission requests waiting for your decision."
      onRefresh={pull}
      refreshing={pulling}
      contentStyle={{ paddingHorizontal: 16, gap: 12 }}
    >
      {loading && (
        <Animated.View entering={enter.fade} exiting={exit.fade} accessibilityState={{ busy: true }}>
          <Skeleton height={160} round={radius.xl} />
        </Animated.View>
      )}
      {pending.state.status === 'error' && <Notice>{pending.state.error}</Notice>}

      {pending.state.status === 'ready' && open.length === 0 && <NoApprovals />}

      {open.length > 0 && (
        <View accessibilityLabel="Pending approvals" style={{ gap: 12 }}>
          {open.map((a, i) => (
            <Animated.View key={a.id} entering={enter.rise(i)} exiting={exit.fade} layout={layout}>
              <ApprovalCard approval={a} onDecided={() => decided(a, i)} />
            </Animated.View>
          ))}
        </View>
      )}

      {recent.length > 0 && (
        <Animated.View
          entering={enter.rise(open.length + 1)}
          layout={layout}
          style={{ marginTop: 20, gap: 8 }}
        >
          <T variant="smallMedium" accessibilityRole="header">
            Recent
          </T>
          <View testID="approval-history">
            <Card>
              {recent.slice(0, 20).map((a, i) => (
                <Animated.View key={a.id} layout={layout}>
                  {i > 0 && <Divider inset={16} />}
                  <RecentRow approval={a} />
                </Animated.View>
              ))}
            </Card>
          </View>
        </Animated.View>
      )}
      {history.state.status === 'error' && recent.length === 0 && (
        <T variant="caption" tone="muted" style={{ paddingHorizontal: 4 }}>
          {history.state.error}
        </T>
      )}
    </Screen>
  );
}
