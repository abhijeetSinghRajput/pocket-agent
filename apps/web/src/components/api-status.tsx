'use client';

import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fetchHealth, type HealthResult } from '@/lib/api';
import { cn } from '@/lib/utils';

const POLL_MS = 15_000;

function Dot({ tone }: { tone: 'success' | 'warning' | 'danger' | 'muted' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        tone === 'success' && 'bg-success',
        tone === 'warning' && 'bg-warning',
        tone === 'danger' && 'bg-destructive',
        tone === 'muted' && 'bg-muted-foreground/40',
      )}
    />
  );
}

export function ApiStatus() {
  const [result, setResult] = useState<HealthResult | null>(null);
  const [checking, setChecking] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setChecking(true);
    try {
      setResult(await fetchHealth(c.signal));
    } catch {
      /* aborted by a newer check */
    } finally {
      if (controller.current === c) setChecking(false);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      controller.current?.abort();
    };
  }, [refresh]);

  const badge =
    result === null ? (
      <Badge>Checking…</Badge>
    ) : result.kind === 'ok' ? (
      <Badge variant="success">Operational</Badge>
    ) : result.kind === 'degraded' ? (
      <Badge variant="warning">Degraded</Badge>
    ) : (
      <Badge variant="danger">Unreachable</Badge>
    );

  const tiles =
    result && result.kind !== 'unreachable'
      ? [
          { name: 'Database', dep: result.health.checks.database },
          { name: 'Redis', dep: result.health.checks.redis },
        ]
      : [];

  return (
    <section className="rounded-xl bg-card p-4" data-testid="api-status" aria-busy={checking}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Backend</h2>
        {badge}
      </div>

      {result === null && <div className="mt-3 h-[58px] animate-pulse rounded-lg bg-muted" aria-hidden />}

      {result?.kind === 'unreachable' && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {result.error}
        </p>
      )}

      {result && result.kind !== 'unreachable' && (
        <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
          {tiles.map(({ name, dep }) => (
            <div key={name} className="min-w-0 rounded-lg bg-muted px-3 py-2.5">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Dot tone={dep.status === 'up' ? 'success' : 'danger'} />
                <span className="truncate">{name}</span>
              </dt>
              <dd className="mt-1 truncate font-mono text-[13px]">
                {dep.status === 'up' ? `${dep.latencyMs ?? 0} ms` : (dep.error ?? 'down')}
              </dd>
            </div>
          ))}
          <div className="min-w-0 rounded-lg bg-muted px-3 py-2.5">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Dot tone="muted" />
              <span className="truncate">API version</span>
            </dt>
            <dd className="mt-1 truncate font-mono text-[13px]">{result.health.version}</dd>
          </div>
        </dl>
      )}

      <Button variant="outline" className="mt-3 w-full" onClick={() => void refresh()} disabled={checking}>
        <RefreshCw className={cn(checking && 'animate-spin')} aria-hidden />
        {checking ? 'Checking' : 'Check now'}
      </Button>
    </section>
  );
}
