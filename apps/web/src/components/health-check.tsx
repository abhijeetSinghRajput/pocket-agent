'use client';

import { pcHealth, type HealthCheck } from '@pocket-agent/core';
import { DeviceListResponse, NotificationSettingsDto } from '@pocket-agent/protocol';
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Download,
  Info,
  Laptop,
  MonitorSmartphone,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { apiRequest } from '@/lib/api';
import { useLiveRefresh } from '@/lib/live';
import { enablePush, PUSH_UNSUPPORTED_TEXT, pushChanged, usePushStatus } from '@/lib/push';
import { usePoll } from '@/lib/use-poll';
import { cn } from '@/lib/utils';

const LOOK: Record<HealthCheck['state'], { icon: LucideIcon; tone: string }> = {
  ok: { icon: CircleCheck, tone: 'text-success' },
  warn: { icon: CircleAlert, tone: 'text-warning' },
  fail: { icon: CircleX, tone: 'text-destructive' },
  info: { icon: Info, tone: 'text-muted-foreground' },
};

/** A command to run on the PC, with a copy button. */
function Command({ text }: { text: string }) {
  return (
    <div className="mt-1.5 flex items-center gap-1 rounded-md bg-muted pl-2.5">
      <code className="min-w-0 flex-1 py-2 font-mono text-[12.5px] leading-[18px] whitespace-pre-wrap [overflow-wrap:anywhere]">
        {text}
      </code>
      <CopyButton value={text} label="Copy command" />
    </div>
  );
}

function Row({
  check,
  children,
}: {
  check: Pick<HealthCheck, 'label' | 'state' | 'detail'>;
  children?: ReactNode;
}) {
  const { icon: Icon, tone } = LOOK[check.state];
  return (
    <li className="flex gap-2.5 py-2" data-testid={`health-${check.state}`}>
      <Icon className={cn('mt-px size-[18px] shrink-0', tone)} strokeWidth={2.2} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{check.label}</p>
        <p className="text-xs text-pretty text-muted-foreground">{check.detail}</p>
        {children}
      </div>
    </li>
  );
}

/** This device's notifications: on, or a button that turns them on (or why they can't be). */
function ThisDeviceRow() {
  const status = usePushStatus();
  const fetcher = useCallback(
    (signal: AbortSignal) => apiRequest('/notification-settings', NotificationSettingsDto, { signal }),
    [],
  );
  const { state: settings, refresh } = usePoll(['notification-settings'], fetcher, 5 * 60_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!status || !settings.data) return null;
  const on = status === 'on';
  const unsupported = status !== 'on' && status !== 'off' && status !== 'denied';
  const check: Pick<HealthCheck, 'label' | 'state' | 'detail'> = on
    ? {
        label: 'Notifications on',
        state: 'ok',
        detail: 'Requests reach this device when the app is closed.',
      }
    : unsupported
      ? { label: 'Notifications', state: 'info', detail: PUSH_UNSUPPORTED_TEXT[status] }
      : !settings.data.push.available
        ? { label: 'Notifications', state: 'info', detail: 'Push is not set up on the server.' }
        : {
            label: 'Notifications off',
            state: 'warn',
            detail:
              status === 'denied'
                ? 'Blocked for this site. Allow notifications in your browser’s site settings.'
                : 'You only see requests while the app is open.',
          };
  const canTurnOn = check.state === 'warn' && status === 'off';
  return (
    <Row check={check}>
      {canTurnOn && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={busy}
          data-testid="health-push-on"
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await enablePush();
              void refresh();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              pushChanged();
              setBusy(false);
            }
          }}
        >
          {busy ? 'Turning on…' : 'Turn on'}
        </Button>
      )}
      {error && status !== 'denied' && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </Row>
  );
}

function Heading({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <h3 className="mt-1 mb-0.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <Icon className="size-[15px] shrink-0" strokeWidth={2.2} aria-hidden />
      <span className="truncate">{text}</span>
    </h3>
  );
}

/**
 * Is everything set up: each PC online, up to date, linked to Claude Code, with phone approvals;
 * and this device's notifications. Each line that isn't right says how to fix it. As in the app.
 */
export function HealthCheckCard() {
  const fetcher = useCallback(
    (signal: AbortSignal) => apiRequest('/devices', DeviceListResponse, { signal }).then((r) => r.devices),
    [],
  );
  const { state, refresh } = usePoll(['devices'], fetcher, 60_000);
  useLiveRefresh(
    () => void refresh(),
    (e) => e.eventType === 'device.status.changed',
  );
  const pcs = (state.data ?? []).filter((d) => d.status !== 'Revoked');
  const problems = pcs
    .flatMap((d) => pcHealth(d))
    .filter((x) => x.state === 'warn' || x.state === 'fail').length;
  return (
    <section
      className="rounded-xl bg-card p-4"
      data-testid="health-check"
      aria-labelledby="health-check-heading"
    >
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h2
          id="health-check-heading"
          className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          Health check
        </h2>
        {state.data && (
          <span
            className={cn('text-xs font-medium', problems ? 'text-warning' : 'text-success')}
            data-testid="health-summary"
          >
            {problems ? `${problems} to fix` : 'All good'}
          </span>
        )}
      </div>
      {state.status === 'loading' && (
        <div className="h-[120px] animate-pulse rounded-lg bg-muted" aria-busy="true" />
      )}
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {pcs.map((d, i) => (
        <div key={d.id} className={cn(i > 0 && 'border-t pt-2')}>
          <Heading icon={Laptop} text={d.name} />
          <ul>
            {pcHealth(d).map((check) => (
              <Row key={check.key} check={check}>
                {check.state !== 'ok' && check.command && <Command text={check.command} />}
                {check.state !== 'ok' && check.link && (
                  <a
                    href={check.link}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: 'outline', size: 'sm', className: 'mt-2' })}
                  >
                    <Download aria-hidden />
                    Download
                  </a>
                )}
              </Row>
            ))}
          </ul>
        </div>
      ))}
      <div className={cn(pcs.length > 0 && 'mt-2 border-t pt-2')}>
        <Heading icon={MonitorSmartphone} text="This device" />
        <ul>
          <ThisDeviceRow />
        </ul>
      </div>
    </section>
  );
}
