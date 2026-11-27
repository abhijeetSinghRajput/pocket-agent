'use client';

import { CommandResponse, DeviceListResponse, type DeviceDto } from '@pocket-agent/protocol';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { TerminalGuide } from '@/components/ui/terminal-guide';
import { apiRequest } from '@/lib/api';
import { routes } from '@/lib/nav';
import { commandError, NEW_CHAT_MODE, newChatModel, waitForSession } from '@/lib/commands';

const fetchCommand = (id: string) => apiRequest(`/commands/${id}`, CommandResponse).then((r) => r.command);

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
        body: {
          projectPath,
          text: text.trim(),
          idempotencyKey: key.current,
          // New chats start in Auto with Opus, like on the phone.
          permissionMode: NEW_CHAT_MODE,
          ...(newChatModel(device.models) ? { model: newChatModel(device.models) } : {}),
        },
      });
      command = await waitForSession(command, fetchCommand);
      if (command.sessionId) {
        onOpenChange(false);
        setText('');
        router.push(routes.chat(command.sessionId));
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
      title="New chat"
      description="Claude Code starts on your PC, in the project you pick."
    >
      {devices === null && !error && (
        <div className="h-40 animate-pulse rounded-lg bg-muted" aria-busy="true" />
      )}

      {devices !== null && usable.length === 0 && (
        <div className="flex flex-col gap-2.5 text-sm" data-testid="no-projects">
          <p className="font-medium">
            {devices.some((d) => d.status === 'Online')
              ? 'Allow a project folder on your PC first:'
              : 'Your PC is offline. Start Pocket Agent on it, then allow a project folder:'}
          </p>
          <TerminalGuide
            steps={[
              {
                command: String.raw`pocket-agent projects add C:\work\my-app`,
                output: String.raw`Allowed: C:\work\my-app`,
              },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            Use your own folder. Only allowed folders can be opened.
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
            <p className="text-xs text-muted-foreground">Anything that needs permission asks you here.</p>
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
