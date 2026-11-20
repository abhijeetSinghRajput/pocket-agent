'use client';

import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

  return (
    <Card data-testid="api-status" aria-busy={checking}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Backend</CardTitle>
          <CardDescription className="mt-1.5">
            Live status of the Pocket Agent API and its dependencies.
          </CardDescription>
        </div>
        {badge}
      </CardHeader>

      {result === null && (
        <div className="space-y-2" aria-hidden>
          <div className="h-9 animate-pulse rounded-md bg-muted" />
          <div className="h-9 animate-pulse rounded-md bg-muted" />
        </div>
      )}

      {result?.kind === 'unreachable' && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {result.error}. Check that the API is running and NEXT_PUBLIC_API_URL is correct.
        </p>
      )}

      {result && result.kind !== 'unreachable' && (
        <dl className="divide-y rounded-lg border text-sm">
          {(
            [
              ['Database', result.health.checks.database],
              ['Redis', result.health.checks.redis],
            ] as const
          ).map(([name, dep]) => (
            <div key={name} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <dt className="flex items-center gap-2">
                <Dot tone={dep.status === 'up' ? 'success' : 'danger'} />
                {name}
              </dt>
              <dd className="truncate font-mono text-xs text-muted-foreground">
                {dep.status === 'up' ? `${dep.latencyMs ?? 0} ms` : (dep.error ?? 'down')}
              </dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <dt className="flex items-center gap-2">
              <Dot tone="muted" />
              API version
            </dt>
            <dd className="font-mono text-xs text-muted-foreground">{result.health.version}</dd>
          </div>
        </dl>
      )}

      <div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={checking}>
          <RefreshCw className={cn(checking && 'animate-spin')} aria-hidden />
          {checking ? 'Checking' : 'Check now'}
        </Button>
      </div>
    </Card>
  );
}
