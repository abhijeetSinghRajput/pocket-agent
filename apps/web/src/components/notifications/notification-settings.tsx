'use client';

import {
  NOTIFICATION_CATEGORIES,
  NotificationSettingsDto,
  type NotificationCategory,
  type NotificationSettingsDto as Settings,
} from '@pocket-agent/protocol';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/api';
import {
  browserPushSupport,
  disablePush,
  enablePush,
  hasLocalRegistration,
  refreshPushRegistration,
  type PushSupport,
} from '@/lib/push';
import { usePoll } from '@/lib/use-poll';
import { cn } from '@/lib/utils';

const noopSubscribe = () => () => undefined;

const LABELS: Record<NotificationCategory, { title: string; hint: string }> = {
  permission_required: {
    title: 'Permission requests',
    hint: 'Also during quiet hours.',
  },
  agent_failed: { title: 'Failures', hint: 'A turn ended with an error.' },
  device_disconnected: { title: 'PC offline', hint: 'No response for 2 minutes.' },
  task_completed: {
    title: 'Finished turns',
    hint: 'Chats started here, or any chat in Away mode.',
  },
  agent_started: { title: 'Chat started', hint: 'Every new chat.' },
};

function Switch({
  on,
  label,
  disabled,
  onChange,
  testId,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      data-testid={testId}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
        on ? 'bg-primary' : 'bg-input',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-5 rounded-full bg-background shadow-sm transition-transform',
          on ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

const SUPPORT_TEXT: Record<Exclude<PushSupport['kind'], 'supported'>, string> = {
  not_configured: 'Push isn’t set up on this server.',
  insecure: 'Push needs HTTPS.',
  ios_install_required: 'On iPhone/iPad: Share → Add to Home Screen, then enable push in that app.',
  unsupported: 'This browser doesn’t support push.',
};

function PushThisDevice({ serverAvailable, onChanged }: { serverAvailable: boolean; onChanged: () => void }) {
  // Browser-only facts: read on the client, null during server rendering.
  const kind = useSyncExternalStore(
    noopSubscribe,
    () => browserPushSupport().kind,
    () => null,
  );
  const localReg = useSyncExternalStore(noopSubscribe, hasLocalRegistration, () => false);
  const [override, setEnabled] = useState<boolean | null>(null);
  const enabled = override ?? localReg;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  useEffect(() => {
    // Keep this browser's registration current (tokens rotate; the account may have changed).
    if (localReg && kind === 'supported') void refreshPushRegistration().catch(() => undefined);
  }, [localReg, kind]);

  if (!kind) return null;
  const support = { kind } as PushSupport;
  const text =
    support.kind !== 'supported'
      ? SUPPORT_TEXT[support.kind]
      : !serverAvailable
        ? 'This server can’t send push yet.'
        : null;

  const run = async (fn: () => Promise<void>, ok: string, next: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setEnabled(next);
      setMessage({ kind: 'ok', text: ok });
      onChanged();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="push-this-device" data-support={support.kind}>
      {text && <p className="text-sm text-muted-foreground">{text}</p>}
      <div className="flex flex-wrap gap-2">
        {support.kind === 'supported' &&
          (enabled ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => run(disablePush, 'Push turned off on this device.', false)}
            >
              Turn off push on this device
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy}
              data-testid="enable-push"
              onClick={() => run(enablePush, 'Push is on for this device.', true)}
            >
              Enable push on this device
            </Button>
          ))}
      </div>
      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={cn('text-sm', message.kind === 'error' ? 'text-destructive' : 'text-success')}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function NotificationSettings() {
  const fetcher = useCallback(
    (signal: AbortSignal) => apiRequest('/notification-settings', NotificationSettingsDto, { signal }),
    [],
  );
  const { state, refresh } = usePoll(['notification-settings'], fetcher, 5 * 60_000);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState<Settings | null>(null);
  const settings = override ?? state.data;
  const [quiet, setQuiet] = useState<{ start: string; end: string } | null>(null);

  const save = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      setOverride(
        await apiRequest('/notification-settings', NotificationSettingsDto, { method: 'PUT', body }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (state.status === 'loading')
    return <div className="h-24 animate-pulse rounded-lg bg-muted" aria-busy="true" />;
  if (!settings)
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.error}
      </p>
    );

  const q =
    quiet ??
    (settings.quietHours ? { start: settings.quietHours.start, end: settings.quietHours.end } : null);

  return (
    <div className="flex flex-col gap-6" data-testid="notification-settings">
      <div>
        <h3 className="mb-2 text-sm font-medium">Push on this device</h3>
        <PushThisDevice
          serverAvailable={settings.push.available}
          onChanged={() => void refresh().then(() => setOverride(null))}
        />
      </div>

      <div>
        <h3 className="text-sm font-medium">What to notify</h3>
        <ul className="mt-1 divide-y">
          {(Object.keys(NOTIFICATION_CATEGORIES) as NotificationCategory[]).map((c) => (
            <li key={c} className="flex items-center justify-between gap-4 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">{LABELS[c].title}</p>
                <p className="text-xs text-pretty text-muted-foreground">{LABELS[c].hint}</p>
              </div>
              <Switch
                on={settings.categories[c]}
                label={LABELS[c].title}
                disabled={saving}
                testId={`category-${c}`}
                onChange={() => void save({ categories: { [c]: !settings.categories[c] } })}
              />
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">Quiet hours</h3>
            <p className="text-xs text-muted-foreground">No pushes, except permission requests.</p>
          </div>
          <Switch
            on={settings.quietHours !== null}
            label="Quiet hours"
            disabled={saving}
            testId="quiet-switch"
            onChange={() => {
              if (settings.quietHours) {
                setQuiet(null);
                void save({ quietHours: null });
              } else {
                const def = { start: '22:00', end: '07:00' };
                setQuiet(def);
                void save({ quietHours: { ...def, timezone: browserTimeZone() } });
              }
            }}
          />
        </div>
        {settings.quietHours && q && (
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save({ quietHours: { ...q, timezone: browserTimeZone() } });
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              From
              <Input
                type="time"
                required
                value={q.start}
                onChange={(e) => setQuiet({ ...q, start: e.target.value })}
                className="w-32"
                data-testid="quiet-start"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              To
              <Input
                type="time"
                required
                value={q.end}
                onChange={(e) => setQuiet({ ...q, end: e.target.value })}
                className="w-32"
              />
            </label>
            <Button type="submit" size="sm" variant="outline" disabled={saving} data-testid="quiet-save">
              Save
            </Button>
            <p className="w-full text-xs text-muted-foreground" data-testid="quiet-timezone">
              Time zone: {settings.quietHours.timezone}
            </p>
          </form>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
