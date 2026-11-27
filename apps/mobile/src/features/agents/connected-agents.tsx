import { agentProduct, pcAgents, timeAgo, type PcAgent } from '@pocket-agent/core';
import type { DeviceDto } from '@pocket-agent/protocol';
import { Laptop, UserRound } from 'lucide-react-native';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { AgentLogo, agentBackdrop } from '@/features/sessions/badges';
import { enter, layout } from '@/lib/motion';
import { fonts, radius, useTheme } from '@/lib/theme';
import { Badge, Card, Divider, T, type Tone } from '@/ui/core';
import { CopyIconButton } from '@/ui/copy';
import { EmptyState, Notice, Skeleton } from '@/ui/feedback';
import { LabelSeparator } from '@/ui/separator';

// Only a state that needs something gets a pill (no dot); ready says nothing, so the name and
// account get the room, and "Not installed" is the separator above those agents.
const TONE: Partial<Record<PcAgent['state'], Tone>> = { 'signed-out': 'warning', update: 'warning' };
// Ready ones first, then the ones a sign-in or update away.
const ORDER: Record<PcAgent['state'], number> = { ready: 0, 'signed-out': 1, update: 2, missing: 3 };

/** One agent on a PC: its mark, name, where it stands, and the command that fixes it. */
function AgentRow({ agent: a }: { agent: PcAgent }) {
  const { c, dark } = useTheme();
  const name = agentProduct(a.provider);
  return (
    <View
      testID={`connected-${a.provider}`}
      accessibilityLabel={`${name}: ${a.label}.${a.account ? ` Signed in as ${a.account}.` : ''} ${a.detail}`}
      style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {/* An agent you can't chat with right now is muted; its pill and fix stay readable. */}
        <View
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            opacity: a.state === 'ready' ? 1 : 0.5,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: agentBackdrop(a.provider, dark),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AgentLogo provider={a.provider} size={22} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="subheading" numberOfLines={1}>
              {name}
            </T>
            {a.account && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 }}>
                <UserRound size={12} color={c.mutedForeground} strokeWidth={2.4} />
                <T
                  variant="smallMedium"
                  numberOfLines={1}
                  style={{ flexShrink: 1 }}
                  testID={`account-${a.provider}`}
                >
                  {a.account}
                </T>
              </View>
            )}
            <T variant="caption" tone="muted" numberOfLines={2}>
              {a.detail}
            </T>
          </View>
        </View>
        {TONE[a.state] && <Badge label={a.label} tone={TONE[a.state]} />}
      </View>
      {a.command && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginLeft: 52,
            paddingLeft: 12,
            borderRadius: radius.md,
            backgroundColor: c.muted,
          }}
        >
          <T variant="caption" style={{ flex: 1, fontFamily: fonts.mono }} numberOfLines={1}>
            {a.command}
          </T>
          <CopyIconButton value={a.command} label={`Copy ${a.command}`} size={34} />
        </View>
      )}
    </View>
  );
}

function AgentList({ agents }: { agents: PcAgent[] }) {
  return (
    <Card>
      {agents.map((a, i) => (
        <View key={a.provider}>
          {i > 0 && <Divider inset={16} />}
          <AgentRow agent={a} />
        </View>
      ))}
    </Card>
  );
}

/**
 * One PC: its name and whether it is online, then its agents as it last reported them: the ones
 * on it, and under a separator, the ones it doesn't have.
 */
function PcCard({ device: d, index }: { device: DeviceDto; index: number }) {
  const { c } = useTheme();
  const online = d.status === 'Online';
  const all = pcAgents(d);
  const agents = all.filter((a) => a.state !== 'missing').sort((x, y) => ORDER[x.state] - ORDER[y.state]);
  const missing = all.filter((a) => a.state === 'missing');
  const ready = all.filter((a) => a.state === 'ready').length;
  return (
    <Animated.View entering={enter.rise(index)} layout={layout} style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
        <Laptop size={16} color={c.mutedForeground} />
        <T
          variant="overline"
          tone="muted"
          numberOfLines={1}
          style={{ flexShrink: 1 }}
          accessibilityRole="header"
        >
          {d.name.toUpperCase()}
        </T>
        <View style={{ flex: 1 }} />
        <T variant="caption" tone="muted">
          {ready} of {all.length} ready
        </T>
      </View>
      {!online && (
        <Notice>
          {`This PC is offline${d.lastHeartbeatAt ? ` (last seen ${timeAgo(d.lastHeartbeatAt)})` : ''}. This is what it reported last.`}
        </Notice>
      )}
      {agents.length > 0 && <AgentList agents={agents} />}
      {missing.length > 0 && (
        <>
          <View style={{ marginTop: 6 }}>
            <LabelSeparator label="Not installed" />
          </View>
          <AgentList agents={missing} />
        </>
      )}
    </Animated.View>
  );
}

/**
 * The coding agents on your PCs: which are ready to chat, which are signed out or need an update
 * (with the command that fixes it, to run on the PC), and which aren't installed, with the account
 * each is signed in with where the agent names it. Signing in and out stays on the PC.
 */
export function ConnectedAgents({
  devices,
  loading,
  error,
}: {
  devices: DeviceDto[] | null | undefined;
  loading: boolean;
  error: string | null;
}) {
  const pcs = (devices ?? []).filter((d) => d.status !== 'Revoked');
  if (loading)
    return (
      <View accessibilityState={{ busy: true }} style={{ gap: 10 }}>
        <Skeleton height={14} width={120} />
        <Skeleton height={320} round={radius.xl} />
      </View>
    );
  return (
    <>
      {error && <Notice>{error}</Notice>}
      {!error && !pcs.length && (
        <View testID="no-connected-pcs">
          <EmptyState
            icon={Laptop}
            title="No PC connected"
            body="Connect your PC in Devices, and the coding agents on it show up here."
          />
        </View>
      )}
      {pcs.map((d, i) => (
        <PcCard key={d.id} device={d} index={i} />
      ))}
    </>
  );
}
