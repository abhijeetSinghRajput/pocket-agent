import {
  canConfigureLive,
  canInstruct,
  capabilityRows,
  commandError,
  deliveryHint,
  END_TEXT,
  isBusy,
  modelLock,
  resumeBlocker,
} from '@pocket-agent/core';
import {
  attachmentLimit,
  CommandResponse,
  RESUME_FILES_AGENT_VERSION,
  versionBelow,
  type AgentSessionDto,
  type ModelOption,
} from '@pocket-agent/protocol';
import { ArrowUp, CircleStop, Hand, Lock, Plus, Power, Square } from 'lucide-react-native';
import { useEffect, useEffectEvent, useRef, useState, type ComponentRef } from 'react';
import { findNodeHandle, Pressable, TextInput, View } from 'react-native';
import Animated, {
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Ticks } from '@/features/chat/capabilities';
import { DraftFiles } from '@/features/chat/draft-files';
import { AttachMenu, ModelPicker, ModePicker } from '@/features/chat/pickers';
import { newId } from '@/features/chat/upload';
import { useDraftFiles } from '@/features/chat/use-draft-files';
import { apiRequest } from '@/lib/api';
import { useDevices } from '@/lib/data';
import { dur, ease, enter, exit, layout } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { useStored } from '@/lib/storage';
import { Button, IconButton, Press, T, buzz, thud } from '@/ui/core';
import { enableImagePaste, type PastedImage } from '../../../modules/image-paste';
import { Notice } from '@/ui/feedback';
import { Sheet } from '@/ui/sheet';

async function control(session: AgentSessionDto, action: 'interrupt' | 'stop'): Promise<string | null> {
  const { command } = await apiRequest(`/sessions/${session.id}/${action}`, CommandResponse, {
    method: 'POST',
    body: { idempotencyKey: newId() },
  });
  return command.status === 'Failed' ? commandError(command) : null;
}

/** The model picked for this chat. A model the PC no longer offers is never sent. */
function useChosenModel(sessionId: string, models: ModelOption[]) {
  const [model, choose] = useStored(`pocket-agent:model:${sessionId}`);
  return [models.some((m) => m.id === model) ? model : '', choose] as const;
}

// ── Send / stop ──────────────────────────────────────────────────────────────

/**
 * One button: Send when there is something to send; Stop while Claude works. The two icons share
 * the spot and one turns into the other; it breathes while a request is in flight.
 */
/** Send and attach share one size and shape. */
export const SEND_SIZE = 36;
export const SEND_RADIUS = radius.lg - 2;

export function SendButton({
  stopMode,
  disabled,
  busy,
  label,
  onPress,
}: {
  stopMode: boolean;
  disabled: boolean;
  busy: boolean;
  label: string;
  onPress: () => void;
}) {
  const { c } = useTheme();
  const stop = useSharedValue(stopMode ? 1 : 0);
  const dim = useSharedValue(disabled ? 0.4 : 1);
  const pulse = useSharedValue(1);
  useEffect(() => {
    stop.set(withTiming(stopMode ? 1 : 0, { duration: 200, easing: ease.out }));
  }, [stopMode, stop]);
  useEffect(() => {
    dim.set(withTiming(disabled ? 0.4 : 1, { duration: dur.quick, easing: ease.out }));
  }, [disabled, dim]);
  useEffect(() => {
    if (busy) pulse.set(withRepeat(withTiming(0.5, { duration: 700, easing: ease.move }), -1, true));
    else {
      cancelAnimation(pulse);
      pulse.set(withTiming(1, { duration: dur.quick, easing: ease.out }));
    }
  }, [busy, pulse]);
  const box = useAnimatedStyle(() => ({ opacity: dim.value * pulse.value }));
  const arrow = useAnimatedStyle(() => ({
    opacity: 1 - stop.value,
    transform: [{ scale: 1 - 0.5 * stop.value }],
  }));
  const square = useAnimatedStyle(() => ({
    opacity: stop.value,
    transform: [{ scale: 0.5 + 0.5 * stop.value }],
  }));
  return (
    <Animated.View style={box}>
      <Press
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, busy }}
        testID={stopMode ? 'stop-button' : 'send-button'}
        disabled={disabled}
        onPress={onPress}
        haptic={false}
        dim={false}
        scale={0.92}
        ripple="rgba(255, 255, 255, 0.24)"
        style={{
          width: SEND_SIZE,
          height: SEND_SIZE,
          borderRadius: SEND_RADIUS,
          backgroundColor: c.primary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Animated.View style={[{ position: 'absolute' }, arrow]}>
          <ArrowUp size={18} color={c.primaryForeground} strokeWidth={2.5} />
        </Animated.View>
        <Animated.View style={[{ position: 'absolute' }, square]}>
          <Square size={14} color={c.primaryForeground} fill={c.primaryForeground} strokeWidth={2} />
        </Animated.View>
      </Press>
    </Animated.View>
  );
}

/** The + that opens the attach menu: the same size and shape as Send, in the quiet colour. */
export function AttachButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel="Attach files"
      testID="attach-button"
      disabled={disabled}
      onPress={onPress}
      scale={0.92}
      hitSlop={4}
      style={{
        width: SEND_SIZE,
        height: SEND_SIZE,
        borderRadius: SEND_RADIUS,
        backgroundColor: c.secondary,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 4,
      }}
    >
      <Plus size={21} color={c.secondaryForeground} strokeWidth={2.2} />
    </Press>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────────

/** Message box pinned to the bottom of a chat. The button sends; files attach from the +. */
export function Composer({
  session,
  onSent,
  onInfo,
}: {
  session: AgentSessionDto;
  onSent: () => void;
  onInfo?: () => void;
}) {
  const { c } = useTheme();
  // The unsent message is kept on this device: it survives leaving the chat or the app.
  const [text, setText] = useStored(`pocket-agent:draft:${session.id}`);
  const [pending, setPending] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per message: retrying after a network error can never send it twice.
  const key = useRef(newId());
  const box = useRef<ComponentRef<typeof TextInput>>(null);
  const [attachOpen, setAttachOpen] = useState(false);

  // The box is always there, like any chat app; when this session can't take messages it is
  // disabled and says why (never pretends a message could be delivered).
  const device = useDevices().state.data?.find((d) => d.id === session.deviceId);
  const maxFiles = attachmentLimit(device?.agentVersion);
  const files = useDraftFiles(maxFiles, setError);
  const { drafts, ready, uploading } = files;
  const addFiles = files.add;
  // Ended: sending continues the same conversation on the PC, when that's possible.
  const resuming = !!session.endedAt && resumeBlocker(session, device) === null;
  const locked =
    canInstruct(session) || resuming
      ? null
      : session.endedAt
        ? (resumeBlocker(session, device) ?? 'This session has ended.')
        : (capabilityRows(session).find((r) => r.label === 'Send instructions')?.detail ??
          'Messages can’t be sent to this session.');
  // Images from the keyboard (Gboard's clipboard, stickers) join the message like picked files,
  // wherever files can be attached.
  const canAttach =
    !locked && (!resuming || !versionBelow(device?.agentVersion ?? '0', RESUME_FILES_AGENT_VERSION));
  const onPasted = useEffectEvent((files: PastedImage[]) => addFiles(files));
  useEffect(() => {
    const tag = canAttach && box.current ? findNodeHandle(box.current) : null;
    if (tag == null) return;
    return enableImagePaste(tag, onPasted);
  }, [canAttach]);
  const showStop = !session.endedAt && isBusy(session);
  const canInterrupt = showStop && session.capabilities.interrupt;
  const models = device?.models ?? [];
  const [model, setModel] = useChosenModel(session.id, models);
  const [mode, setMode] = useStored(`pocket-agent:mode:${session.id}`);
  const [effort, setEffort] = useStored(`pocket-agent:effort:${session.id}`);
  const modelLocked = resuming ? null : modelLock(session);

  // A session Pocket Agent runs switches mode or model at once, mid-task too (the chat shows
  // "You switched to …"); any other takes the choice with the next message sent from here.
  const live = canConfigureLive(session, device);
  async function applyNow(change: { permissionMode: string } | { model: string }) {
    if (!live) return;
    setError(null);
    try {
      const { command } = await apiRequest(`/sessions/${session.id}/configure`, CommandResponse, {
        method: 'POST',
        body: { idempotencyKey: newId(), ...change },
      });
      if (command.status === 'Failed') setError(commandError(command));
      onSent();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const chooseMode = (value: string) => {
    setMode(value);
    if (value) void applyNow({ permissionMode: value });
  };
  const chooseModel = (value: string) => {
    setModel(value);
    if (value) void applyNow({ model: value });
  };

  // Something typed or attached: the button sends. Nothing, and Claude is working: it stops Claude.
  const hint = locked
    ? ''
    : resuming
      ? `This session has ended. Sending continues it on ${session.deviceName} with the whole conversation${device?.status === 'Online' ? '' : ' (your PC is offline right now)'}.`
      : deliveryHint(session);
  const hasContent = !!text.trim() || ready.length > 0;
  const stopMode = !hasContent && showStop;

  async function send() {
    // A message can be just files: Claude is then told what they are called.
    const value =
      text.trim() || (ready.length ? `Attached: ${ready.map((d) => d.ref!.name).join(', ')}` : '');
    if (!value || pending || locked || uploading) return;
    setPending(true);
    setError(null);
    thud();
    try {
      const choices = {
        ...(model && !modelLocked ? { model } : {}),
        ...(mode && !modelLocked ? { permissionMode: mode } : {}),
        ...(effort && !modelLocked ? { effort } : {}),
      };
      const { command } = resuming
        ? // Ended: the PC reopens this conversation and runs the message in it.
          await apiRequest(`/sessions/${session.id}/resume`, CommandResponse, {
            method: 'POST',
            body: {
              text: value,
              idempotencyKey: key.current,
              ...choices,
              ...(ready.length ? { attachmentIds: files.ids } : {}),
            },
          })
        : await apiRequest(`/sessions/${session.id}/instructions`, CommandResponse, {
            method: 'POST',
            body: {
              text: value,
              idempotencyKey: key.current,
              ...choices,
              ...(ready.length ? { attachmentIds: files.ids } : {}),
            },
          });
      key.current = newId();
      setText('');
      files.clear();
      if (command.status === 'Failed') {
        setError(commandError(command));
        buzz(false);
      }
      onSent();
    } catch (err) {
      setError((err as Error).message);
      buzz(false);
    } finally {
      setPending(false);
    }
  }

  async function interrupt() {
    setInterrupting(true);
    setError(null);
    thud();
    try {
      setError(await control(session, 'interrupt'));
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInterrupting(false);
    }
  }

  // The box's edge warms to the accent while you type in it.
  const focus = useSharedValue(0);
  const edge = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focus.value, [0, 1], [c.border, alpha(c.primary, 0.6)]),
  }));

  return (
    <Animated.View layout={layout} style={{ gap: 8 }} testID="composer">
      {error && (
        <Animated.View exiting={exit.fade} layout={layout} testID="send-error">
          <Notice>{error}</Notice>
        </Animated.View>
      )}
      <Animated.View
        layout={layout}
        style={[
          {
            borderRadius: radius.xl,
            borderWidth: 1.5,
            backgroundColor: c.card,
            overflow: 'hidden',
          },
          edge,
        ]}
      >
        {/* A tap anywhere in the box that isn't a control lands in the field. */}
        <Pressable
          accessibilityLabel="Send an instruction"
          onPress={() => box.current?.focus()}
          disabled={!!locked}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <DraftFiles drafts={drafts} onRemove={files.remove} />
        <TextInput
          ref={box}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={20_000}
          editable={!locked}
          accessibilityLabel="Send an instruction"
          testID="instruction"
          placeholder={
            locked
              ? 'Messaging is off for this session'
              : resuming
                ? 'Continue this session…'
                : 'Message Claude…'
          }
          placeholderTextColor={c.mutedForeground}
          selectionColor={c.primary}
          onFocus={() => focus.set(withTiming(1, { duration: dur.quick, easing: ease.out }))}
          onBlur={() => focus.set(withTiming(0, { duration: dur.quick, easing: ease.out }))}
          style={{
            fontFamily: fonts.regular,
            fontSize: 16,
            lineHeight: 22,
            color: c.foreground,
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 4,
            maxHeight: 160,
            textAlignVertical: 'top',
          }}
        />
        {(locked || hint) && (
          <Animated.View
            entering={enter.fade}
            exiting={exit.fade}
            layout={layout}
            testID="delivery-hint"
            style={{ paddingHorizontal: 16, paddingBottom: 4 }}
          >
            {locked ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                <Lock size={12} color={c.mutedForeground} strokeWidth={2.2} style={{ marginTop: 3 }} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Ticks text={locked} />
                  {onInfo && (
                    <Pressable
                      accessibilityRole="link"
                      onPress={onInfo}
                      hitSlop={6}
                      style={{ alignSelf: 'flex-start', marginTop: 2 }}
                    >
                      <T variant="captionMedium" tone="primary">
                        Session info
                      </T>
                    </Pressable>
                  )}
                </View>
              </View>
            ) : (
              <T variant="caption" tone="muted">
                {hint}
              </T>
            )}
          </Animated.View>
        )}
        {/* Like the editor's input: what the message runs with on the left, stop and send on the right. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: 8,
            paddingTop: 4,
            paddingBottom: 8,
          }}
        >
          {/* Files can't be sent with the message that continues an ended session. */}
          {canAttach && <AttachButton disabled={files.room <= 0} onPress={() => setAttachOpen(true)} />}
          {!locked && (
            <>
              <ModePicker value={mode} onChange={chooseMode} locked={modelLocked} />
              <ModelPicker
                models={models}
                value={model}
                onChange={chooseModel}
                effort={effort}
                onEffort={setEffort}
                locked={modelLocked}
              />
            </>
          )}
          <View style={{ flex: 1 }} />
          <SendButton
            stopMode={stopMode}
            disabled={
              stopMode ? interrupting || !canInterrupt : pending || uploading || !hasContent || !!locked
            }
            busy={pending || interrupting}
            label={
              stopMode
                ? canInterrupt
                  ? session.mode === 'managed'
                    ? 'Stop Claude'
                    : 'Stop Claude (it stops at its next step)'
                  : 'Stopping is turned off on this PC (pocket-agent instructions enable)'
                : pending
                  ? 'Sending…'
                  : 'Send'
            }
            onPress={() => void (stopMode ? interrupt() : send())}
          />
        </View>
      </Animated.View>
      <AttachMenu
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        onPick={addFiles}
        room={files.room}
      />
    </Animated.View>
  );
}

// ── Session controls ─────────────────────────────────────────────────────────

/** Interrupt / end, inside Session info. Ending asks first, in place. */
export function SessionControls({ session, onDone }: { session: AgentSessionDto; onDone: () => void }) {
  const { c } = useTheme();
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState<'interrupt' | 'stop' | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!session.capabilities.interrupt || session.endedAt) return null;

  async function run(action: 'interrupt' | 'stop') {
    setBusy(action);
    setError(null);
    thud();
    try {
      setError(await control(session, action));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      setConfirmStop(false);
    }
  }

  return (
    <Animated.View layout={layout} style={{ gap: 10 }}>
      {confirmStop ? (
        <Animated.View
          key="confirm"
          entering={enter.fade}
          exiting={exit.fade}
          accessibilityRole="alert"
          style={{
            gap: 12,
            padding: 14,
            borderRadius: radius.lg,
            backgroundColor: alpha(c.destructive, 0.08),
          }}
        >
          <View style={{ gap: 4 }}>
            <T variant="subheading">End this session?</T>
            <T variant="small" tone="muted">
              {END_TEXT(session)}
            </T>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
            <Button label="Cancel" variant="outline" size="sm" onPress={() => setConfirmStop(false)} />
            <Button
              label={busy === 'stop' ? 'Ending…' : 'End session'}
              variant="destructive"
              size="sm"
              loading={busy === 'stop'}
              onPress={() => void run('stop')}
            />
          </View>
        </Animated.View>
      ) : (
        <Animated.View
          key="controls"
          entering={enter.fade}
          exiting={exit.fade}
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
        >
          <Button
            label={busy === 'interrupt' ? 'Interrupting…' : 'Interrupt'}
            icon={Hand}
            variant="outline"
            size="sm"
            disabled={!isBusy(session) || !!busy}
            loading={busy === 'interrupt'}
            onPress={() => void run('interrupt')}
          />
          <Press
            accessibilityRole="button"
            accessibilityLabel="End session"
            disabled={!!busy}
            onPress={() => setConfirmStop(true)}
            style={{
              height: 36,
              paddingHorizontal: 12,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: c.border,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <CircleStop size={16} color={c.destructive} strokeWidth={2.2} />
            <T variant="smallMedium" tone="danger">
              End session
            </T>
          </Press>
        </Animated.View>
      )}
      {error && <Notice>{error}</Notice>}
    </Animated.View>
  );
}

/** Header button: ends the session (after asking). Only shown when this session can be ended. */
export function EndSessionButton({ session, onDone }: { session: AgentSessionDto; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!session.capabilities.interrupt || session.endedAt) return null;

  async function end() {
    setBusy(true);
    setError(null);
    thud();
    try {
      const failed = await control(session, 'stop');
      setError(failed);
      if (!failed) setOpen(false);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <IconButton icon={Power} label="End session" onPress={() => setOpen(true)} testID="end-session" />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        dismissable={!busy}
        title="End this session?"
        description={END_TEXT(session)}
      >
        <View style={{ gap: 12 }}>
          {error && <Notice>{error}</Notice>}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
            <Button label="Cancel" variant="outline" onPress={() => setOpen(false)} disabled={busy} />
            <Button
              label={busy ? 'Ending…' : 'End session'}
              variant="destructive"
              loading={busy}
              onPress={() => void end()}
            />
          </View>
        </View>
      </Sheet>
    </>
  );
}
