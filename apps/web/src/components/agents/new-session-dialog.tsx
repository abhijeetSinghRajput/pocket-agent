'use client';

import { CommandResponse, DeviceListResponse, type DeviceDto } from '@agentdock/protocol';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { apiRequest } from '@/lib/api';
import { commandError } from '@/lib/commands';

const select =
  'h-11 w-full rounded-md border bg-background px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:h-10 sm:text-sm';

/** Starts a managed session in a folder the PC owner allow-listed, then opens it. */
export function NewSessionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [devices, setDevices] = useState<DeviceDto[] | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'form' | 'starting'>('form');
  const [error, setError] = useState<string | null>(null);
  const key = useRef(crypto.randomUUID());

  const load = useCallback(async () => {
    try {
      const { devices: all } = await apiRequest('/devices', DeviceListResponse);
      const usable = all.filter((d) => d.status === 'Online' && d.projects.length > 0);
      setDevices(all.filter((d) => d.status !== 'Revoked'));
      if (usable[0]) {
        setDeviceId(usable[0].id);
        setProjectPath(usable[0].projects[0]!.path);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setPhase('form');
      setError(null);
      key.current = crypto.randomUUID();
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [open, load]);

  const usable = (devices ?? []).filter((d) => d.status === 'Online' && d.projects.length > 0);
  const device = usable.find((d) => d.id === deviceId);

  async function start() {
    if (!device || !projectPath || !text.trim()) return;
    setPhase('starting');
    setError(null);
    try {
      let { command } = await apiRequest(`/devices/${device.id}/sessions`, CommandResponse, {
        method: 'POST',
        body: { projectPath, text: text.trim(), idempotencyKey: key.current },
      });
      // Wait for the PC to start Claude and report the new session.
      const deadline = Date.now() + 60_000;
      while (!command.sessionId && !['Failed', 'Expired'].includes(command.status) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        command = (await apiRequest(`/commands/${command.id}`, CommandResponse)).command;
      }
      if (command.sessionId) {
        onOpenChange(false);
        setText('');
        router.push(`/agents/${command.sessionId}`);
        return;
      }
      setError(commandError(command) ?? 'Your PC did not start the session in time.');
      setPhase('form');
      key.current = crypto.randomUUID();
    } catch (err) {
      setError((err as Error).message);
      setPhase('form');
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="New managed session"
      description="Claude Code starts on your PC in a project folder you allowed there."
    >
      {devices === null && !error && (
        <div className="h-40 animate-pulse rounded-lg bg-muted" aria-busy="true" />
      )}

      {devices !== null && usable.length === 0 && (
        <div className="space-y-3 text-sm" data-testid="no-projects">
          <p className="text-muted-foreground">
            {devices.some((d) => d.status === 'Online')
              ? 'None of your online PCs allow starting sessions yet. On the PC, allow a project folder:'
              : 'None of your PCs are online. Start the agent on your PC, and allow a project folder:'}
          </p>
          <code className="block rounded-md bg-muted px-3 py-2 font-mono text-[13px] break-all">
            pnpm agentdock projects add C:\path\to\project
          </code>
          <p className="text-xs text-muted-foreground">
            Only folders on that list can be used. This is enforced on the PC, so nobody can start Claude
            anywhere else from the dashboard.
          </p>
        </div>
      )}

      {usable.length > 0 && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ns-device" className="text-sm font-medium">
              PC
            </label>
            <select
              id="ns-device"
              className={select}
              value={deviceId}
              onChange={(e) => {
                setDeviceId(e.target.value);
                setProjectPath(usable.find((d) => d.id === e.target.value)?.projects[0]?.path ?? '');
              }}
            >
              {usable.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ns-project" className="text-sm font-medium">
              Project
            </label>
            <select
              id="ns-project"
              className={select}
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
            >
              {device?.projects.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.name} — {p.path}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ns-text" className="text-sm font-medium">
              First instruction
            </label>
            <textarea
              id="ns-text"
              rows={3}
              maxLength={20_000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Run the test suite and summarise failures"
              className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Actions that need permission are denied until remote approval arrives (M5). Your Claude Code
              settings apply.
            </p>
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={phase === 'starting' || !text.trim()} className="self-end">
            {phase === 'starting' ? 'Starting on your PC…' : 'Start session'}
          </Button>
        </form>
      )}

      {devices === null && error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Modal>
  );
}
