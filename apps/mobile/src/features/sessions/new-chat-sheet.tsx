import { recentWorkspaces } from '@pocket-agent/core';
import { FolderListResponse, type DeviceDto } from '@pocket-agent/protocol';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleCheck,
  Copy,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  History,
  Info,
  Monitor,
} from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { apiRequest } from '@/lib/api';
import { useDevices, useSessions } from '@/lib/data';
import { useLiveEvents } from '@/lib/live';
import { ease, enter, exit } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { Button, buzz, IconButton, Press, T, tap } from '@/ui/core';
import { EmptyState, Notice, Skeleton } from '@/ui/feedback';
import { Sheet } from '@/ui/sheet';
import { TerminalGuide } from '@/ui/terminal-guide';

type Folder = { name: string; path: string };
/** A folder being browsed, on one PC. */
export type Place = Folder & { deviceId: string };
type Listing =
  { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: FolderListResponse };

/** The command that allows a folder on this PC: the fixed part, and an example folder for its system. */
const addCommand = (platform: DeviceDto['platform']) => ({
  base: 'pocket-agent projects add',
  folder: platform === 'windows' ? String.raw`"C:\path\to\folder"` : '~/path/to/folder',
});

/** A terminal is one dark surface in both themes. */
const TERM = { bg: '#17171a', text: '#f1f1f3' };

/** A dot that breathes while the phone waits on the PC. */
function WaitingDot() {
  const { c } = useTheme();
  const o = useSharedValue(1);
  useEffect(() => {
    o.set(withRepeat(withTiming(0.3, { duration: 800, easing: ease.move }), -1, true));
  }, [o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary }, style]} />
  );
}

/**
 * Adding a workspace: it is done on the PC (only the PC decides which folders the phone may use),
 * so this shows the command to run there, with a copy button, and follows the PC until the new
 * folder arrives.
 */
function AddWorkspace({ device, onDone }: { device: DeviceDto; onDone: () => void }) {
  const { c } = useTheme();
  const { state, refresh } = useDevices();
  const [before] = useState(() => new Set(device.projects.map((p) => p.path)));
  const [copied, setCopied] = useState(false);
  const now = state.data?.find((d) => d.id === device.id);
  const added = now?.projects.find((p) => !before.has(p.path));
  const cmd = addCommand(device.platform);
  useEffect(() => {
    if (added) return;
    const id = setInterval(() => void refresh(), 2000);
    return () => clearInterval(id);
  }, [added, refresh]);
  useEffect(() => {
    if (added) buzz(true);
  }, [added]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  function copy() {
    void Clipboard.setStringAsync(`${cmd.base} ${cmd.folder}`)
      .then(() => {
        tap();
        setCopied(true);
      })
      .catch(() => undefined);
  }

  return (
    <Animated.View entering={enter.fade} style={{ gap: 16 }} testID="add-workspace">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: -6 }}>
        <IconButton
          icon={ArrowLeft}
          label="Back"
          tone="default"
          onPress={onDone}
          testID="add-workspace-back"
        />
        <T variant="heading" accessibilityRole="header" style={{ flex: 1 }} numberOfLines={1}>
          Add a workspace
        </T>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Monitor size={16} color={c.mutedForeground} strokeWidth={2} />
        <T variant="small" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
          Run on <T variant="smallMedium">{device.name}</T>
        </T>
      </View>

      <View
        accessibilityLabel={`Command: ${cmd.base} ${cmd.folder}`}
        style={{ padding: 16, borderRadius: radius.lg, backgroundColor: TERM.bg }}
      >
        <Text style={{ fontFamily: fonts.mono, fontSize: 14, lineHeight: 22, color: TERM.text }}>
          <Text style={{ color: c.primary }}>❯ </Text>
          {cmd.base} <Text style={{ color: c.primary }}>{cmd.folder}</Text>
        </Text>
      </View>

      {added ? (
        <Button label="Done" icon={CircleCheck} size="lg" full onPress={onDone} testID="add-workspace-done" />
      ) : (
        <Button
          label={copied ? 'Copied' : 'Copy command'}
          icon={copied ? Check : Copy}
          size="lg"
          full
          onPress={copy}
          testID="add-workspace-copy"
        />
      )}

      <View
        accessibilityLiveRegion="polite"
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}
      >
        {added ? (
          <Animated.View key="added" entering={enter.pop}>
            <CircleCheck size={16} color={c.success} strokeWidth={2.4} />
          </Animated.View>
        ) : (
          <WaitingDot />
        )}
        <Animated.View key={added ? 'yes' : 'no'} entering={enter.fade} style={{ flexShrink: 1 }}>
          {added ? (
            <T variant="small" numberOfLines={1}>
              <T variant="smallMedium">{added.name}</T> was added
            </T>
          ) : (
            <T variant="small" tone="muted">
              Waiting for folder…
            </T>
          )}
        </Animated.View>
      </View>

      <T variant="caption" tone="muted" center>
        Use your own folder. A workspace opens every folder inside it, so a parent folder is often enough.
      </T>
    </Animated.View>
  );
}

/** A PC's section title, with an (i) that says where its workspaces come from. */
function WorkspacesHeader({ device }: { device: DeviceDto }) {
  const [info, setInfo] = useState(false);
  return (
    <View style={{ marginTop: 4, marginBottom: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <T variant="overline" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
          Workspaces on {device.name}
        </T>
        <IconButton
          icon={Info}
          label="About workspaces"
          size={30}
          onPress={() => setInfo((v) => !v)}
          testID="workspaces-info"
        />
      </View>
      {info && (
        <Animated.View entering={enter.fade} exiting={exit.fade}>
          <T variant="caption" tone="muted" style={{ marginBottom: 6 }}>
            Folders the PC allows this phone to use. Open one to pick any folder inside it; add more with Add
            a workspace.
          </T>
        </Animated.View>
      )}
    </View>
  );
}

const usableDevices = (all: DeviceDto[] | null) =>
  (all ?? []).filter((d) => d.status === 'Online' && d.projects.length > 0);

/**
 * New chat, like a file browser: the PCs and the folders their owner allowed. Tapping a folder
 * opens it (the folders inside it, asked of the PC live); "Open in chat" opens the folder named in
 * the header in a new chat, where the first message starts Claude Code.
 */
export function NewChatSheet({
  open,
  onClose,
  start,
}: {
  open: boolean;
  onClose: () => void;
  /** Open inside this folder (a workspace picked elsewhere); back still goes up to the PCs. */
  start?: Place;
}) {
  const router = useRouter();
  const { c } = useTheme();
  const { height } = useWindowDimensions();
  const { state, refresh } = useDevices();
  const sessions = useSessions('all').state.data;
  // Folders opened, deepest last. Empty: the PCs and their projects.
  const [trail, setTrail] = useState<Place[]>([]);
  const [listing, setListing] = useState<Listing>({ status: 'loading' });
  // The PC a workspace is being added to (the sheet shows how).
  const [adding, setAdding] = useState<DeviceDto | null>(null);
  // What each folder held when it was last listed: going back shows it at once.
  const seen = useRef(new Map<string, FolderListResponse>());
  const here = trail.at(-1);

  // Opening: the PCs as they are now, from the top (or inside the folder it was opened on).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setTrail(start ? [start] : []);
      setAdding(null);
      seen.current.clear();
      void refresh();
    }, 0);
    return () => clearTimeout(t);
  }, [open, refresh, start]);

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
  // Where you chatted lately: one tap starts a new chat there.
  const recent = recentWorkspaces(sessions ?? [], devices ?? []);
  const into = (deviceId: string, f: Folder) => setTrail((t) => [...t, { ...f, deviceId }]);

  // `pocket-agent projects add` on the PC while "Add a workspace" is open: go to that folder (new,
  // or already allowed), ready to open in a chat.
  useLiveEvents((e) => {
    if (e.eventType !== 'device.workspace.focus' || !open || !adding || e.deviceId !== adding.id) return;
    const path = e.payload.path;
    const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
    buzz(true);
    setAdding(null);
    setTrail([{ deviceId: adding.id, name, path }]);
  });

  function openInChat(place: Place) {
    onClose();
    router.push({
      pathname: '/new-chat',
      params: { deviceId: place.deviceId, path: place.path, name: place.name },
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      // Back goes up one folder, like a file browser; at the top it closes.
      onBack={() => {
        if (adding) {
          setAdding(null);
          return true;
        }
        if (!here) return false;
        setTrail((t) => t.slice(0, -1));
        return true;
      }}
      title={adding || here ? undefined : 'New chat'}
      description={adding || here ? undefined : 'Pick a folder on your PC. Claude Code starts there.'}
    >
      {adding ? (
        <AddWorkspace device={adding} onDone={() => setAdding(null)} />
      ) : (
        <>
          {here && (
            <Animated.View
              key={`head-${here.path}`}
              entering={enter.fade}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, marginLeft: -6 }}
            >
              <IconButton
                icon={ArrowLeft}
                label="Back"
                tone="default"
                onPress={() => setTrail((t) => t.slice(0, -1))}
                testID="folder-back"
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="heading" numberOfLines={1} accessibilityRole="header">
                  {here.name}
                </T>
                <T variant="caption" tone="muted" numberOfLines={1} style={{ fontFamily: fonts.mono }}>
                  {here.path}
                </T>
              </View>
            </Animated.View>
          )}
          <View>
            <ScrollView
              key={here?.path ?? 'top'}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: Math.max(260, height * (here ? 0.58 : 0.66)) }}
              // Room under the last folder, so it can scroll clear of the fade.
              contentContainerStyle={{ paddingBottom: here ? 24 : 8 }}
            >
              {here ? (
                listing.status === 'loading' ? (
                  <View style={{ gap: 10 }}>
                    {[0, 1, 2, 3].map((i) => (
                      <Skeleton key={i} height={44} round={radius.md} />
                    ))}
                  </View>
                ) : listing.status === 'error' ? (
                  <Notice>{listing.error}</Notice>
                ) : listing.data.folders.length === 0 ? (
                  <EmptyState
                    icon={FolderOpen}
                    title="No folders inside"
                    body="Open this folder in a chat, or go back."
                  />
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
                        onPress={() => into(here.deviceId, f)}
                      />
                    ))}
                    {listing.data.truncated && (
                      <T variant="caption" tone="muted" center style={{ marginTop: 8 }}>
                        Only the first {listing.data.folders.length} folders are shown.
                      </T>
                    )}
                  </>
                )
              ) : (
                <>
                  {devices === null && !state.error && <Skeleton height={112} round={radius.xl} />}
                  {devices === null && state.error && <Notice>{state.error}</Notice>}

                  {devices !== null && usable.length === 0 && (
                    <View testID="no-projects" style={{ gap: 10 }}>
                      <T variant="smallMedium">
                        {devices.some((d) => d.status === 'Online')
                          ? 'Allow a project folder on your PC first:'
                          : 'Your PC is offline. Start Pocket Agent on it, then allow a project folder:'}
                      </T>
                      <TerminalGuide
                        steps={[
                          {
                            command: String.raw`pocket-agent projects add C:\work\my-app`,
                            output: String.raw`Allowed: C:\work\my-app`,
                          },
                        ]}
                      />
                      <T variant="caption" tone="muted">
                        Use your own folder. Only allowed folders can be opened.
                      </T>
                    </View>
                  )}

                  {recent.length > 0 && (
                    <View testID="recent-workspaces" style={{ marginBottom: 8 }}>
                      <T variant="overline" tone="muted" style={{ marginTop: 4, marginBottom: 4 }}>
                        Recent
                      </T>
                      {recent.map((w, i) => (
                        <FolderRow
                          key={`${w.deviceId}|${w.path}`}
                          folder={w}
                          index={i}
                          icon="recent"
                          hint={`Starts a new chat here, on ${w.deviceName}`}
                          onPress={() => openInChat(w)}
                        />
                      ))}
                    </View>
                  )}

                  {usable.map((d) => (
                    <View key={d.id} style={{ marginBottom: 8 }}>
                      <WorkspacesHeader device={d} />
                      {d.projects.map((p, i) => (
                        <FolderRow
                          key={p.path}
                          folder={p}
                          index={i}
                          chevron
                          subtitle="Browse folders inside"
                          onPress={() => into(d.id, p)}
                        />
                      ))}
                      <AddWorkspaceRow index={d.projects.length} onPress={() => setAdding(d)} />
                    </View>
                  ))}
                </>
              )}
            </ScrollView>
            {here && (
              // The last folders fade out under the button.
              <LinearGradient
                pointerEvents="none"
                colors={[alpha(c.popover, 0), c.popover]}
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 32 }}
              />
            )}
          </View>
          {here && (
            <Button
              label="Open in chat"
              size="lg"
              full
              onPress={() => openInChat(here)}
              style={{ borderRadius: radius.full, marginTop: 8 }}
              testID="open-in-chat"
            />
          )}
        </>
      )}
    </Sheet>
  );
}

/** One folder, like a file browser's row: tap to open it. */
export function FolderRow({
  folder,
  index,
  onPress,
  hint = 'Shows the folders inside it',
  icon = 'folder',
  path = true,
  chevron = false,
  subtitle,
}: {
  folder: Folder;
  index: number;
  onPress: () => void;
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
  const { c } = useTheme();
  return (
    <Animated.View entering={enter.rise(Math.min(index, 10))}>
      <Press
        accessibilityRole="button"
        accessibilityLabel={icon === 'recent' ? `New chat in ${folder.name}` : `Open ${folder.name}`}
        accessibilityHint={hint}
        onPress={onPress}
        scale={0.985}
        testID="folder-row"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingVertical: 9,
          paddingHorizontal: 4,
          borderRadius: radius.md,
        }}
      >
        <View>
          <FolderIcon size={34} color={c.warning} fill={c.warning} strokeWidth={1.2} />
          {icon === 'recent' && (
            <View
              style={{
                position: 'absolute',
                right: -3,
                bottom: 1,
                borderRadius: radius.full,
                backgroundColor: c.popover,
                padding: 1.5,
              }}
            >
              <History size={13} color={c.foreground} strokeWidth={2.4} />
            </View>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="bodyMedium" numberOfLines={1}>
            {folder.name}
          </T>
          {path && (
            <T variant="caption" tone="muted" numberOfLines={1} style={{ fontFamily: fonts.mono }}>
              {folder.path}
            </T>
          )}
          {subtitle && (
            <T variant="caption" tone="primary" numberOfLines={1}>
              {subtitle}
            </T>
          )}
        </View>
        {chevron && <ChevronRight size={18} color={c.mutedForeground} strokeWidth={2} />}
      </Press>
    </Animated.View>
  );
}

/** Under a PC's workspaces: allow another folder. A secondary button, dashed all round. */
function AddWorkspaceRow({ index, onPress }: { index: number; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Animated.View entering={enter.rise(Math.min(index, 10))} style={{ marginTop: 6 }}>
      <Press
        accessibilityRole="button"
        accessibilityLabel="Add a workspace"
        accessibilityHint="Shows how to allow another folder on this PC"
        onPress={onPress}
        scale={0.985}
        testID="add-workspace-row"
        style={{
          height: 48,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          borderRadius: radius.lg,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: alpha(c.secondaryForeground, 0.28),
          backgroundColor: c.secondary,
        }}
      >
        <FolderPlus size={18} color={c.secondaryForeground} strokeWidth={2} />
        <T variant="bodyMedium" style={{ color: c.secondaryForeground }}>
          Add a workspace
        </T>
      </Press>
    </Animated.View>
  );
}
