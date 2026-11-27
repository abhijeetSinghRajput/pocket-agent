'use client';

import { recentWorkspaces } from '@pocket-agent/core';
import {
  DeviceListResponse,
  FolderListResponse,
  SessionListResponse,
  type DeviceDto,
} from '@pocket-agent/protocol';
import {
  ArrowLeft,
  ChevronRight,
  CircleCheck,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  History,
  Info,
  Monitor,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CopyMark, useCopy } from '@/components/ui/copy-button';
import { Modal } from '@/components/ui/dialog';
import { playSound } from '@/components/ui/sound';
import { TerminalGuide } from '@/components/ui/terminal-guide';
import { apiRequest } from '@/lib/api';
import { routes } from '@/lib/nav';
import { useLiveEvents } from '@/lib/live';
import { usePoll } from '@/lib/use-poll';
import { cn } from '@/lib/utils';

type Folder = { name: string; path: string };
/** A folder being browsed, on one PC. */
export type Place = Folder & { deviceId: string };
type Listing =
  { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: FolderListResponse };

/** Where a picked folder opens: a chat that has not started yet (the first message starts it). */
export const newChatHref = (place: Place) => routes.newChat(place);

/** The PCs, shared with every other screen that shows them (one cache entry). */
export function useDevices() {
  const fetcher = useCallback(
    (signal: AbortSignal) => apiRequest('/devices', DeviceListResponse, { signal }).then((r) => r.devices),
    [],
  );
  return usePoll(['devices'], fetcher, 60_000);
}

function useAllSessions() {
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      apiRequest('/sessions?scope=all', SessionListResponse, { signal }).then((r) => r.sessions),
    [],
  );
  return usePoll(['sessions', 'all'], fetcher, 30_000);
}

/** The command that allows a folder on this PC: the fixed part, and an example folder for its system. */
const addCommand = (platform: DeviceDto['platform']) => ({
  base: 'pocket-agent projects add',
  folder: platform === 'windows' ? String.raw`"C:\path\to\folder"` : '~/path/to/folder',
});

const backButton =
  'grid size-10 shrink-0 place-items-center rounded-full text-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * Adding a workspace: it is done on the PC (only the PC decides which folders may be used from
 * here), so this shows the command to run there, with a copy button, and follows the PC until the
 * new folder arrives.
 */
function AddWorkspace({ device, onDone }: { device: DeviceDto; onDone: () => void }) {
  const { state, refresh } = useDevices();
  const [before] = useState(() => new Set(device.projects.map((p) => p.path)));
  const now = state.data?.find((d) => d.id === device.id);
  const added = now?.projects.find((p) => !before.has(p.path));
  const cmd = addCommand(device.platform);
  const [copied, copy] = useCopy(`${cmd.base} ${cmd.folder}`, 1800);
  useEffect(() => {
    if (added) return;
    const id = setInterval(() => void refresh(), 2000);
    return () => clearInterval(id);
  }, [added, refresh]);
  useEffect(() => {
    if (added) playSound('success');
  }, [added]);

  return (
    <div className="content-in flex flex-col gap-4" data-testid="add-workspace">
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex min-w-0 items-center gap-2">
          <Monitor className="size-4 shrink-0" aria-hidden />
          <span className="truncate">
            Run on <span className="font-medium text-foreground">{device.name}</span>
          </span>
        </span>
      </div>

      <div
        aria-label={`Command: ${cmd.base} ${cmd.folder}`}
        className="rounded-xl bg-[#17171a] p-4 font-mono text-sm leading-[22px] text-[#f1f1f3] [overflow-wrap:anywhere] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]"
      >
        <span className="text-primary" aria-hidden>
          ❯{' '}
        </span>
        {cmd.base} <span className="text-primary">{cmd.folder}</span>
      </div>

      {added ? (
        <Button size="lg" className="w-full" onClick={onDone} data-testid="add-workspace-done">
          <CircleCheck aria-hidden /> Done
        </Button>
      ) : (
        <Button
          size="lg"
          className="w-full [--copy-ok:white]"
          onClick={copy}
          data-sound="copy"
          data-testid="add-workspace-copy"
        >
          <CopyMark copied={copied} /> {copied ? 'Copied' : 'Copy command'}
        </Button>
      )}

      <div aria-live="polite" className="flex items-center justify-center gap-2.5 text-sm">
        {added ? (
          <CircleCheck key="added" className="rise-in size-4 text-success" strokeWidth={2.4} aria-hidden />
        ) : (
          <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden />
        )}
        <span key={added ? 'yes' : 'no'} className="content-in min-w-0 truncate">
          {added ? (
            <>
              <span className="font-medium">{added.name}</span> was added
            </>
          ) : (
            <span className="text-muted-foreground">Waiting for folder…</span>
          )}
        </span>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Use your own folder. A workspace opens every folder inside it, so a parent folder is often enough.
      </p>
    </div>
  );
}

/** A PC's section title, with an (i) that says where its workspaces come from. */
function WorkspacesHeader({ device }: { device: DeviceDto }) {
  const [info, setInfo] = useState(false);
  return (
    <div className="mt-1 mb-1">
      <div className="flex items-center gap-0.5">
        <h3 className="truncate text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Workspaces on {device.name}
        </h3>
        <button
          type="button"
          aria-label="About workspaces"
          aria-expanded={info}
          onClick={() => setInfo((v) => !v)}
          data-testid="workspaces-info"
          className="grid size-[30px] shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Info className="size-4" aria-hidden />
        </button>
      </div>
      {info && (
        <p className="content-in mb-1.5 text-xs text-muted-foreground">
          Folders the PC allows Pocket Agent to use. Open one to pick any folder inside it; add more with Add
          a workspace.
        </p>
      )}
    </div>
  );
}

const usableDevices = (all: DeviceDto[] | null) =>
  (all ?? []).filter((d) => d.status === 'Online' && d.projects.length > 0);

/** Each row of a list rising in after the one above it. */
const rise = (index: number) => ({ animationDelay: `${Math.min(index, 10) * 40}ms` });

/**
 * New chat, like a file browser: the PCs and the folders their owner allowed. Clicking a folder
 * opens it (the folders inside it, asked of the PC live); "Open in chat" opens the folder named in
 * the header in a new chat, where the first message starts Claude Code. As in the app.
 */
export function NewSessionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { state, refresh } = useDevices();
  const sessions = useAllSessions().state.data;
  // Folders opened, deepest last. Empty: the PCs and their projects.
  const [trail, setTrail] = useState<Place[]>([]);
  const [listing, setListing] = useState<Listing>({ status: 'loading' });
  // The PC a workspace is being added to (the dialog shows how).
  const [adding, setAdding] = useState<DeviceDto | null>(null);
  // What each folder held when it was last listed: going back shows it at once.
  const seen = useRef(new Map<string, FolderListResponse>());
  const here = trail.at(-1);

  // Opening: the PCs as they are now, from the top.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setTrail([]);
      setAdding(null);
      seen.current.clear();
      void refresh();
    }, 0);
    return () => clearTimeout(t);
  }, [open, refresh]);

  // Opening a folder: ask the PC what is inside it.
  useEffect(() => {
    if (!here) return;
    const key = `${here.deviceId}|${here.path}`;
    let live = true;
    const t = setTimeout(() => {
      const known = seen.current.get(key);
      setListing(known ? { status: 'ready', data: known } : { status: 'loading' });
      apiRequest(
        `/devices/${here.deviceId}/folders?path=${encodeURIComponent(here.path)}`,
        FolderListResponse,
      )
        .then((data) => {
          seen.current.set(key, data);
          if (live) setListing({ status: 'ready', data });
        })
        .catch((err: Error) => {
          if (live && !known) setListing({ status: 'error', error: err.message });
        });
    }, 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [here]);

  const devices = state.data;
  const usable = usableDevices(devices);
  // Where you chatted lately: one click starts a new chat there.
  const recent = recentWorkspaces(sessions ?? [], devices ?? []);
  const into = (deviceId: string, f: Folder) => setTrail((t) => [...t, { ...f, deviceId }]);
  const up = () => setTrail((t) => t.slice(0, -1));

  // `pocket-agent projects add` on the PC while "Add a workspace" is open: go to that folder (new,
  // or already allowed), ready to open in a chat.
  useLiveEvents((e) => {
    if (e.eventType !== 'device.workspace.focus' || !open || !adding || e.deviceId !== adding.id) return;
    const path = e.payload.path;
    const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
    playSound('success');
    setAdding(null);
    setTrail([{ deviceId: adding.id, name, path }]);
  });

  // A link (not a push after closing): on a phone, closing gives back the dialog's history step,
  // and a link keeps the step it navigates to.
  const close = () => onOpenChange(false);

  const header = adding ? (
    <div className="content-in -my-1.5 -ml-2 flex items-center gap-2">
      <button
        type="button"
        aria-label="Back"
        onClick={() => setAdding(null)}
        data-testid="add-workspace-back"
        className={backButton}
      >
        <ArrowLeft className="size-5" aria-hidden />
      </button>
      <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">Add a workspace</h2>
    </div>
  ) : here ? (
    <div key={`head-${here.path}`} className="content-in -my-1.5 -ml-2 flex items-center gap-2">
      <button type="button" aria-label="Back" onClick={up} data-testid="folder-back" className={backButton}>
        <ArrowLeft className="size-5" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg leading-tight font-semibold">{here.name}</h2>
        <p className="truncate font-mono text-xs text-muted-foreground">{here.path}</p>
      </div>
    </div>
  ) : undefined;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="New chat"
      description="Pick a folder on your PC. Claude Code starts there."
      header={header}
    >
      {adding ? (
        <AddWorkspace device={adding} onDone={() => setAdding(null)} />
      ) : (
        <>
          <div className="relative -mx-1">
            <div
              key={here?.path ?? 'top'}
              className={cn(
                'overflow-y-auto px-1',
                here ? 'max-h-[min(58dvh,30rem)] pb-6' : 'max-h-[min(66dvh,34rem)] pb-2',
              )}
            >
              {here ? (
                listing.status === 'loading' ? (
                  <div className="flex flex-col gap-2.5" aria-busy="true">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
                    ))}
                  </div>
                ) : listing.status === 'error' ? (
                  <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {listing.error}
                  </p>
                ) : listing.data.folders.length === 0 ? (
                  <div className="content-in flex flex-col items-center gap-2 px-4 py-8 text-center">
                    <FolderOpen className="size-8 text-muted-foreground" aria-hidden />
                    <p className="text-sm font-semibold">No folders inside</p>
                    <p className="text-sm text-muted-foreground">Open this folder in a chat, or go back.</p>
                  </div>
                ) : (
                  <>
                    {listing.data.folders.map((f, i) => (
                      <FolderRow
                        key={f.path}
                        folder={f}
                        index={i}
                        // Inside a folder: its path is in the header, so each row is just a name.
                        path={false}
                        chevron
                        onClick={() => into(here.deviceId, f)}
                      />
                    ))}
                    {listing.data.truncated && (
                      <p className="mt-2 text-center text-xs text-muted-foreground">
                        Only the first {listing.data.folders.length} folders are shown.
                      </p>
                    )}
                  </>
                )
              ) : (
                <>
                  {devices === null && !state.error && (
                    <div className="h-28 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
                  )}
                  {devices === null && state.error && (
                    <p
                      role="alert"
                      className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    >
                      {state.error}
                    </p>
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

                  {recent.length > 0 && (
                    <section data-testid="recent-workspaces" className="mb-2">
                      <h3 className="mt-1 mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                        Recent
                      </h3>
                      {recent.map((w, i) => (
                        <FolderRow
                          key={`${w.deviceId}|${w.path}`}
                          folder={w}
                          index={i}
                          icon="recent"
                          hint={`Starts a new chat here, on ${w.deviceName}`}
                          href={newChatHref(w)}
                          onClick={close}
                        />
                      ))}
                    </section>
                  )}

                  {usable.map((d) => (
                    <section key={d.id} className="mb-2">
                      <WorkspacesHeader device={d} />
                      {d.projects.map((p, i) => (
                        <FolderRow
                          key={p.path}
                          folder={p}
                          index={i}
                          chevron
                          subtitle="Browse folders inside"
                          onClick={() => into(d.id, p)}
                        />
                      ))}
                      <AddWorkspaceRow index={d.projects.length} onClick={() => setAdding(d)} />
                    </section>
                  ))}
                </>
              )}
            </div>
            {here && (
              // The last folders fade out under the button.
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-popover to-transparent"
              />
            )}
          </div>
          {here && (
            <Button asChild size="lg" className="mt-2 w-full rounded-full">
              <Link href={newChatHref(here)} onClick={close} data-testid="open-in-chat">
                Open in chat
              </Link>
            </Button>
          )}
        </>
      )}
    </Modal>
  );
}

/** One folder, like a file browser's row: click to open it. */
function FolderRow({
  folder,
  index,
  onClick,
  href,
  hint = 'Shows the folders inside it',
  icon = 'folder',
  path = true,
  chevron = false,
  subtitle,
}: {
  folder: Folder;
  index: number;
  onClick: () => void;
  /** Opens this address instead (a recent workspace opens straight in a new chat). */
  href?: string;
  hint?: string;
  /** Its full path under the name (left out where the path is already shown above). */
  path?: boolean;
  /** A recent workspace opens straight in a chat: it shows a clock on its folder. */
  icon?: 'folder' | 'recent';
  /** A chevron at the end: it opens to the folders inside. */
  chevron?: boolean;
  /** A line under the path (e.g. "Browse folders inside"). */
  subtitle?: string;
}) {
  const props = {
    'aria-label': icon === 'recent' ? `New chat in ${folder.name}` : `Open ${folder.name}`,
    title: hint,
    onClick,
    'data-testid': 'folder-row',
    style: rise(index),
    className:
      'rise-in flex w-full items-center gap-3.5 rounded-lg px-1 py-[9px] text-left outline-none transition-[background-color,scale] duration-150 hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.985]',
  };
  const body = (
    <>
      <span className="relative shrink-0" aria-hidden>
        <FolderIcon className="size-[34px] fill-warning text-warning" strokeWidth={1.2} />
        {icon === 'recent' && (
          <span className="absolute -right-[3px] bottom-px rounded-full bg-popover p-[1.5px]">
            <History className="size-[13px] text-foreground" strokeWidth={2.4} />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{folder.name}</span>
        {path && (
          <span className="block truncate font-mono text-xs text-muted-foreground">{folder.path}</span>
        )}
        {subtitle && <span className="block truncate text-xs text-primary">{subtitle}</span>}
      </span>
      {chevron && <ChevronRight className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />}
    </>
  );
  return href ? (
    <Link href={href} {...props}>
      {body}
    </Link>
  ) : (
    <button type="button" {...props}>
      {body}
    </button>
  );
}

/** Under a PC's workspaces: allow another folder. A secondary button, dashed all round. */
function AddWorkspaceRow({ index, onClick }: { index: number; onClick: () => void }) {
  return (
    <button
      type="button"
      title="Shows how to allow another folder on this PC"
      onClick={onClick}
      data-testid="add-workspace-row"
      style={rise(index)}
      className="rise-in mt-1.5 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-secondary-foreground/28 bg-secondary text-[15px] font-medium text-secondary-foreground outline-none transition-[background-color,scale] duration-150 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.985]"
    >
      <FolderPlus className="size-[18px]" aria-hidden />
      Add a workspace
    </button>
  );
}
