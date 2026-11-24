import { recentWorkspaces } from '@pocket-agent/core';
import { FolderListResponse, type DeviceDto } from '@pocket-agent/protocol';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ArrowLeft, Folder as FolderIcon, FolderOpen, History } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { apiRequest } from '@/lib/api';
import { useDevices, useSessions } from '@/lib/data';
import { enter } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { Button, IconButton, Press, T } from '@/ui/core';
import { EmptyState, Notice, Skeleton } from '@/ui/feedback';
import { Sheet } from '@/ui/sheet';
import { TerminalGuide } from '@/ui/terminal-guide';

type Folder = { name: string; path: string };
/** A folder being browsed, on one PC. */
export type Place = Folder & { deviceId: string };
type Listing =
  { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: FolderListResponse };

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
  // What each folder held when it was last listed: going back shows it at once.
  const seen = useRef(new Map<string, FolderListResponse>());
  const here = trail.at(-1);

  // Opening: the PCs as they are now, from the top (or inside the folder it was opened on).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setTrail(start ? [start] : []);
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
        if (!here) return false;
        setTrail((t) => t.slice(0, -1));
        return true;
      }}
      title={here ? undefined : 'New chat'}
      description={here ? undefined : 'Pick a folder on your PC. Claude Code starts there.'}
    >
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
                  <FolderRow key={f.path} folder={f} index={i} onPress={() => into(here.deviceId, f)} />
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
                  <T variant="overline" tone="muted" style={{ marginTop: 4, marginBottom: 4 }}>
                    {d.name}
                  </T>
                  {d.projects.map((p, i) => (
                    <FolderRow key={p.path} folder={p} index={i} onPress={() => into(d.id, p)} />
                  ))}
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
}: {
  folder: Folder;
  index: number;
  onPress: () => void;
  hint?: string;
  /** A recent workspace opens straight in a chat: it shows a clock on its folder. */
  icon?: 'folder' | 'recent';
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
          <T variant="caption" tone="muted" numberOfLines={1} style={{ fontFamily: fonts.mono }}>
            {folder.path}
          </T>
        </View>
      </Press>
    </Animated.View>
  );
}
