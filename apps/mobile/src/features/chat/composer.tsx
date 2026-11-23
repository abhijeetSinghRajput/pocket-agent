import { commandError } from '@pocket-agent/core';
import {
  ATTACHMENT_MAX_PER_MESSAGE,
  CommandResponse,
  RESUME_MIN_AGENT_VERSION,
  type AgentSessionDto,
  type DeviceDto,
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
import { capabilityRows, Ticks } from '@/features/chat/capabilities';
import { DraftFiles } from '@/features/chat/draft-files';
import { AttachMenu, ModelPicker, ModePicker, modelLock } from '@/features/chat/pickers';
import {
  attachmentProblem,
  discardAttachment,
  newId,
  uploadAttachment,
  type DraftFile,
  type PickedFile,
} from '@/features/chat/upload';
import { apiRequest } from '@/lib/api';
import { useDevices } from '@/lib/data';
import { dur, ease, enter, exit, layout } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { useStored } from '@/lib/storage';
import { Button, IconButton, Press, T, buzz, thud } from '@/ui/core';
import { enableImagePaste, type PastedImage } from '../../../modules/image-paste';
import { Notice } from '@/ui/feedback';
import { Sheet } from '@/ui/sheet';

export function canInstruct(s: AgentSessionDto): boolean {
  return !s.endedAt && (s.capabilities.instructAnytime || s.capabilities.instructBetweenTurns);
}

const isBusy = (s: AgentSessionDto) => s.status === 'Running' || s.status === 'WaitingForPermission';

/** When the instruction will actually reach Claude — stated honestly per session type. */
function deliveryHint(s: AgentSessionDto): string {
  if (s.capabilities.instructAnytime) {
    if (isBusy(s)) {
      return s.capabilities.interrupt
        ? 'Claude is busy: this runs as soon as the current task finishes (or interrupt it).'
        : 'Claude is busy: it reads this at its next step, or when the current turn finishes.';
    }
    return s.mode === 'managed'
      ? 'Claude starts on this right away.'
      : 'Claude starts on this right away on your PC. Your editor won’t show it live; follow it here.';
  }
  return s.status === 'WaitingForInput'
    ? 'Claude is idle, so this waits for the next turn you start on the PC. To run it at once, turn on wake on the PC: pocket-agent instructions wake enable'
    : '';
}

async function control(session: AgentSessionDto, action: 'interrupt' | 'stop'): Promise<string | null> {
  const { command } = await apiRequest(`/sessions/${session.id}/${action}`, CommandResponse, {
    method: 'POST',
    body: { idempotencyKey: newId() },
  });
  return command.status === 'Failed' ? commandError(command) : null;
}

/** `a < b` for plain x.y.z versions. */
function versionBelow(a: string, b: string): boolean {
  const x = a.split('-')[0]!.split('.').map(Number);
  const y = b.split('-')[0]!.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}

/**
 * An ended Claude Code session can be continued from here: the PC reopens the same conversation.
 * Returns why not when it can't (shown in place of the message box), or null when it can.
 */
export function resumeBlocker(s: AgentSessionDto, device: DeviceDto | undefined): string | null {
  const ended = 'This session has ended.';
  if (s.provider !== 'claude-code' || !device || device.status === 'Revoked') return ended;
  if (versionBelow(device.agentVersion, RESUME_MIN_AGENT_VERSION))
    return `${ended} To continue it from here, update Pocket Agent on the PC: \`pocket-agent update\``;
  const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();
  if (!device.projects.some((p) => norm(p.path) === norm(s.projectPath)))
    return `${ended} To continue it from here, allow its folder on the PC: \`pocket-agent projects add "${s.projectPath}"\``;
  return null;
}

/** The model picked for this chat. A model the PC no longer offers is never sent. */
function useChosenModel(sessionId: string, models: ModelOption[]) {
  const [model, choose] = useStored(`pocket-agent:model:${sessionId}`);
  return [models.some((m) => m.id === model) ? model : '', choose] as const;
}

export const END_TEXT = (s: AgentSessionDto) =>
  s.mode === 'managed'
    ? 'Claude stops immediately and the session closes. Queued instructions are not run.'
    : 'This closes the session’s Claude Code process on your PC, whatever it is doing. The conversation is kept: you can resume it in your editor.';

// ── Send / stop ──────────────────────────────────────────────────────────────

/**
 * One button: Send when there is something to send; Stop while Claude works. The two icons share
 * the spot and one turns into the other; it breathes while a request is in flight.
 */
/** Send and attach share one size and shape. */
const SEND_SIZE = 36;
const SEND_RADIUS = radius.lg - 2;

function SendButton({
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
  const [drafts, setDrafts] = useState<DraftFile[]>([]);
  const uploads = useRef(new Map<string, AbortController>());
  const [attachOpen, setAttachOpen] = useState(false);
  const uploading = drafts.some((d) => d.status === 'uploading');

  /** Removed before sending: stop the upload, and delete what was already stored. */
  function removeDraft(draftKey: string) {
    uploads.current.get(draftKey)?.abort();
    uploads.current.delete(draftKey);
    const ref = drafts.find((d) => d.key === draftKey)?.ref;
    if (ref) void discardAttachment(ref.id);
    setDrafts((d) => d.filter((x) => x.key !== draftKey));
  }
  const ready = drafts.filter((d) => d.status === 'ready' && d.ref);

  /** Picked files start uploading at once; each can be removed before sending. */
  function addFiles(files: PickedFile[]) {
    setError(null);
    const room = ATTACHMENT_MAX_PER_MESSAGE - drafts.length;
    if (files.length > room) setError(`At most ${ATTACHMENT_MAX_PER_MESSAGE} files per message.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      const draftKey = newId();
      const problem = attachmentProblem(file);
      if (problem) {
        setDrafts((d) => [...d, { key: draftKey, file, status: 'error', error: problem }]);
        continue;
      }
      setDrafts((d) => [...d, { key: draftKey, file, status: 'uploading', progress: 0 }]);
      const abort = new AbortController();
      uploads.current.set(draftKey, abort);
      uploadAttachment(file, abort.signal, (progress) =>
        setDrafts((d) => d.map((x) => (x.key === draftKey ? { ...x, progress } : x))),
      )
        .then((ref) => {
          // Removed while the last step was in flight: don't keep the file.
          if (abort.signal.aborted) return void discardAttachment(ref.id);
          setDrafts((d) =>
            d.map((x) => (x.key === draftKey ? { ...x, status: 'ready', ref, progress: 1 } : x)),
          );
        })
        .catch((err: Error) => {
          if (abort.signal.aborted) return;
          setDrafts((d) =>
            d.map((x) => (x.key === draftKey ? { ...x, status: 'error', error: err.message } : x)),
          );
        })
        .finally(() => uploads.current.delete(draftKey));
    }
  }

  // The box is always there, like any chat app; when this session can't take messages it is
  // disabled and says why (never pretends a message could be delivered).
  const device = useDevices().state.data?.find((d) => d.id === session.deviceId);
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
  const canAttach = !locked && !resuming;
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
            body: { text: value, idempotencyKey: key.current, ...choices },
          })
        : await apiRequest(`/sessions/${session.id}/instructions`, CommandResponse, {
            method: 'POST',
            body: {
              text: value,
              idempotencyKey: key.current,
              ...choices,
              ...(ready.length ? { attachmentIds: ready.map((d) => d.ref!.id) } : {}),
            },
          });
      key.current = newId();
      setText('');
      setDrafts([]);
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
        <DraftFiles drafts={drafts} onRemove={removeDraft} />
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
          {!locked && !resuming && (
            // The same size and shape as Send, in the quiet colour.
            <Press
              accessibilityRole="button"
              accessibilityLabel="Attach files"
              testID="attach-button"
              disabled={drafts.length >= ATTACHMENT_MAX_PER_MESSAGE}
              onPress={() => setAttachOpen(true)}
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
          )}
          {!locked && (
            <>
              <ModePicker value={mode} onChange={setMode} locked={modelLocked} />
              <ModelPicker
                models={models}
                value={model}
                onChange={setModel}
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
        room={ATTACHMENT_MAX_PER_MESSAGE - drafts.length}
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
