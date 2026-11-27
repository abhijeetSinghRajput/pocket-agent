import { EFFORTS, MODES } from '@pocket-agent/core';
import type { ModelOption, TurnMode } from '@pocket-agent/protocol';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  Camera,
  Check,
  ChevronDown,
  FolderOpen,
  Images,
  Lock,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { guessMime, nameFromUri, sizeOf, type PickedFile } from '@/features/chat/upload';
import { dur, ease } from '@/lib/motion';
import { alpha, radius, useTheme } from '@/lib/theme';
import { Divider, IconTile, Press, T, tap } from '@/ui/core';
import { Notice } from '@/ui/feedback';
import { Segmented } from '@/ui/form';
import { Sheet } from '@/ui/sheet';

// ── Pieces ───────────────────────────────────────────────────────────────────

/** The small control under the message box that opens a picker. */
function Chip({
  icon: Icon,
  label,
  suffix,
  trailing: Trailing,
  locked,
  onPress,
  accessibilityLabel,
  testID,
}: {
  icon?: LucideIcon;
  label: string;
  suffix?: string;
  trailing?: LucideIcon;
  locked: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
}) {
  const { c } = useTheme();
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: locked }}
      testID={testID}
      onPress={onPress}
      scale={0.95}
      style={{
        height: 32,
        maxWidth: 170,
        // On a narrow phone the chips give way (their label shortens), never the send/stop button.
        flexShrink: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 8,
        borderRadius: radius.md,
        opacity: locked ? 0.55 : 1,
      }}
    >
      {locked ? (
        <Lock size={13} color={c.mutedForeground} strokeWidth={2.2} />
      ) : (
        Icon && <Icon size={14} color={c.mutedForeground} strokeWidth={2.2} />
      )}
      <T variant="captionMedium" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
        {suffix && <T variant="caption" tone="muted">{` · ${suffix}`}</T>}
      </T>
      {Trailing && <Trailing size={13} color={c.mutedForeground} strokeWidth={2.2} />}
    </Press>
  );
}

/** One choice in a picker sheet: the name, what it does, and a check when it is the current one. */
function ChoiceRow({
  name,
  description,
  checked,
  disabled,
  onPress,
}: {
  name: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  const on = useSharedValue(checked ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(checked ? 1 : 0, { duration: dur.quick, easing: ease.out }));
  }, [checked, on]);
  const tick = useAnimatedStyle(() => ({
    opacity: on.value,
    transform: [{ scale: 0.6 + 0.4 * on.value }],
  }));
  return (
    <Press
      accessibilityRole="radio"
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      scale={0.985}
      haptic={false}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 52,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: radius.lg,
        backgroundColor: checked ? alpha(c.primary, 0.1) : 'transparent',
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="bodyMedium" numberOfLines={1}>
          {name}
        </T>
        {description && (
          <T variant="caption" tone="muted" numberOfLines={2}>
            {description}
          </T>
        )}
      </View>
      <Animated.View style={tick}>
        <Check size={18} color={c.primary} strokeWidth={2.5} />
      </Animated.View>
    </Press>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <T variant="caption" tone="muted" style={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: 6 }}>
      {children}
    </T>
  );
}

/** The sheet's body: scrolls when the phone is short, never taller than it should be. */
function Body({ children, ratio = 0.62 }: { children: ReactNode; ratio?: number }) {
  const { height } = useWindowDimensions();
  return (
    <ScrollView
      style={{ maxHeight: height * ratio }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 4 }}
    >
      {children}
    </ScrollView>
  );
}

// ── Mode ─────────────────────────────────────────────────────────────────────

/** Like the editor's mode menu: how Claude asks before acting, for turns run from here. */
export function ModePicker({
  value,
  onChange,
  locked,
  live = false,
  modes = MODES,
}: {
  value: string;
  onChange: (v: string) => void;
  locked: string | null;
  /** The agent's own modes (Codex has its own). */
  modes?: readonly { id: TurnMode; name: string; description: string }[];
  /** The choice applies at once, to the turn that is running too. */
  live?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = modes.find((m) => m.id === value);
  const choose = (v: string) => {
    if (v !== value) tap();
    onChange(v);
    setOpen(false);
  };
  return (
    <>
      <Chip
        icon={Zap}
        label={current?.name ?? 'Mode'}
        locked={!!locked}
        onPress={() => setOpen(true)}
        accessibilityLabel={`Mode: ${current?.name ?? 'session’s mode'}`}
        testID="mode-picker"
      />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Mode"
        description={
          locked
            ? 'Can’t be changed right now'
            : live
              ? 'Switches at once, mid-task too'
              : 'Sent with your next message. If Claude is busy in your editor then, it switches with the next request you allow here'
        }
      >
        <Body>
          {locked && (
            <View style={{ paddingBottom: 10 }}>
              <Notice tone="muted">{locked}</Notice>
            </View>
          )}
          <ChoiceRow
            name="Keep the session’s mode"
            checked={value === ''}
            disabled={!!locked}
            onPress={() => choose('')}
          />
          {modes.map((m) => (
            <ChoiceRow
              key={m.id}
              name={m.name}
              description={m.description}
              checked={value === m.id}
              disabled={!!locked}
              onPress={() => choose(m.id)}
            />
          ))}
        </Body>
      </Sheet>
    </>
  );
}

// ── Model + effort ───────────────────────────────────────────────────────────

/** The effort levels as one slider of steps (Auto keeps the session's own), like the editor's. */
export const EFFORT_STEPS: { value: string; label: string }[] = [
  { value: '', label: 'Auto' },
  ...EFFORTS.map((e) => ({ value: e.id, label: e.id === 'xhigh' ? 'XHigh' : e.name })),
];

function EffortSlider({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <View style={{ paddingHorizontal: 6, paddingBottom: 6 }}>
      <Segmented
        options={EFFORT_STEPS}
        value={value}
        onChange={onChange}
        compact
        strong
        disabled={disabled}
        label="Effort"
        testID="effort-slider"
      />
    </View>
  );
}

export function ModelPicker({
  models,
  value,
  onChange,
  effort,
  onEffort,
  locked,
  live = false,
}: {
  models: ModelOption[];
  value: string;
  onChange: (id: string) => void;
  effort: string;
  onEffort: (v: string) => void;
  locked: string | null;
  /** The model applies at once, to the turn that is running too (effort: from the next message). */
  live?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = models.find((m) => m.id === value);
  const level = EFFORTS.find((e) => e.id === effort);
  const choose = (v: string) => {
    if (v !== value) tap();
    onChange(v);
  };
  return (
    <>
      <Chip
        label={current?.name ?? 'Model'}
        suffix={level?.name}
        trailing={ChevronDown}
        locked={!!locked}
        onPress={() => setOpen(true)}
        accessibilityLabel={`Model: ${current?.name ?? 'session’s model'}`}
        testID="model-picker"
      />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Select a model"
        description={
          locked
            ? 'Can’t be changed right now'
            : live
              ? 'The model switches at once; effort from your next message'
              : 'Model and effort for your next message'
        }
      >
        <Body ratio={0.5}>
          {locked && (
            <View style={{ paddingBottom: 10 }}>
              <Notice tone="muted">{locked}</Notice>
            </View>
          )}
          {models.length === 0 && (
            <T variant="caption" tone="muted" style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
              Update Pocket Agent on your PC to see its models.
            </T>
          )}
          <ChoiceRow
            name="Keep the session’s model"
            checked={value === ''}
            disabled={!!locked}
            onPress={() => choose('')}
          />
          {models.map((m) => (
            <ChoiceRow
              key={m.id}
              name={m.name}
              description={m.description || undefined}
              checked={value === m.id}
              disabled={!!locked}
              onPress={() => choose(m.id)}
            />
          ))}
        </Body>
        {/* Effort stays in view under the models, however long that list is. */}
        <View style={{ marginTop: 6, paddingTop: 10 }}>
          <Divider />
          <View style={{ paddingTop: 10 }}>
            <Label>Effort</Label>
            <EffortSlider value={effort} onChange={onEffort} disabled={!!locked} />
          </View>
        </View>
      </Sheet>
    </>
  );
}

// ── Attach ───────────────────────────────────────────────────────────────────

/** Files from the photo library or the camera, as the composer wants them. */
function fromImages(assets: ImagePicker.ImagePickerAsset[]): PickedFile[] {
  return assets.map((a) => {
    const name = a.fileName || nameFromUri(a.uri, 'photo.jpg');
    return { uri: a.uri, name, mime: guessMime(name, a.mimeType), size: sizeOf(a.uri, a.fileSize) };
  });
}

function fromDocuments(assets: DocumentPicker.DocumentPickerAsset[]): PickedFile[] {
  return assets.map((a) => {
    const name = a.name || nameFromUri(a.uri);
    return { uri: a.uri, name, mime: guessMime(name, a.mimeType), size: sizeOf(a.uri, a.size) };
  });
}

type Source = 'library' | 'camera' | 'files';

/**
 * Where a file comes from: the photo library, the camera, or the phone's files. Each picked file
 * is handed to `onPick` at once (the composer starts uploading it).
 */
export function AttachMenu({
  open,
  onClose,
  onPick,
  room,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (files: PickedFile[]) => void;
  /** How many more files this message can take. */
  room: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Source | null>(null);

  async function pick(source: Source) {
    if (busy) return;
    setBusy(source);
    setError(null);
    try {
      let files: PickedFile[] = [];
      if (source === 'library') {
        const res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: room > 1,
          selectionLimit: Math.max(1, room),
          quality: 1,
        });
        if (!res.canceled) files = fromImages(res.assets);
      } else if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setError('Allow camera access in Settings to take a photo.');
          return;
        }
        const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
        if (!res.canceled) files = fromImages(res.assets);
      } else {
        const res = await DocumentPicker.getDocumentAsync({ multiple: room > 1, copyToCacheDirectory: true });
        if (!res.canceled) files = fromDocuments(res.assets);
      }
      if (files.length) {
        onPick(files);
        onClose();
      }
    } catch (err) {
      setError((err as Error).message || 'Could not open the picker.');
    } finally {
      setBusy(null);
    }
  }

  const rows: { source: Source; icon: LucideIcon; label: string; detail: string }[] = [
    { source: 'library', icon: Images, label: 'Photo library', detail: 'Screenshots and photos' },
    { source: 'camera', icon: Camera, label: 'Camera', detail: 'Take a photo now' },
    { source: 'files', icon: FolderOpen, label: 'Files', detail: 'PDFs, documents, code… up to 10 MB each' },
  ];

  return (
    <Sheet
      open={open}
      onClose={() => {
        setError(null);
        onClose();
      }}
      title="Attach files"
      description="Kept 30 days."
    >
      <View style={{ gap: 4 }}>
        {error && (
          <View style={{ paddingBottom: 6 }}>
            <Notice>{error}</Notice>
          </View>
        )}
        {rows.map((r) => (
          <Press
            key={r.source}
            accessibilityRole="button"
            accessibilityLabel={r.label}
            accessibilityState={{ busy: busy === r.source }}
            disabled={!!busy}
            onPress={() => void pick(r.source)}
            scale={0.985}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              paddingVertical: 10,
              paddingHorizontal: 8,
              borderRadius: radius.lg,
            }}
          >
            <IconTile icon={r.icon} size={42} tone={r.source === 'camera' ? 'default' : 'primary'} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="bodyMedium">{r.label}</T>
              <T variant="caption" tone="muted" numberOfLines={1}>
                {r.detail}
              </T>
            </View>
          </Press>
        ))}
      </View>
    </Sheet>
  );
}
