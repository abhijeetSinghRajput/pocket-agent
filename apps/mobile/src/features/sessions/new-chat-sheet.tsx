import { FolderListResponse, type DeviceDto } from '@pocket-agent/protocol';
import { useRouter } from 'expo-router';
import { ArrowLeft, FolderOpen } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { AgentLogo, AGENT_LOGOS } from '@/features/sessions/badges';
import { apiRequest } from '@/lib/api';
import { useDevices } from '@/lib/data';
import { enter } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { Button, IconButton, T } from '@/ui/core';
import { EmptyState, Notice, Skeleton } from '@/ui/feedback';
import { Sheet } from '@/ui/sheet';
import { TerminalGuide } from '@/ui/terminal-guide';

type Folder = { name: string; path: string };
/** A folder being browsed, on one PC. */
type Place = Folder & { deviceId: string };
type Listing = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: FolderListResponse };

const usableDevices = (all: DeviceDto[] | null) =>
  (all ?? []).filter((d) => d.status === 'Online' && d.projects.length > 0);

/**
 * New chat: the PCs and the folders their owner allowed. Each folder can be browsed (the folders
 * inside it, asked of the PC live) or opened in a chat, where the first message starts Claude Code.
 */
export function NewChatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { height } = useWindowDimensions();
  const { state, refresh } = useDevices();
  // Folders browsed into, deepest last. Empty: the PCs and their projects.
  const [trail, setTrail] = useState<Place[]>([]);
  const [listing, setListing] = useState<Listing>({ status: 'loading' });
  // What each folder held when it was last listed: going back shows it at once.
  const seen = useRef(new Map<string, FolderListResponse>());
  const here = trail.at(-1);

  // Opening: the PCs as they are now, from the top.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setTrail([]);
      seen.current.clear();
      void refresh();
    }, 0);
    return () => clearTimeout(t);
  }, [open, refresh]);

  // Browsing into a folder: ask the PC what is inside it.
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

  function openInChat(deviceId: string, folder: Folder) {
    onClose();
    router.push({ pathname: '/new-chat', params: { deviceId, path: folder.path, name: folder.name } });
  }

  const card = (deviceId: string, f: Folder, i: number) => (
    <FolderCard
      key={f.path}
      folder={f}
      index={i}
      onBrowse={() => setTrail((t) => [...t, { ...f, deviceId }])}
      onOpen={() => openInChat(deviceId, f)}
    />
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={here ? undefined : 'New chat'}
      description={here ? undefined : 'Pick a folder on your PC. Claude Code starts there.'}
    >
      {here && (
        <Animated.View
          key={`head-${here.path}`}
          entering={enter.fade}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, marginLeft: -6 }}
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
      <ScrollView
        key={here?.path ?? 'top'}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: Math.max(260, height * 0.66) }}
        contentContainerStyle={{ paddingBottom: 8, gap: 10 }}
      >
        {here ? (
          listing.status === 'loading' ? (
            <>
              <Skeleton height={112} round={radius.xl} />
              <Skeleton height={112} round={radius.xl} />
            </>
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
              {listing.data.folders.map((f, i) => card(here.deviceId, f, i))}
              {listing.data.truncated && (
                <T variant="caption" tone="muted" center>
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

            {usable.map((d) => (
              <View key={d.id} style={{ gap: 10 }}>
                <T variant="smallMedium" tone="muted" style={{ marginTop: 4 }}>
                  {d.name}
                </T>
                {d.projects.map((p, i) => card(d.id, p, i))}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

/** One folder: who works in it, where it is, and the two ways in. */
function FolderCard({
  folder,
  index,
  onBrowse,
  onOpen,
}: {
  folder: Folder;
  index: number;
  onBrowse: () => void;
  onOpen: () => void;
}) {
  const { c } = useTheme();
  const logo = AGENT_LOGOS['claude-code'];
  return (
    <Animated.View
      entering={enter.rise(index)}
      testID="folder-card"
      style={{ backgroundColor: c.muted, borderRadius: radius.xl, padding: 14, gap: 12 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: alpha(logo.hex, 0.14),
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AgentLogo provider="claude-code" size={24} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="bodyMedium" numberOfLines={1}>
            {folder.name}
          </T>
          <T variant="caption" tone="muted" numberOfLines={1} style={{ fontFamily: fonts.mono }}>
            {folder.path}
          </T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          label="Browse folder"
          variant="outline"
          size="sm"
          onPress={onBrowse}
          style={{ flex: 1, borderRadius: radius.full, backgroundColor: c.card }}
          testID="browse-folder"
        />
        <Button
          label="Open in chat"
          size="sm"
          onPress={onOpen}
          style={{ flex: 1, borderRadius: radius.full }}
          testID="open-in-chat"
        />
      </View>
    </Animated.View>
  );
}
