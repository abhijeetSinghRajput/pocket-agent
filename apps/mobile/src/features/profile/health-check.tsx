import { pcHealth, type HealthCheck } from '@pocket-agent/core';
import { CircleAlert, CircleCheck, CircleX, Download, Info, Laptop, Smartphone } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { useDevices } from '@/lib/data';
import { currentPushState, enablePush, type PushState } from '@/lib/push';
import { fonts, radius, useTheme } from '@/lib/theme';
import { Button, buzz, Card, Divider, T, toneColor, type Tone } from '@/ui/core';
import { CopyIconButton } from '@/ui/copy';
import { Skeleton } from '@/ui/feedback';

const LOOK: Record<HealthCheck['state'], { icon: typeof CircleCheck; tone: Tone }> = {
  ok: { icon: CircleCheck, tone: 'success' },
  warn: { icon: CircleAlert, tone: 'warning' },
  fail: { icon: CircleX, tone: 'danger' },
  info: { icon: Info, tone: 'muted' },
};

/** A command to run on the PC, with a copy button. */
function Command({ text }: { text: string }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: radius.md,
        backgroundColor: c.muted,
        paddingLeft: 10,
        marginTop: 6,
      }}
    >
      <T
        selectable
        style={{ flex: 1, fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 18, paddingVertical: 8 }}
      >
        {text}
      </T>
      <CopyIconButton value={text} label="Copy command" size={34} />
    </View>
  );
}

function Row({
  check,
  children,
}: {
  check: Pick<HealthCheck, 'label' | 'state' | 'detail'>;
  children?: React.ReactNode;
}) {
  const { c } = useTheme();
  const { icon: Icon, tone } = LOOK[check.state];
  return (
    <View
      style={{ flexDirection: 'row', gap: 10, paddingVertical: 8 }}
      accessible
      accessibilityLabel={`${check.label}. ${check.detail}`}
      testID={`health-${check.state}`}
    >
      <Icon size={18} color={toneColor(c, tone)} strokeWidth={2.2} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="smallMedium">{check.label}</T>
        <T variant="caption" tone="muted">
          {check.detail}
        </T>
        {children}
      </View>
    </View>
  );
}

/** This phone's notifications: on, or a button that turns them on (or opens Android settings). */
function PhoneRow() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void currentPushState().then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, []);
  if (!state) return null;
  const on = state.status === 'on';
  const check = on
    ? {
        label: 'Notifications on',
        state: 'ok' as const,
        detail: 'Requests reach this phone when the app is closed.',
      }
    : state.status === 'unsupported'
      ? { label: 'Notifications', state: 'info' as const, detail: state.reason }
      : {
          label: 'Notifications off',
          state: 'warn' as const,
          detail:
            state.status === 'denied'
              ? 'Turned off for Pocket Agent in Android settings.'
              : 'You only see requests while the app is open.',
        };
  return (
    <Row check={check}>
      {!on && state.status !== 'unsupported' && (
        <View style={{ alignSelf: 'flex-start', marginTop: 8 }}>
          <Button
            label={state.status === 'denied' ? 'Open settings' : busy ? 'Turning on…' : 'Turn on'}
            size="sm"
            variant="outline"
            loading={busy}
            onPress={async () => {
              if (state.status === 'denied') return void Linking.openSettings();
              setBusy(true);
              const next = await enablePush().catch(() => state);
              buzz(next.status === 'on');
              setState(next);
              setBusy(false);
            }}
            testID="health-push-on"
          />
        </View>
      )}
    </Row>
  );
}

function Heading({ icon: Icon, text }: { icon: typeof Laptop; text: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 2 }}>
      <Icon size={15} color={c.mutedForeground} strokeWidth={2.2} />
      <T variant="captionMedium" tone="muted" numberOfLines={1}>
        {text}
      </T>
    </View>
  );
}

/**
 * Is everything set up: each PC online, up to date, linked to Claude Code, with phone approvals;
 * and this phone's notifications. Each line that isn't right says how to fix it.
 */
export function HealthCheckCard() {
  const { state } = useDevices();
  const pcs = (state.data ?? []).filter((d) => d.status !== 'Revoked');
  const problems = pcs
    .flatMap((d) => pcHealth(d))
    .filter((x) => x.state === 'warn' || x.state === 'fail').length;
  return (
    <Card style={{ padding: 16 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <T variant="overline" tone="muted" accessibilityRole="header">
          HEALTH CHECK
        </T>
        {state.data && (
          <T variant="captionMedium" tone={problems ? 'warning' : 'success'} testID="health-summary">
            {problems ? `${problems} to fix` : 'All good'}
          </T>
        )}
      </View>
      {state.status === 'loading' && <Skeleton height={120} round={radius.lg} />}
      {pcs.map((d, i) => (
        <View key={d.id}>
          {i > 0 && <Divider />}
          <Heading icon={Laptop} text={d.name} />
          {pcHealth(d).map((check) => (
            <Row key={check.key} check={check}>
              {check.state !== 'ok' && check.command && <Command text={check.command} />}
              {check.state !== 'ok' && check.link && (
                <View style={{ alignSelf: 'flex-start', marginTop: 8 }}>
                  <Button
                    label="Download"
                    icon={Download}
                    size="sm"
                    variant="outline"
                    onPress={() => void Linking.openURL(check.link!)}
                  />
                </View>
              )}
            </Row>
          ))}
        </View>
      ))}
      <Divider />
      <Heading icon={Smartphone} text="This phone" />
      <PhoneRow />
    </Card>
  );
}
