import type { AgentSessionDto, ModelOption } from '@pocket-agent/protocol';
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
import { Sheet } from '@/ui/sheet';

const isBusy = (s: AgentSessionDto) => s.status === 'Running' || s.status === 'WaitingForPermission';

/** How Claude Code asks before acting. "Bypass permissions" is never offered here. */
export const MODES = [
  { id: 'default', name: 'Manual', description: 'Asks before each edit' },
  { id: 'acceptEdits', name: 'Edit automatically', description: 'Edits files without asking' },
  { id: 'plan', name: 'Plan', description: 'Explores and plans, changes nothing' },
  { id: 'auto', name: 'Auto', description: 'Safe actions run, risky ones ask' },
] as const;
export const EFFORTS = [
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
  { id: 'xhigh', name: 'Extra high' },
  { id: 'max', name: 'Max' },
] as const;

/** Why the model can't be chosen right now, or null if it can. */
export function modelLock(s: AgentSessionDto): string | null {
  if (s.mode === 'managed') return null;
  if (!s.capabilities.instructAnytime)
    return 'This session runs in your editor with its own settings. Turn on wake on the PC to run turns from here with others.';
  if (isBusy(s)) return 'Claude is mid-turn in your editor; that turn keeps the editor’s settings.';
  return null;
}

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
function Body({ children }: { children: ReactNode }) {
  const { height } = useWindowDimensions();
  return (
    <ScrollView
      style={{ maxHeight: height * 0.62 }}
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
}: {
  value: string;
  onChange: (v: string) => void;
  locked: string | null;
}) {
  const [open, setOpen] = useState(false);
  const current = MODES.find((m) => m.id === value);
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
        description={locked ?? 'Mode for your next message'}
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
          {MODES.map((m) => (
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

/** Effort as one row of steps, like the editor's slider. */
function EffortSteps({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const { c } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Effort"
      style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 6, paddingBottom: 6 }}
    >
      {[{ id: '', name: 'Auto' }, ...EFFORTS].map((e) => {
        const checked = value === e.id;
        return (
          <Press
            key={e.id || 'keep'}
            accessibilityRole="radio"
            accessibilityState={{ checked, disabled }}
            accessibilityLabel={e.id ? e.name : 'Keep the session’s effort'}
            disabled={disabled}
            onPress={() => {
              if (!checked) tap();
              onChange(e.id);
            }}
            haptic={false}
            scale={0.94}
            style={{
              flex: 1,
              height: 34,
              borderRadius: radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: checked ? c.primary : c.muted,
            }}
          >
            <T
              variant="captionMedium"
              numberOfLines={1}
              style={{ fontSize: 11.5, color: checked ? c.primaryForeground : c.foreground }}
            >
              {e.id === 'xhigh' ? 'XHigh' : e.name}
            </T>
          </Press>
        );
      })}
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
}: {
  models: ModelOption[];
  value: string;
  onChange: (id: string) => void;
  effort: string;
  onEffort: (v: string) => void;
  locked: string | null;
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
        description={locked ?? 'Model and effort for your next message'}
      >
        <Body>
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
          <View style={{ marginVertical: 10 }}>
            <Divider />
          </View>
          <Label>Effort</Label>
          <EffortSteps value={effort} onChange={onEffort} disabled={!!locked} />
        </Body>
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
