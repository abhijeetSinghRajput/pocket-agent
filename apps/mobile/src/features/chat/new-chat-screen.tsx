import { buildChat, commandError, NEW_CHAT_MODE, newChatModel, waitForSession } from '@pocket-agent/core';
import {
  attachmentLimit,
  CommandResponse,
  RESUME_FILES_AGENT_VERSION,
  versionBelow,
  type CommandDto,
  type TurnEffort,
  type TurnMode,
} from '@pocket-agent/protocol';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ComponentRef } from 'react';
import { findNodeHandle, Pressable, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AttachButton, MicButton, SendButton } from '@/features/chat/composer';
import { canDictate, useDictation } from '@/features/chat/dictation';
import { DraftFiles } from '@/features/chat/draft-files';
import { ChatMessages } from '@/features/chat/messages';
import { AttachMenu, ModelPicker, ModePicker } from '@/features/chat/pickers';
import { newId } from '@/features/chat/upload';
import { useDraftFiles } from '@/features/chat/use-draft-files';
import { enableImagePaste, type PastedImage } from '../../../modules/image-paste';
import { AgentLogo, AGENT_LOGOS } from '@/features/sessions/badges';
import { apiRequest } from '@/lib/api';
import { useDevices } from '@/lib/data';
import { dur, ease, enter, exit, layout } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { buzz, IconButton, T, thud } from '@/ui/core';
import { Notice, Roll } from '@/ui/feedback';

const fetchCommand = (id: string) => apiRequest(`/commands/${id}`, CommandResponse).then((r) => r.command);

function ClaudeAvatar({ size }: { size: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: alpha(AGENT_LOGOS['claude-code'].hex, 0.14),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <AgentLogo provider="claude-code" size={Math.round(size * 0.55)} />
    </View>
  );
}

/**
 * A chat that has not started yet, in a folder picked from New chat. Sending the first message
 * starts Claude Code there on the PC; the chat then opens as the real session.
 */
export function NewChatScreen({ deviceId, path, name }: { deviceId: string; path: string; name: string }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const device = useDevices().state.data?.find((d) => d.id === deviceId);
  const [text, setText] = useState('');
  const dictation = useDictation(text, setText);
  const [dictates] = useState(canDictate);
  // null until picked: the new-chat default (Opus) applies; '' is the PC's own default.
  const [model, setModel] = useState<string | null>(null);
  const [mode, setMode] = useState<string>(NEW_CHAT_MODE);
  const [effort, setEffort] = useState('');
  // The first message once sent: shown as sent while the PC starts Claude.
  const [command, setCommand] = useState<CommandDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dock, setDock] = useState(0);
  const key = useRef(newId());
  const alive = useRef(true);
  const box = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const models = device?.models ?? [];
  // A model the PC no longer offers is never sent.
  const chosenModel =
    model !== null && (model === '' || models.some((m) => m.id === model)) ? model : newChatModel(models);
  const starting = command !== null;
  const locked = !device
    ? 'This PC is no longer paired.'
    : device.status !== 'Online'
      ? 'Your PC is offline. Start Pocket Agent on it to begin.'
      : null;
  const items = useMemo(() => (command ? buildChat([], [command]) : []), [command]);

  // Photos and files go with the first message (PC agents from 0.1.6 take them).
  const [attachOpen, setAttachOpen] = useState(false);
  const files = useDraftFiles(attachmentLimit(device?.agentVersion), setError);
  const canAttach =
    !locked && !starting && !versionBelow(device?.agentVersion ?? '0', RESUME_FILES_AGENT_VERSION);
  const onPasted = useEffectEvent((pasted: PastedImage[]) => files.add(pasted));
  useEffect(() => {
    const tag = canAttach && box.current ? findNodeHandle(box.current) : null;
    if (tag == null) return;
    return enableImagePaste(tag, onPasted);
  }, [canAttach]);
  const hasContent = !!text.trim() || files.ready.length > 0;

  async function start() {
    dictation.cancel();
    // A first message can be just files: Claude is then told what they are called.
    const value =
      text.trim() ||
      (files.ready.length ? `Attached: ${files.ready.map((d) => d.ref!.name).join(', ')}` : '');
    if (!value || starting || locked || files.uploading) return;
    const typed = text;
    setError(null);
    thud();
    try {
      let { command: sent } = await apiRequest(`/devices/${deviceId}/sessions`, CommandResponse, {
        method: 'POST',
        body: {
          projectPath: path,
          text: value,
          idempotencyKey: key.current,
          ...(chosenModel ? { model: chosenModel } : {}),
          ...(mode ? { permissionMode: mode as TurnMode } : {}),
          ...(effort ? { effort: effort as TurnEffort } : {}),
          ...(files.ready.length ? { attachmentIds: files.ids } : {}),
        },
      });
      setCommand(sent);
      setText('');
      // The files now belong to the message (shown in it while the PC starts Claude).
      files.clear();
      sent = await waitForSession(sent, fetchCommand, () => alive.current);
      if (!alive.current) return;
      if (sent.sessionId) {
        buzz(true);
        router.replace({ pathname: '/chat/[id]', params: { id: sent.sessionId } });
        return;
      }
      buzz(false);
      setError(commandError(sent) ?? 'Your PC did not start the session in time.');
      setText(typed);
      setCommand(null);
      key.current = newId();
    } catch (err) {
      if (!alive.current) return;
      buzz(false);
      setError((err as Error).message);
      setText(typed);
      setCommand(null);
    }
  }

  const focus = useSharedValue(0);
  const edge = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focus.value, [0, 1], [c.border, alpha(c.primary, 0.6)]),
  }));

  return (
    <View style={{ flex: 1, backgroundColor: c.background }} accessibilityLabel={`New chat in ${name}`}>
      <View
        testID="chat-header"
        style={{
          paddingTop: insets.top + 4,
          paddingBottom: 8,
          paddingHorizontal: 6,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          backgroundColor: c.bar,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}
      >
        <IconButton
          icon={ArrowLeft}
          label="Back"
          tone="default"
          disabled={starting}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
        <ClaudeAvatar size={36} />
        <View style={{ flex: 1, minWidth: 0, marginLeft: 4 }}>
          <T variant="subheading" numberOfLines={1} accessibilityRole="header">
            {name}
          </T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 }}>
            <View style={{ flexShrink: 1 }}>
              <Roll
                text={starting ? 'starting…' : 'new chat'}
                variant={starting ? 'captionMedium' : 'caption'}
                color={starting ? c.primary : c.mutedForeground}
              />
            </View>
            {device && (
              <>
                <T variant="caption" tone="muted" accessibilityElementsHidden>
                  ·
                </T>
                <T variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {device.name}
                </T>
              </>
            )}
          </View>
        </View>
      </View>

      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={-insets.bottom} style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
          {starting ? (
            <ChatMessages items={items} typing="starting" bottomInset={dock} />
          ) : (
            <Animated.View
              entering={enter.rise()}
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 32,
                paddingBottom: dock,
                gap: 8,
              }}
            >
              <ClaudeAvatar size={64} />
              <T variant="subheading" center style={{ marginTop: 8 }}>
                What should Claude do in {name}?
              </T>
              <T variant="caption" tone="muted" center style={{ fontFamily: fonts.mono }}>
                {path}
              </T>
              <T variant="small" tone="muted" center style={{ marginTop: 4 }}>
                Claude Code starts on {device?.name ?? 'your PC'} when you send your first message. Anything
                that needs permission asks you here.
              </T>
            </Animated.View>
          )}

          <View
            pointerEvents="box-none"
            onLayout={(e) => setDock(Math.round(e.nativeEvent.layout.height))}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              paddingHorizontal: 12,
              paddingTop: 4,
              paddingBottom: 12 + insets.bottom,
              gap: 8,
            }}
          >
            {(error ?? dictation.error) && (
              <Animated.View exiting={exit.fade} layout={layout} testID="send-error">
                <Notice>{error ?? dictation.error}</Notice>
              </Animated.View>
            )}
            <Animated.View
              layout={layout}
              testID="composer"
              style={[
                { borderRadius: radius.xl, borderWidth: 1.5, backgroundColor: c.card, overflow: 'hidden' },
                edge,
              ]}
            >
              <Pressable
                accessibilityLabel="First message"
                onPress={() => box.current?.focus()}
                disabled={!!locked || starting}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              />
              <DraftFiles drafts={files.drafts} onRemove={files.remove} />
              <TextInput
                ref={box}
                value={text}
                onChangeText={setText}
                multiline
                maxLength={20_000}
                editable={!locked && !starting}
                accessibilityLabel="First message"
                testID="ns-text"
                placeholder={locked ?? (starting ? 'Starting on your PC…' : 'Message Claude…')}
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
                {canAttach && <AttachButton disabled={files.room <= 0} onPress={() => setAttachOpen(true)} />}
                {!locked && (
                  <>
                    <ModePicker value={mode} onChange={setMode} locked={null} />
                    <ModelPicker
                      models={models}
                      value={chosenModel}
                      onChange={setModel}
                      effort={effort}
                      onEffort={setEffort}
                      locked={null}
                    />
                  </>
                )}
                <View style={{ flex: 1 }} />
                {dictates && !locked && <MicButton dictation={dictation} disabled={starting} />}
                <SendButton
                  stopMode={false}
                  disabled={starting || files.uploading || !hasContent || !!locked}
                  busy={starting}
                  label={starting ? 'Starting on your PC…' : 'Start session'}
                  onPress={() => void start()}
                />
              </View>
            </Animated.View>
          </View>
        </View>
      </KeyboardAvoidingView>
      <AttachMenu
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        onPick={files.add}
        room={files.room}
      />
    </View>
  );
}
