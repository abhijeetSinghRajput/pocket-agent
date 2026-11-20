'use client';

import {
  NOTIFICATION_CATEGORIES,
  NotificationSettingsDto,
  type NotificationCategory,
  type NotificationSettingsDto as Settings,
} from '@agentdock/protocol';
import Link from 'next/link';
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
    hint: 'Claude is waiting for your Allow/Deny. Pushed even in quiet hours.',
  },
  agent_failed: { title: 'Agent failures', hint: 'A turn ended with an error.' },
  device_disconnected: { title: 'PC offline', hint: 'A paired PC stopped responding for 2+ minutes.' },
  task_completed: {
    title: 'Finished turns',
    hint: 'Managed sessions, or any session while its PC is in Away mode.',
  },
  agent_started: { title: 'Session started', hint: 'Every new session. Off by default.' },
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
  not_configured: 'Push isn’t set up for this AgentDock deployment. Notifications still appear in the app.',
  insecure: 'Push needs HTTPS (or localhost). Open AgentDock over HTTPS to enable it on this device.',
  ios_install_required:
    'On iPhone and iPad (iOS 16.4+), push only works for the installed app: tap Share → Add to Home Screen, open AgentDock from the Home Screen, then enable push there.',
  unsupported: 'This browser doesn’t support web push. Notifications still appear in the app.',
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
        ? 'The AgentDock server can’t send push yet (FCM_SERVICE_ACCOUNT_FILE isn’t set). Notifications still appear in the app.'
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
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          data-testid="send-test"
          onClick={() =>
            run(
              async () => {
                const r = (await apiRequest('/notifications/test', null, { method: 'POST' })) as {
                  notification: { push: { sent: number; skipped: string | null } } | null;
                };
                const p = r.notification?.push;
                if (p && p.sent === 0 && p.skipped && p.skipped !== 'push_not_configured') {
                  throw new Error(
                    p.skipped === 'quiet_hours'
                      ? 'Recorded, but not pushed: it’s quiet hours.'
                      : p.skipped === 'no_browser_registered'
                        ? 'Recorded, but no browser has push enabled.'
                        : 'Recorded, but push delivery failed.',
                  );
                }
              },
              'Test sent. It’s in your notification history; a push should arrive within a few seconds.',
              enabled,
            )
          }
        >
          Send test notification
        </Button>
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
  const { state, refresh } = usePoll(fetcher, 5 * 60_000);
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
        <h3 className="text-sm font-medium">This device</h3>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">
          Push is a hint: delivery isn’t guaranteed and can be delayed by the browser or OS. Approvals and
          history always reflect the real state when you open AgentDock.{' '}
          {settings.push.subscriptions > 0 && `${settings.push.subscriptions} browser(s) registered.`}
        </p>
        <PushThisDevice
          serverAvailable={settings.push.available}
          onChanged={() => void refresh().then(() => setOverride(null))}
        />
      </div>

      <div>
        <h3 className="text-sm font-medium">What to notify</h3>
        <ul className="mt-2 divide-y rounded-lg border">
          {(Object.keys(NOTIFICATION_CATEGORIES) as NotificationCategory[]).map((c) => (
            <li key={c} className="flex items-center justify-between gap-4 px-3 py-3">
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
            <p className="text-xs text-muted-foreground">
              No pushes except permission requests. Still recorded in{' '}
              <Link href="/notifications" className="underline underline-offset-4">
                history
              </Link>
              .
            </p>
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
