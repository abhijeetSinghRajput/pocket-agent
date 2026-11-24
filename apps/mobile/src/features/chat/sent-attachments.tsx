import {
  AttachmentLinkResponse,
  fileExtension,
  isPdf,
  isPreviewable,
  type AttachmentRef,
} from '@pocket-agent/protocol';
import { fileSize } from '@pocket-agent/core';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { FileText, ImageOff, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import {
  GestureDetector,
  GestureHandlerRootView,
  useExclusiveGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { API_URL, apiRequest, authHeaders } from '@/lib/api';
import { dur, ease, enter, exit, settleSpring } from '@/lib/motion';
import { fonts, radius, useTheme } from '@/lib/theme';
import { Press, T, tap } from '@/ui/core';

/** The same words as the web app's lib/attachments. */
/** The small preview the server keeps (also after the file itself was removed). Needs the session. */
export const thumbUrl = (id: string) => `${API_URL}/attachments/${id}/thumb`;
const thumbSource = (id: string) => ({ uri: thumbUrl(id), headers: authHeaders() });

/** Links the server signed, by file: each is valid for 5 minutes; reused for 4. */
const links = new Map<string, { url: Promise<string>; until: number }>();
const LINK_REUSE_MS = 4 * 60_000;

/**
 * A short-lived link to the original file; throws with the reason if it can't be opened any more.
 * Scrolling a photo out of view and back reuses the link instead of asking for a new one.
 */
export function attachmentLink(id: string): Promise<string> {
  const now = Date.now();
  const known = links.get(id);
  if (known && known.until > now) return known.url;
  const url = apiRequest(`/attachments/${id}/link`, AttachmentLinkResponse).then((r) => r.url);
  links.set(id, { url, until: now + LINK_REUSE_MS });
  url.catch(() => links.delete(id));
  if (links.size > 200) links.delete(links.keys().next().value!);
  return url;
}

/** The original, cached on the phone by file (each signed link is a different address). */
const originalSource = (id: string, uri: string) => ({ uri, cacheKey: `attachment-${id}` });

/** Opens the original file in the system browser (PDF viewer, download…). */
export async function openAttachment(id: string): Promise<void> {
  const url = await attachmentLink(id);
  await WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  });
}

const WHITE = '#ffffff';
const ON_BUBBLE = 'rgba(0, 0, 0, 0.15)';
const ON_BUBBLE_DEEP = 'rgba(0, 0, 0, 0.2)';

/** One sent photo or PDF: its preview; tapping opens the original (while it still exists). */
function SentFile({ file, single, fg }: { file: AttachmentRef; single: boolean; fg: string }) {
  const [broken, setBroken] = useState(false);
  // A photo shown large swaps its preview for the original once that arrives, so it is sharp;
  // the preview shows meanwhile (and stays if the original is gone).
  const [sharp, setSharp] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pdf = isPdf(file);
  const image = isPreviewable(file.mime) && !pdf;

  useEffect(() => {
    if (!image || !single) return;
    let live = true;
    attachmentLink(file.id)
      .then((url) => live && setSharp(url))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [image, single, file.id]);

  async function open() {
    tap();
    if (image && !broken) {
      // A picture opens right here, full screen; the viewer fetches the original behind the preview.
      setViewing(true);
      return;
    }
    setOpening(true);
    setError(null);
    try {
      await openAttachment(file.id);
    } catch (err) {
      // Usually: the file was removed after 30 days and only this preview is left.
      setError((err as Error).message);
    } finally {
      setOpening(false);
    }
  }

  const errorText = error && (
    <Animated.View entering={enter.fade}>
      <T variant="caption" style={{ color: fg, opacity: 0.9, marginTop: 4 }} accessibilityRole="alert">
        {error}
      </T>
    </Animated.View>
  );

  if (!isPreviewable(file.mime)) {
    // Not a picture: the file as a card (type, name, size); tapping opens it.
    const ext = fileExtension(file.name) || 'file';
    return (
      <View style={{ width: '100%', minWidth: 0 }}>
        <Press
          accessibilityRole="button"
          accessibilityLabel={`Open ${file.name}`}
          testID="attachment"
          onPress={() => void open()}
          haptic={false}
          scale={0.98}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            padding: 8,
            paddingRight: 12,
            borderRadius: radius.lg,
            backgroundColor: ON_BUBBLE,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: radius.md,
              backgroundColor: ON_BUBBLE_DEEP,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {opening ? (
              <ActivityIndicator size="small" color={WHITE} />
            ) : (
              <T style={{ fontFamily: fonts.monoMedium, fontSize: 10.5, lineHeight: 14, color: fg }}>
                {ext.slice(0, 4).toUpperCase()}
              </T>
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="smallMedium" style={{ color: fg, fontSize: 13 }} numberOfLines={1}>
              {file.name}
            </T>
            <T variant="caption" style={{ color: fg, opacity: 0.8, fontSize: 11 }}>
              {fileSize(file.size)}
            </T>
          </View>
        </Press>
        {errorText}
      </View>
    );
  }

  return (
    <View style={single ? { width: 224, maxWidth: '100%' } : { width: '48.5%' }}>
      <Press
        accessibilityRole="imagebutton"
        accessibilityLabel={`Open ${file.name}`}
        accessibilityHint={`${file.name} · ${fileSize(file.size)}`}
        testID="attachment"
        onPress={() => void open()}
        haptic={false}
        scale={0.98}
        style={{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: ON_BUBBLE }}
      >
        {broken ? (
          <View style={{ aspectRatio: 4 / 3, alignItems: 'center', justifyContent: 'center' }}>
            {pdf ? (
              <FileText size={28} color={fg} strokeWidth={1.8} style={{ opacity: 0.8 }} />
            ) : (
              <ImageOff size={28} color={fg} strokeWidth={1.8} style={{ opacity: 0.8 }} />
            )}
          </View>
        ) : (
          <Image
            source={sharp ? originalSource(file.id, sharp) : thumbSource(file.id)}
            placeholder={sharp ? thumbSource(file.id) : undefined}
            placeholderContentFit="cover"
            recyclingKey={file.id}
            contentFit="cover"
            transition={{ duration: dur.enter, effect: 'cross-dissolve' }}
            onError={() => setBroken(true)}
            style={
              single
                ? { width: '100%', height: 224, backgroundColor: WHITE }
                : { aspectRatio: 1, backgroundColor: WHITE }
            }
            accessibilityIgnoresInvertColors
          />
        )}
        {pdf && (
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 8,
              paddingVertical: 4,
              backgroundColor: 'rgba(0, 0, 0, 0.65)',
            }}
          >
            <FileText size={14} color={WHITE} strokeWidth={2} />
            <T variant="captionMedium" style={{ color: WHITE, fontSize: 11, flex: 1 }} numberOfLines={1}>
              {file.name}
            </T>
          </View>
        )}
        {opening && (
          <Animated.View
            entering={enter.fade}
            exiting={exit.fade}
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: 'rgba(0, 0, 0, 0.4)', alignItems: 'center', justifyContent: 'center' },
            ]}
          >
            <ActivityIndicator size="small" color={WHITE} />
          </Animated.View>
        )}
      </Press>
      {errorText}
      {image && <ImageViewer file={file} open={viewing} onClose={() => setViewing(false)} />}
    </View>
  );
}

/** The photos/PDFs of a message, above its text. */
export function SentAttachments({ files, color }: { files: AttachmentRef[]; color?: string }) {
  const { c } = useTheme();
  if (!files.length) return null;
  return (
    <View testID="attachments" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
      {files.map((f) => (
        <SentFile key={f.id} file={f} single={files.length === 1} fg={color ?? c.bubbleOutForeground} />
      ))}
    </View>
  );
}

/**
 * A sent picture, full screen on a dark backdrop: it fades and settles in, pinches to zoom and
 * pans while zoomed. A tap, the X or the back button closes it. The original is fetched behind
 * the preview and shown as soon as it arrives.
 */
function ImageViewer({ file, open, onClose }: { file: AttachmentRef; open: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [mounted, setMounted] = useState(open);
  const [full, setFull] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const progress = useSharedValue(0);
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const start = useSharedValue({ x: 0, y: 0 });

  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (!mounted) return;
    if (open) {
      progress.set(withTiming(1, { duration: dur.enter, easing: ease.out }));
    } else {
      progress.set(
        withTiming(0, { duration: dur.quick, easing: ease.out }, (done) => {
          if (done) scheduleOnRN(setMounted, false);
        }),
      );
    }
  }, [open, mounted, progress]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    attachmentLink(file.id)
      .then((url) => {
        if (!live) return;
        setError(null);
        setFull(url);
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [open, file.id]);

  const close = () => {
    scale.set(1);
    saved.set(1);
    tx.set(0);
    ty.set(0);
    onClose();
  };

  const pinch = usePinchGesture({
    onUpdate: (e) => {
      'worklet';
      scale.set(Math.min(5, Math.max(0.7, saved.get() * e.scale)));
    },
    onDeactivate: () => {
      'worklet';
      const s = scale.get();
      if (s < 1) {
        scale.set(withSpring(1, settleSpring));
        tx.set(withSpring(0, settleSpring));
        ty.set(withSpring(0, settleSpring));
        saved.set(1);
      } else saved.set(s);
    },
  });
  const pan = usePanGesture({
    minPointers: 1,
    maxPointers: 2,
    activeOffsetX: [-8, 8],
    activeOffsetY: [-8, 8],
    onBegin: () => {
      'worklet';
      start.set({ x: tx.get(), y: ty.get() });
    },
    onUpdate: (e) => {
      'worklet';
      if (scale.get() <= 1) return;
      tx.set(start.get().x + e.translationX);
      ty.set(start.get().y + e.translationY);
    },
    onDeactivate: (e) => {
      'worklet';
      // A quick flick on an unzoomed picture dismisses it.
      if (scale.get() <= 1 && Math.abs(e.velocityY) > 900) scheduleOnRN(close);
    },
  });
  const tapToClose = useTapGesture({
    onDeactivate: (e) => {
      'worklet';
      if (!e.canceled) scheduleOnRN(close);
    },
  });
  const zoom = useSimultaneousGestures(pinch, pan);
  const gesture = useExclusiveGestures(zoom, tapToClose);

  const backdrop = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const picture = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [
      { translateX: tx.get() },
      { translateY: ty.get() },
      { scale: (0.95 + 0.05 * progress.get()) * scale.get() },
    ],
  }));

  if (!mounted) return null;
  const top = insets.top + 56;
  const bottom = insets.bottom + 16;
  const source = full ? originalSource(file.id, full) : thumbSource(file.id);
  return (
    <Modal
      transparent
      visible
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={close}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View
          testID="image-viewer"
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.92)' }, backdrop]}
        >
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close" onPress={close} />
          <GestureDetector gesture={gesture}>
            <Animated.View
              style={[
                {
                  position: 'absolute',
                  left: 16,
                  right: 16,
                  top,
                  bottom,
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                picture,
              ]}
            >
              <Image
                source={source}
                placeholder={full ? thumbSource(file.id) : undefined}
                placeholderContentFit="contain"
                contentFit="contain"
                transition={{ duration: dur.enter, effect: 'cross-dissolve' }}
                style={{ width: width - 32, height: height - top - bottom, borderRadius: radius.md }}
                accessibilityLabel={file.name}
                accessibilityIgnoresInvertColors
              />
            </Animated.View>
          </GestureDetector>
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              top: insets.top + 8,
              left: 16,
              right: 8,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <T variant="smallMedium" style={{ color: WHITE, flex: 1 }} numberOfLines={1}>
              {file.name}
            </T>
            <Press
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={close}
              scale={0.9}
              hitSlop={6}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={22} color={WHITE} strokeWidth={2} />
            </Press>
          </View>
          {error && (
            <Animated.View
              entering={enter.rise()}
              style={{
                position: 'absolute',
                left: 24,
                right: 24,
                bottom: insets.bottom + 24,
                alignItems: 'center',
              }}
            >
              <T variant="small" center style={{ color: WHITE, opacity: 0.85 }} accessibilityRole="alert">
                {error}
              </T>
            </Animated.View>
          )}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}
