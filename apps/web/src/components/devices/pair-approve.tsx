'use client';

import { PairingRequestResponse, type PairingRequestDto } from '@pocket-agent/protocol';
import { Laptop } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { apiRequest } from '@/lib/api';
import { usePoll } from '@/lib/use-poll';

const PLATFORM: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

const DONE: Partial<Record<PairingRequestDto['status'], { title: string; body: string }>> = {
  approved: { title: 'Approved', body: 'Your PC is connecting. It shows “Paired” in a moment.' },
  paired: { title: 'Connected', body: 'This PC is now on your account.' },
  declined: {
    title: 'Declined',
    body: 'The PC was not connected. Run `pocket-agent connect` again to retry.',
  },
  expired: { title: 'Expired', body: 'This QR code expired. Run `pocket-agent connect` on the PC again.' },
};

/**
 * Approving a PC that asked to be paired (its QR code leads here): which PC it is and the check
 * code it shows, so you can tell it is yours, then Approve or Decline.
 */
export function PairApprove() {
  const { id } = useParams<{ id: string }>();
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      apiRequest(`/pairing/requests/${encodeURIComponent(id)}`, PairingRequestResponse, { signal }).then(
        (r) => r.request,
      ),
    [id],
  );
  const { state, refresh } = usePoll(['pairing', id], fetcher, 3000);
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(action: 'approve' | 'decline') {
    setBusy(action);
    setError(null);
    try {
      await apiRequest(`/pairing/requests/${encodeURIComponent(id)}/${action}`, PairingRequestResponse, {
        method: 'POST',
      });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const r = state.data;
  const done = r ? DONE[r.status] : undefined;
  return (
    <div className="mx-auto grid max-w-md gap-4 py-6" data-testid="pair-approve">
      <h1 className="text-xl font-semibold">Connect a PC</h1>
      {state.status === 'loading' && <Card className="h-40 animate-pulse" aria-busy="true" />}
      {state.status === 'error' && (
        <Card>
          <p className="text-sm">This pairing link isn’t valid any more.</p>
          <p className="text-sm text-muted-foreground">
            Run <code className="font-mono">pocket-agent connect</code> on the PC for a new QR code.
          </p>
        </Card>
      )}
      {r && (
        <Card>
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-muted">
              <Laptop className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{r.name}</p>
              <p className="text-sm text-muted-foreground">
                {PLATFORM[r.platform] ?? r.platform} · Pocket Agent {r.agentVersion}
              </p>
            </div>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <p className="text-xs text-muted-foreground">Check code (the PC shows the same)</p>
            <p className="mt-1 font-mono text-2xl font-semibold tracking-[0.3em]" data-testid="pair-check">
              {r.check}
            </p>
          </div>
          {done ? (
            <div role="status" data-testid="pair-done">
              <p className="font-medium">{done.title}</p>
              <p className="text-sm text-muted-foreground">{done.body}</p>
              {(r.status === 'paired' || r.status === 'approved') && (
                <Button asChild variant="outline" className="mt-3">
                  <Link href="/devices">Go to Devices</Link>
                </Button>
              )}
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Approve only if this is your PC and the codes match. It can then show your Claude Code
                sessions here and run what you send it.
              </p>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" disabled={!!busy} onClick={() => void answer('decline')}>
                  {busy === 'decline' ? 'Declining…' : 'Decline'}
                </Button>
                <Button
                  disabled={!!busy}
                  onClick={() => void answer('approve')}
                  data-testid="pair-approve-button"
                >
                  {busy === 'approve' ? 'Approving…' : 'Approve'}
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
