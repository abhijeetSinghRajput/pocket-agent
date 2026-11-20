'use client';

import { DeviceListResponse, type DeviceDto } from '@agentdock/protocol';
import { Laptop, Monitor, Plus, Server } from 'lucide-react';
import { useCallback, useState } from 'react';
import { AddDeviceDialog } from '@/components/devices/add-device-dialog';
import { DeviceStatusBadge } from '@/components/devices/device-status';
import { PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { apiRequest } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';
import { useLiveRefresh } from '@/lib/live';
import { usePoll } from '@/lib/use-poll';
import { cn } from '@/lib/utils';

const PLATFORM = {
  windows: { icon: Monitor, label: 'Windows' },
  macos: { icon: Laptop, label: 'macOS' },
  linux: { icon: Server, label: 'Linux' },
} as const;

/**
 * Away mode: permission requests of sessions the user started on this PC come to AgentDock.
 * Only possible when the PC itself allows remote approval.
 */
function AwayMode({ device }: { device: DeviceDto }) {
  const [on, setOn] = useState(device.awayMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!device.remoteApprovalEnabled) {
    return (
      <p className="mt-2 text-xs text-muted-foreground" data-testid="remote-approval-off">
        Remote approval is off on this PC. To answer its permission requests here, run{' '}
        <code className="font-mono">agentdock approvals enable</code> on it.
      </p>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-1">
      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Away mode"
          disabled={busy}
          data-testid="away-switch"
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const r = await apiRequest(`/devices/${device.id}/away`, null, {
                method: 'POST',
                body: { awayMode: !on },
              });
              setOn((r as { device: DeviceDto }).device.awayMode);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
            on ? 'bg-primary' : 'bg-input',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'size-5 rounded-full bg-background shadow-xs transition-transform',
              on ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
        <span className="font-medium">Away mode</span>
      </label>
      <p className="text-xs text-muted-foreground">
        {on
          ? 'Permission requests of sessions you started on this PC come here first. Unanswered within 5 min: asked on the PC.'
          : 'Off: Claude Code asks on the PC as usual. Managed sessions always ask here.'}
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function DeviceRow({ device, onRevoke }: { device: DeviceDto; onRevoke: (d: DeviceDto) => void }) {
  const { icon: Icon, label } = PLATFORM[device.platform];
  const revoked = device.status === 'Revoked';
  return (
    <li
      data-testid="device-row"
      data-device-name={device.name}
      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-medium">{device.name}</span>
            <DeviceStatusBadge status={device.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {label} · Agent {device.agentVersion} ·{' '}
            {revoked
              ? `Revoked ${timeAgo(device.revokedAt)}`
              : device.status === 'Online'
                ? 'Connected now'
                : `Last seen ${timeAgo(device.lastHeartbeatAt)}`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Paired {formatDate(device.createdAt)}</p>
          {/* Remounts when the server value changes (e.g. switched from another tab). */}
          {!revoked && <AwayMode key={String(device.awayMode)} device={device} />}
        </div>
      </div>
      {!revoked && (
        <Button
          variant="outline"
          size="sm"
          className="self-start text-destructive hover:bg-destructive/10 hover:text-destructive sm:self-center"
          onClick={() => onRevoke(device)}
        >
          Revoke
        </Button>
      )}
    </li>
  );
}

function RevokeDialog({
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
  return (
    <Modal
      role="alertdialog"
      open={!!device}
      onOpenChange={(o) => {
        if (!o) {
          setError(null);
          onClose();
        }
      }}
      title={`Revoke “${device?.name ?? ''}”?`}
      description="The agent disconnects immediately and can never reconnect with its current credentials. To use this PC again, pair it with a new code."
    >
      {error && (
        <p role="alert" className="mb-4 rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={pending}
          onClick={async () => {
            if (!device) return;
            setPending(true);
            try {
              await apiRequest(`/devices/${device.id}/revoke`, null, { method: 'POST' });
              onRevoked();
              onClose();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? 'Revoking…' : 'Revoke device'}
        </Button>
      </div>
    </Modal>
  );
}

export function DevicesView() {
  const fetcher = useCallback(
    (signal: AbortSignal) => apiRequest('/devices', DeviceListResponse, { signal }).then((r) => r.devices),
    [],
  );
  const { state, refresh } = usePoll(fetcher, 30_000);
  useLiveRefresh(
    () => void refresh(),
    (e) => e.eventType === 'device.status.changed',
  );
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<DeviceDto | null>(null);

  const devices = state.data ?? [];
  // Active devices first, revoked ones last.
  const sorted = [...devices].sort((a, b) => Number(a.status === 'Revoked') - Number(b.status === 'Revoked'));

  return (
    <>
      <PageHeader
        title="Devices"
        description="Computers running the AgentDock Local Agent."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add device
          </Button>
        }
      />

      {state.status === 'loading' && (
        <div className="divide-y rounded-xl border" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <div className="size-10 animate-pulse rounded-lg bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                <div className="h-3 w-64 max-w-full animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      )}

      {state.status === 'error' && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
          <p className="text-destructive">{state.error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      )}

      {state.status === 'ready' && state.error && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          Showing the last known state; refreshing failed: {state.error}
        </p>
      )}

      {state.status === 'ready' && devices.length === 0 && (
        <section className="flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
          <span className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
            <Monitor className="size-5" aria-hidden />
          </span>
          <h2 className="mt-4 text-base font-semibold">No devices paired</h2>
          <p className="mt-2 max-w-md text-sm text-pretty text-muted-foreground">
            Pair a PC with a one-time code. The Local Agent only connects outward to AgentDock; nothing on
            your computer is exposed to the internet. You can revoke a device at any time.
          </p>
          <Button className="mt-5" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add device
          </Button>
        </section>
      )}

      {state.status === 'ready' && devices.length > 0 && (
        <ul className="divide-y rounded-xl border bg-card" aria-label="Devices">
          {sorted.map((d) => (
            <DeviceRow key={d.id} device={d} onRevoke={setRevoking} />
          ))}
        </ul>
      )}

      <AddDeviceDialog
        open={adding}
        onOpenChange={setAdding}
        knownDeviceIds={devices.map((d) => d.id)}
        onPaired={() => void refresh()}
      />
      <RevokeDialog device={revoking} onClose={() => setRevoking(null)} onRevoked={() => void refresh()} />
    </>
  );
}
