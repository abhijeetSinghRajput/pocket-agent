import { commandError } from '@pocket-agent/core';
import {
  CommandResponse,
  type CommandDto,
  type DeviceDto,
  type TurnEffort,
  type TurnMode,
} from '@pocket-agent/protocol';
import { uuid } from 'expo-modules-core';
import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { EFFORT_STEPS } from '@/features/chat/pickers';
import { apiRequest } from '@/lib/api';
import { useDevices } from '@/lib/data';
import { dur, ease } from '@/lib/motion';
import { fonts, radius, useTheme } from '@/lib/theme';
import { Button, buzz, Card, Divider, Fade, Press, T, tap, thud } from '@/ui/core';
import { Notice, Skeleton } from '@/ui/feedback';
import { Segmented } from '@/ui/form';
import { Sheet } from '@/ui/sheet';
import { TerminalGuide } from '@/ui/terminal-guide';

/** How Claude Code asks before acting. "Bypass permissions" is never offered here. */
const MODES: { id: TurnMode; name: string; description: string }[] = [
  { id: 'default', name: 'Manual', description: 'Asks before each edit' },
  { id: 'acceptEdits', name: 'Edit automatically', description: 'Edits files without asking' },
  { id: 'plan', name: 'Plan', description: 'Explores and plans, changes nothing' },
  { id: 'auto', name: 'Auto', description: 'Safe actions run, risky ones ask' },
];

const usableDevices = (all: DeviceDto[] | null) =>
  (all ?? []).filter((d) => d.status === 'Online' && d.projects.length > 0);

/** Waits (up to a minute) for the PC to start Claude and report the new session. */
async function waitForSession(command: CommandDto, alive: RefObject<boolean>): Promise<CommandDto> {
  const deadline = Date.now() + 60_000;
  while (
    alive.current &&
    !command.sessionId &&
    !['Failed', 'Expired'].includes(command.status) &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 1000));
    command = (await apiRequest(`/commands/${command.id}`, CommandResponse)).command;
  }
  return command;
}

/** Starts a managed session in a folder the PC owner allow-listed, then opens it. */
export function NewChatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { c } = useTheme();
  const { height } = useWindowDimensions();
  const { state, refresh } = useDevices();
  const [deviceId, setDeviceId] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [model, setModel] = useState('');
  const [mode, setMode] = useState<TurnMode | ''>('');
  const [effort, setEffort] = useState<TurnEffort | ''>('');
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'form' | 'starting'>('form');
  const [error, setError] = useState<string | null>(null);
  const key = useRef(uuid.v4());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Opening: a clean form, a fresh idempotency key, the PCs as they are now.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setPhase('form');
      setError(null);
      key.current = uuid.v4();
      void refresh();
    }, 0);
    return () => clearTimeout(t);
  }, [open, refresh]);

  const devices = state.data;
  const usable = usableDevices(devices);
  // The first usable PC and its first folder are chosen for you (as on the web); a choice that is
  // no longer usable (the PC went offline, the folder was removed) falls back the same way.
  const device = usable.find((d) => d.id === deviceId) ?? usable[0];
  const project = device?.projects.find((p) => p.path === projectPath) ?? device?.projects[0];
  const chosenPath = project?.path ?? '';

  const models = device?.models ?? [];
  // A model the PC no longer offers is never sent.
  const chosenModel = models.some((m) => m.id === model) ? model : '';

  async function start() {
    if (!device || !chosenPath || !text.trim() || phase === 'starting') return;
    setPhase('starting');
    setError(null);
    thud();
    try {
      let { command } = await apiRequest(`/devices/${device.id}/sessions`, CommandResponse, {
        method: 'POST',
        body: {
          projectPath: chosenPath,
          text: text.trim(),
          idempotencyKey: key.current,
          ...(chosenModel ? { model: chosenModel } : {}),
          ...(mode ? { permissionMode: mode } : {}),
          ...(effort ? { effort } : {}),
        },
      });
      command = await waitForSession(command, alive);
      if (!alive.current) return;
      if (command.sessionId) {
        buzz(true);
        onClose();
        setText('');
        setPhase('form');
        router.push({ pathname: '/chat/[id]', params: { id: command.sessionId } });
        return;
      }
      buzz(false);
      setError(commandError(command) ?? 'Your PC did not start the session in time.');
      setPhase('form');
      key.current = uuid.v4();
    } catch (err) {
      if (!alive.current) return;
      buzz(false);
      setError((err as Error).message);
      setPhase('form');
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New chat"
      description="Claude Code starts on your PC, in the project you pick."
      dismissable={phase !== 'starting'}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: Math.max(240, height * 0.62) }}
        contentContainerStyle={{ paddingBottom: 8, gap: 16 }}
      >
        {devices === null && !state.error && <Skeleton height={160} round={radius.lg} />}

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

        {usable.length > 0 && (
          <>
            <Group label="PC">
              <ChipRow
                options={usable.map((d) => ({ id: d.id, name: d.name }))}
                value={device?.id ?? ''}
                onChange={(id) => {
                  setDeviceId(id);
                  setProjectPath(usable.find((d) => d.id === id)?.projects[0]?.path ?? '');
                }}
              />
            </Group>
            <Group label="Project">
              <Card>
                {device?.projects.map((p, i) => {
                  const selected = p.path === chosenPath;
                  return (
                    <View key={p.path}>
                      {i > 0 && <Divider inset={16} />}
                      <Press
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${p.name} — ${p.path}`}
                        onPress={() => setProjectPath(p.path)}
                        scale={0.99}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                          paddingHorizontal: 16,
                          paddingVertical: 12,
                        }}
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <T variant="bodyMedium" numberOfLines={1}>
                            {p.name}
                          </T>
                          <T
                            variant="caption"
                            tone="muted"
                            numberOfLines={1}
                            style={{ fontFamily: fonts.mono }}
                          >
                            {p.path}
                          </T>
                        </View>
                        <Fade visible={selected}>
                          <Check size={18} color={c.primary} strokeWidth={2.4} />
                        </Fade>
                      </Press>
                    </View>
                  );
                })}
              </Card>
            </Group>
            {models.length > 0 && (
              <>
                <Group label="Model">
                  <ChipRow
                    options={[
                      { id: '', name: 'Default' },
                      ...models.map((m) => ({ id: m.id, name: m.name })),
                    ]}
                    value={chosenModel}
                    onChange={setModel}
                  />
                  {models.find((m) => m.id === chosenModel)?.description ? (
                    <T variant="caption" tone="muted">
                      {models.find((m) => m.id === chosenModel)!.description}
                    </T>
                  ) : null}
                </Group>
                <Group label="Mode">
                  <ChipRow
                    options={[{ id: '', name: 'Default' }, ...MODES]}
                    value={mode}
                    onChange={(v) => setMode(v as TurnMode | '')}
                  />
                  {MODES.find((m) => m.id === mode) && (
                    <T variant="caption" tone="muted">
                      {MODES.find((m) => m.id === mode)!.description}
                    </T>
                  )}
                </Group>
                <Group label="Effort">
                  <Segmented
                    options={EFFORT_STEPS}
                    value={effort}
                    onChange={(v) => setEffort(v as TurnEffort | '')}
                    compact
                    strong
                    label="Effort"
                  />
                </Group>
              </>
            )}
            <Group label="First instruction">
              <InstructionBox
                value={text}
                onChangeText={setText}
                placeholder="e.g. Run the test suite and summarise failures"
                editable={phase !== 'starting'}
              />
              <T variant="caption" tone="muted">
                Anything that needs permission asks you here.
              </T>
            </Group>
            {error && <Notice>{error}</Notice>}
            <Button
              label={phase === 'starting' ? 'Starting on your PC…' : 'Start session'}
              onPress={() => void start()}
              loading={phase === 'starting'}
              disabled={!text.trim()}
              style={{ alignSelf: 'flex-end' }}
              testID="start-session"
            />
          </>
        )}

        {devices === null && state.error && <Notice>{state.error}</Notice>}
      </ScrollView>
    </Sheet>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <T variant="smallMedium">{label}</T>
      {children}
    </View>
  );
}

/** One row of choices to pick one from; the chosen one warms to the accent. */
function ChipRow({
  options,
  value,
  onChange,
}: {
  options: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      accessibilityRole="radiogroup"
      contentContainerStyle={{ gap: 8 }}
      style={{ marginHorizontal: -20, paddingHorizontal: 20 }}
      contentInset={{ right: 40 }}
    >
      {options.map((o) => (
        <Chip
          key={o.id || 'default'}
          label={o.name}
          selected={o.id === value}
          onPress={() => onChange(o.id)}
        />
      ))}
      <View style={{ width: 20 }} />
    </ScrollView>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { c } = useTheme();
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(selected ? 1 : 0, { duration: dur.quick, easing: ease.out }));
  }, [selected, on]);
  const fill = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], [c.muted, c.primary]),
  }));
  return (
    <Press
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      haptic={false}
      onPress={() => {
        if (!selected) tap();
        onPress();
      }}
      scale={0.95}
      dim={false}
    >
      <Animated.View
        style={[
          { height: 34, paddingHorizontal: 14, borderRadius: radius.full, justifyContent: 'center' },
          fill,
        ]}
      >
        <T
          variant="smallMedium"
          style={{ color: selected ? c.primaryForeground : c.foreground }}
          numberOfLines={1}
        >
          {label}
        </T>
      </Animated.View>
    </Press>
  );
}

/** The first message: a few lines tall, grows with what is typed; the border warms while focused. */
function InstructionBox({
  value,
  onChangeText,
  placeholder,
  editable,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  editable: boolean;
}) {
  const { c } = useTheme();
  const focus = useSharedValue(0);
  const border = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focus.value, [0, 1], [c.input, c.primary]),
  }));
  return (
    <Animated.View
      style={[
        {
          borderRadius: radius.lg,
          borderWidth: 1.5,
          backgroundColor: c.card,
          paddingHorizontal: 14,
          paddingVertical: 10,
        },
        border,
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.mutedForeground}
        selectionColor={c.primary}
        multiline
        maxLength={20_000}
        editable={editable}
        accessibilityLabel="First instruction"
        testID="ns-text"
        onFocus={() => focus.set(withTiming(1, { duration: dur.quick, easing: ease.out }))}
        onBlur={() => focus.set(withTiming(0, { duration: dur.quick, easing: ease.out }))}
        style={{
          minHeight: 72,
          maxHeight: 180,
          fontFamily: fonts.regular,
          fontSize: 16,
          lineHeight: 22,
          color: c.foreground,
          paddingVertical: 0,
          textAlignVertical: 'top',
        }}
      />
    </Animated.View>
  );
}
