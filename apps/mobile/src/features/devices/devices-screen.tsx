import { formatDate, timeAgo } from '@pocket-agent/core';
import { type DeviceDto } from '@pocket-agent/protocol';
import { Laptop, Monitor, Plus, Server } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { AddDeviceSheet } from '@/features/devices/add-device-sheet';
import { DeviceStatusBadge } from '@/features/devices/device-status';
import { apiRequest } from '@/lib/api';
import { useDevices } from '@/lib/data';
import { enter, exit, layout } from '@/lib/motion';
import { radius, useTheme } from '@/lib/theme';
import { Button, Card, Divider, IconTile, Press, T, buzz } from '@/ui/core';
import { EmptyState, Notice, Skeleton } from '@/ui/feedback';
import { Toggle } from '@/ui/form';
import { Screen } from '@/ui/screen';
import { Sheet } from '@/ui/sheet';

const PLATFORM = {
  windows: { icon: Monitor, label: 'Windows' },
  macos: { icon: Laptop, label: 'macOS' },
  linux: { icon: Server, label: 'Linux' },
} as const;

/**
 * Away mode: permission requests of sessions the user started on this PC come to Pocket Agent.
 * Only possible when the PC itself allows remote approval.
 */
function AwayMode({ device }: { device: DeviceDto }) {
  const { c } = useTheme();
  const [on, setOn] = useState(device.awayMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!device.remoteApprovalEnabled) {
    return (
      <T variant="small" tone="muted" testID="remote-approval-off">
        Remote approval is off. On this PC, run{' '}
        <T
          variant="mono"
          style={{ fontSize: 12.5, backgroundColor: c.muted, color: c.foreground, borderRadius: 4 }}
        >
          {' pocket-agent approvals enable '}
        </T>
      </T>
    );
  }
  return (
    <Animated.View layout={layout} style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <T variant="smallMedium">Away mode</T>
        <Toggle
          value={on}
          label="Away mode"
          disabled={busy}
          testID="away-switch"
          onChange={async (next) => {
            setBusy(true);
            setError(null);
            try {
              const r = (await apiRequest(`/devices/${device.id}/away`, null, {
                method: 'POST',
                body: { awayMode: next },
              })) as { device: DeviceDto };
              setOn(r.device.awayMode);
            } catch (err) {
              setError((err as Error).message);
              buzz(false);
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
      <Animated.View key={String(on)} entering={enter.fade} exiting={exit.fade}>
        <T variant="caption" tone="muted">
          {on
            ? 'Permission requests come here first. After 5 minutes the PC asks.'
            : 'Claude Code asks on the PC.'}
        </T>
      </Animated.View>
      {error && (
        <Animated.View entering={enter.fade} exiting={exit.fade} accessibilityRole="alert">
          <T variant="caption" tone="danger">
            {error}
          </T>
        </Animated.View>
      )}
    </Animated.View>
  );
}

function DeviceRow({
  device,
  index,
  onRevoke,
}: {
  device: DeviceDto;
  index: number;
  onRevoke: (d: DeviceDto) => void;
}) {
  const { c } = useTheme();
  const { icon: Icon, label } = PLATFORM[device.platform];
  const revoked = device.status === 'Revoked';
  const seen = revoked
    ? `Revoked ${timeAgo(device.revokedAt)}`
    : device.status === 'Online'
      ? 'Connected now'
      : `Last seen ${timeAgo(device.lastHeartbeatAt)}`;
  return (
    <Animated.View
      entering={enter.rise(index)}
      exiting={exit.fade}
      layout={layout}
      testID="device-row"
      accessibilityLabel={`${device.name}, ${device.status}`}
      style={{ opacity: revoked ? 0.6 : 1 }}
    >
      <Card style={{ overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
          <IconTile icon={Icon} tone="muted" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="bodyMedium" numberOfLines={1}>
              {device.name}
            </T>
            <T variant="small" tone="muted" numberOfLines={1}>
              {label} · Agent {device.agentVersion}
            </T>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
            <DeviceStatusBadge status={device.status} />
            <T variant="caption" tone="muted">
              {seen}
            </T>
          </View>
        </View>
        {!revoked && (
          <>
            <Divider />
            <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
              {/* Remounts when the server value changes (e.g. switched from the PC). */}
              <AwayMode key={String(device.awayMode)} device={device} />
            </View>
            <Divider />
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                paddingLeft: 16,
                paddingRight: 8,
                paddingVertical: 6,
              }}
            >
              <T variant="caption" tone="muted">
                Paired {formatDate(device.createdAt)}
              </T>
              <Press
                accessibilityRole="button"
                accessibilityLabel={`Revoke ${device.name}`}
                onPress={() => onRevoke(device)}
                scale={0.94}
                style={{
                  height: 36,
                  paddingHorizontal: 12,
                  borderRadius: radius.md,
                  justifyContent: 'center',
                }}
              >
                <T variant="smallMedium" style={{ color: c.destructive }}>
                  Revoke
                </T>
              </Press>
            </View>
          </>
        )}
      </Card>
    </Animated.View>
  );
}

function RevokeSheet({
  device,
  onClose,
  onRevoked,
}: {
  device: DeviceDto | null;
  onClose: () => void;
  onRevoked: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The name stays while the sheet leaves.
  const [shown, setShown] = useState<DeviceDto | null>(device);
  if (device && device !== shown) setShown(device);
  const close = () => {
    setError(null);
    onClose();
  };
  return (
    <Sheet
      open={!!device}
      onClose={close}
      dismissable={!pending}
      title={`Revoke “${shown?.name ?? ''}”?`}
      description="The agent disconnects immediately and can never reconnect with its current credentials. To use this PC again, pair it with a new code."
    >
      <View style={{ gap: 12, paddingTop: 4 }}>
        {error && <Notice>{error}</Notice>}
        <Button
          label={pending ? 'Revoking…' : 'Revoke device'}
          variant="destructive"
          size="lg"
          full
          loading={pending}
          testID="revoke-confirm"
          onPress={async () => {
            if (!shown) return;
            setPending(true);
            try {
              await apiRequest(`/devices/${shown.id}/revoke`, null, { method: 'POST' });
              buzz(true);
              onRevoked();
              close();
            } catch (err) {
              setError((err as Error).message);
              buzz(false);
            } finally {
              setPending(false);
            }
          }}
        />
        <Button label="Cancel" variant="outline" size="lg" full disabled={pending} onPress={close} />
      </View>
    </Sheet>
  );
}

function LoadingRows() {
  return (
    <Animated.View
      entering={enter.fade}
      exiting={exit.fade}
      accessibilityState={{ busy: true }}
      style={{ gap: 12 }}
    >
      {[0, 1].map((i) => (
        <Card key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
          <Skeleton width={44} height={44} round={13} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width={160} height={16} />
            <Skeleton width="80%" height={12} />
          </View>
        </Card>
      ))}
    </Animated.View>
  );
}

/** The account's PCs: status, Away mode, revoke, and pairing a new one. */
export function DevicesScreen() {
  const { state, refresh, refreshing } = useDevices();
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<DeviceDto | null>(null);

  const devices = state.data ?? [];
  // Active devices first, revoked ones last.
  const sorted = [...devices].sort((a, b) => Number(a.status === 'Revoked') - Number(b.status === 'Revoked'));

  return (
    <Screen
      title="Devices"
      subtitle="Computers running the Pocket Agent Local Agent."
      actions={
        <Button
          label="Add device"
          icon={Plus}
          size="sm"
          onPress={() => setAdding(true)}
          testID="add-device"
        />
      }
      onRefresh={() => void refresh()}
      refreshing={refreshing}
      contentStyle={{ paddingHorizontal: 16 }}
    >
      {state.status === 'loading' && <LoadingRows />}

      {state.status === 'error' && (
        <Animated.View entering={enter.fade} style={{ gap: 12 }}>
          <Notice>{state.error}</Notice>
          <Button label="Try again" variant="outline" size="sm" onPress={() => void refresh()} />
        </Animated.View>
      )}

      {state.status === 'ready' && state.error && (
        <Animated.View entering={enter.fade} exiting={exit.fade} layout={layout} style={{ marginBottom: 12 }}>
          <T variant="small" tone="muted" accessibilityLiveRegion="polite">
            Showing the last known state; refreshing failed: {state.error}
          </T>
        </Animated.View>
      )}

      {state.status === 'ready' && devices.length === 0 && (
        <EmptyState
          icon={Monitor}
          title="No devices paired"
          body="Pair a PC with a one-time code. The Local Agent only connects outward to Pocket Agent; nothing on your computer is exposed to the internet. You can revoke a device at any time."
          action="Add device"
          onAction={() => setAdding(true)}
        />
      )}

      {state.status === 'ready' && devices.length > 0 && (
        <View accessibilityLabel="Devices" style={{ gap: 12 }}>
          {sorted.map((d, i) => (
            <DeviceRow key={d.id} device={d} index={i} onRevoke={setRevoking} />
          ))}
        </View>
      )}

      <AddDeviceSheet
        open={adding}
        onClose={() => setAdding(false)}
        knownDeviceIds={devices.map((d) => d.id)}
        onPaired={() => void refresh()}
      />
      <RevokeSheet device={revoking} onClose={() => setRevoking(null)} onRevoked={() => void refresh()} />
    </Screen>
  );
}
