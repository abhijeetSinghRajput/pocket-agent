'use client';

import {
  NOTIFICATION_CATEGORIES,
  NotificationSettingsDto,
  type NotificationCategory,
  type NotificationSettingsDto as Settings,
} from '@pocket-agent/protocol';
import { BellRing } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Switch } from '@/components/ui/switch';
import { apiRequest } from '@/lib/api';
import {
  disablePush,
  enablePush,
  PUSH_UNSUPPORTED_TEXT,
  pushChanged,
  refreshPushRegistration,
  usePushStatus,
} from '@/lib/push';
import { usePoll } from '@/lib/use-poll';
import { cn } from '@/lib/utils';

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

/**
 * Notifications on this device: one switch, as in the app. Off by default; turning it on asks the
 * browser for permission and registers it with the account (web push through the service worker).
 */
function PushThisDevice({ serverAvailable, onChanged }: { serverAvailable: boolean; onChanged: () => void }) {
  const status = usePushStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep this browser's registration current (tokens rotate; the account may have changed).
  const refreshed = useRef(false);
  useEffect(() => {
    if (status !== 'on' || refreshed.current) return;
    refreshed.current = true;
    void refreshPushRegistration().catch(() => undefined);
  }, [status]);

  const toggle = async (on: boolean) => {
    if (!status || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (on) await enablePush();
      else await disablePush();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      pushChanged();
      setBusy(false);
    }
  };

  if (!status) return null;
  const unsupported = status !== 'on' && status !== 'off' && status !== 'denied';
  const on = status === 'on';
  const hint = unsupported
    ? PUSH_UNSUPPORTED_TEXT[status]
    : !serverAvailable
      ? 'Push is not set up on the server.'
      : status === 'denied'
        ? 'Notifications are blocked for this site. Allow them in your browser’s site settings.'
        : on
          ? 'Permission requests and activity reach you here.'
          : 'Get permission requests and activity when the app is closed.';

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="push-this-device"
      data-support={unsupported ? status : 'supported'}
      data-status={status}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-xl transition-colors',
            on ? 'bg-primary/13 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          <BellRing className="size-[18px]" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">Notifications on this device</p>
          <p className="text-xs text-pretty text-muted-foreground" data-testid="push-hint">
            {hint}
          </p>
        </div>
        <Switch
          on={on}
          label="Notifications on this device"
          disabled={busy || unsupported || !serverAvailable || status === 'denied'}
          onChange={(next) => void toggle(next)}
          testId="push-switch"
        />
      </div>
      {/* Blocked: the line above already says where to allow it. */}
      {error && status !== 'denied' && <Notice>{error}</Notice>}
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
                on={settings.categories[c] ?? false}
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
                data-testid="quiet-end"
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
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
