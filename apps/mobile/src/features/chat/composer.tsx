import {
  agentName,
  canConfigureLive,
  modesFor,
  canInstruct,
  capabilityRows,
  commandError,
  deliveryHint,
  END_TEXT,
  isBusy,
  modelLock,
  QUICK_REPLIES,
  type QuickReply,
  resumeBlocker,
} from '@pocket-agent/core';
import {
  attachmentLimit,
  CommandResponse,
  RESUME_FILES_AGENT_VERSION,
  CODEX_MODES_AGENT_VERSION,
  versionBelow,
  type AgentSessionDto,
  type ModelOption,
} from '@pocket-agent/protocol';
import { ArrowUp, CircleStop, Hand, Lock, Mic, Plus, Power, Square } from 'lucide-react-native';
import { useEffect, useEffectEvent, useRef, useState, type ComponentRef } from 'react';
import { findNodeHandle, Keyboard, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated, {
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Ticks } from '@/features/chat/capabilities';
import { canDictate, useDictation } from '@/features/chat/dictation';
import { DraftFiles } from '@/features/chat/draft-files';
import { AttachMenu, ModelPicker, ModePicker } from '@/features/chat/pickers';
import { newId } from '@/features/chat/upload';
import type { OutgoingMessage } from '@/features/chat/outbox';
import { useDraftFiles } from '@/features/chat/use-draft-files';
import { apiRequest } from '@/lib/api';
import { useDevices } from '@/lib/data';
import { dur, ease, enter, exit, layout } from '@/lib/motion';
import { alpha, fonts, radius, tint, useTheme } from '@/lib/theme';
import { getDraft, saveDraft, useDraft } from '@/lib/drafts';
import { useStored } from '@/lib/storage';
import { Button, IconButton, Press, T, thud } from '@/ui/core';
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

/** The mic beside Send: the same size; while listening it fills with the accent and glows with your voice. */
export function MicButton({
  dictation,
  disabled,
}: {
  dictation: ReturnType<typeof useDictation>;
  disabled: boolean;
}) {
  const { c } = useTheme();
  const { listening, level, toggle } = dictation;
  const on = useSharedValue(0);
  useEffect(() => {
    on.set(withTiming(listening ? 1 : 0, { duration: dur.quick, easing: ease.out }));
  }, [listening, on]);
  const glow = useAnimatedStyle(() => ({
    opacity: on.value * (0.25 + 0.45 * level.value),
    transform: [{ scale: 1 + 0.35 * level.value * on.value }],
  }));
  return (
    <View style={{ width: SEND_SIZE, height: SEND_SIZE }}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            inset: 0,
            borderRadius: SEND_RADIUS,
            backgroundColor: alpha(c.primary, 0.5),
          },
          glow,
        ]}
      />
      <Press
        accessibilityRole="button"
        accessibilityLabel={listening ? 'Stop dictating' : 'Dictate a message'}
        accessibilityState={{ disabled, selected: listening }}
        testID="mic-button"
        disabled={disabled}
        onPress={toggle}
        scale={0.92}
        haptic={false}
        style={{
          width: SEND_SIZE,
          height: SEND_SIZE,
          borderRadius: SEND_RADIUS,
          backgroundColor: listening ? c.primary : c.secondary,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <Mic size={18} color={listening ? c.primaryForeground : c.secondaryForeground} strokeWidth={2.2} />
      </Press>
    </View>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────────

/** Message box pinned to the bottom of a chat. The button sends; files attach from the +. */
export function Composer({
  session,
  onSending,
  submit,
  onSent,
  onInfo,
  replies,
}: {
  session: AgentSessionDto;
  /** One-tap replies that fit the conversation (the usual ones when not given). */
  replies?: QuickReply[];
  /** A message is on its way: the chat goes to its newest message, where it will show up. */
  onSending?: () => void;
  /** Sends a message through the chat's outbox (shown at once, kept to retry if it fails). */
  submit: (message: OutgoingMessage) => void;
  /** Something was sent (a message, a stop, a new mode): the chat refreshes. */
  onSent: () => void;
  onInfo?: () => void;
}) {
  const { c } = useTheme();
  // The unsent message is kept on this device: it survives leaving the chat or the app.
  const { draft, ready: draftReady } = useDraft(session.id);
  const text = draft?.text ?? '';
  const setText = (next: string) => saveDraft(session.id, { ...getDraft(session.id), text: next });
  const [interrupting, setInterrupting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per message: retrying after a network error can never send it twice.
  const key = useRef(newId());
  const box = useRef<ComponentRef<typeof TextInput>>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const dictation = useDictation(text, setText);
  const [dictates] = useState(canDictate);
  // Hidden once something is sent, until the session moves on (the reply shows at once).
  const [quietAt, setQuietAt] = useState<string | null>(null);

  // The box is always there, like any chat app; when this session can't take messages it is
  // disabled and says why (never pretends a message could be delivered).
  const device = useDevices().state.data?.find((d) => d.id === session.deviceId);
  const maxFiles = attachmentLimit(device?.agentVersion);
  const files = useDraftFiles(maxFiles, setError, { keepUploaded: true });
  const { drafts, ready, uploading } = files;

  // The files of the saved draft come back once (when drafts have been read); from then on, the
  // uploaded files in the box are what the draft keeps.
  const [restored, setRestored] = useState(false);
  if (draftReady && !restored) {
    setRestored(true);
    const saved = draft?.files ?? [];
    if (saved.length)
      files.restore(
        saved.map((f) => ({
          key: newId(),
          file: f.file,
          ref: f.ref,
          status: 'ready',
          progress: 1,
          uploadedAt: f.uploadedAt,
        })),
      );
  }
  useEffect(() => {
    if (!restored) return;
    const uploaded = drafts.flatMap((d) =>
      d.status === 'ready' && d.ref
        ? [{ ref: d.ref, file: d.file, uploadedAt: d.uploadedAt ?? Date.now() }]
        : [],
    );
    saveDraft(session.id, { ...getDraft(session.id), files: uploaded });
  }, [restored, drafts, session.id]);
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
  // Codex has its own models and modes (a mode reaches PCs that apply it; it takes it per message).
  const isCodex = session.provider === 'codex';
  const codexModes = isCodex && !versionBelow(device?.agentVersion ?? '0', CODEX_MODES_AGENT_VERSION);
  const models =
    (isCodex ? device?.agents.find((a) => a.provider === 'codex')?.models : device?.models) ?? [];
  const [model, setModel] = useChosenModel(session.id, models);
  const [mode, setMode] = useStored(`pocket-agent:mode:${session.id}`);
  const [effort, setEffort] = useStored(`pocket-agent:effort:${session.id}`);
  const modelLocked = resuming ? null : modelLock(session);

  // A session Pocket Agent runs switches mode or model at once, mid-task too (the chat shows
  // "You switched to …"); any other takes the choice with the next message sent from here.
  const live = canConfigureLive(session, device) && !isCodex;
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
  // An ended chat says so in its placeholder ("Continue this session…"): no line under the box.
  const hint = locked || resuming ? '' : deliveryHint(session);
  const hasContent = !!text.trim() || ready.length > 0;
  const stopMode = !hasContent && showStop;

  // Claude finished and waits: one tap sends a common next step.
  const offerReplies =
    !locked &&
    !resuming &&
    !session.endedAt &&
    session.status === 'WaitingForInput' &&
    !hasContent &&
    !dictation.listening &&
    quietAt !== session.lastActivityAt;

  /** Hands the message to the chat's outbox: it shows at once, and the box is empty again. */
  function send(reply?: string) {
    // A message can be just files: Claude is then told what they are called.
    const value =
      reply ?? (text.trim() || (ready.length ? `Attached: ${ready.map((d) => d.ref!.name).join(', ')}` : ''));
    if (!value || locked || uploading) return;
    // Sent: the keyboard goes away, so the conversation has the screen (like a messenger).
    Keyboard.dismiss();
    dictation.cancel();
    setQuietAt(session.lastActivityAt);
    setError(null);
    thud();
    onSending?.();
    const choices = {
      ...(model && !modelLocked ? { model } : {}),
      ...(mode && !modelLocked && (!isCodex || codexModes) ? { permissionMode: mode } : {}),
      ...(effort && !modelLocked ? { effort } : {}),
    };
    submit({
      key: key.current,
      // Ended: the PC reopens this conversation and runs the message in it.
      path: resuming ? `/sessions/${session.id}/resume` : `/sessions/${session.id}/instructions`,
      body: {
        text: value,
        idempotencyKey: key.current,
        ...choices,
        ...(ready.length && !reply ? { attachmentIds: files.ids } : {}),
      },
      text: value,
      files: reply ? [] : ready.map((d) => d.ref!),
    });
    key.current = newId();
    if (reply) return;
    setText('');
    files.clear();
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
      {(error ?? dictation.error) && (
        <Animated.View exiting={exit.fade} layout={layout} testID="send-error">
          <Notice solid>{error ?? dictation.error}</Notice>
        </Animated.View>
      )}
      {offerReplies && (
        <Animated.View entering={enter.fade} exiting={exit.fade} layout={layout}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 8 }}
            testID="quick-replies"
          >
            {(replies?.length ? replies : QUICK_REPLIES.map((r) => ({ label: r, message: r }))).map((r) => (
              <Press
                key={r.label}
                accessibilityRole="button"
                accessibilityLabel={`Send: ${r.message}`}
                onPress={() => send(r.message)}
                scale={0.96}
                style={{
                  borderRadius: radius.full,
                  borderWidth: 1,
                  borderColor: alpha(c.primary, 0.35),
                  backgroundColor: tint(c.primary, 0.1, c.background),
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                }}
              >
                <T variant="smallMedium" tone="primary">
                  {r.label}
                </T>
              </Press>
            ))}
          </ScrollView>
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
                : `Message ${agentName(session.provider)}…`
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
              {(!isCodex || codexModes) && (
                <ModePicker
                  value={mode}
                  onChange={chooseMode}
                  locked={modelLocked}
                  live={live}
                  modes={modesFor(session.provider)}
                />
              )}
              <ModelPicker
                models={models}
                value={model}
                onChange={chooseModel}
                effort={effort}
                onEffort={setEffort}
                locked={modelLocked}
                live={live}
              />
            </>
          )}
          <View style={{ flex: 1 }} />
          {dictates && !locked && <MicButton dictation={dictation} disabled={false} />}
          <SendButton
            stopMode={stopMode}
            disabled={stopMode ? interrupting || !canInterrupt : uploading || !hasContent || !!locked}
            busy={interrupting}
            label={
              stopMode
                ? canInterrupt
                  ? session.mode === 'managed'
                    ? `Stop ${agentName(session.provider)}`
                    : `Stop ${agentName(session.provider)} (it stops at its next step)`
                  : 'Stopping is turned off on this PC (pocket-agent instructions enable)'
                : 'Send'
            }
            onPress={() => (stopMode ? void interrupt() : send())}
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
