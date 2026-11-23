import { Image } from 'expo-image';
import { FileText, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fileSize, isImage, type DraftFile } from '@/features/chat/upload';
import { dur, ease, enter, exit, layout } from '@/lib/motion';
import { alpha, radius, useTheme } from '@/lib/theme';
import { IconButton, Press, T } from '@/ui/core';

export type { DraftFile } from '@/features/chat/upload';

/** A picked file as a chip: its preview, name and what is happening to it; the X takes it out. */
function DraftChip({ draft, onRemove }: { draft: DraftFile; onRemove: () => void }) {
  const { c } = useTheme();
  const [viewing, setViewing] = useState(false);
  const picture = isImage(draft.file);
  const failed = draft.status === 'error';
  const uploading = draft.status === 'uploading';
  const name = draft.file.name || 'Pasted image';

  // The upload's progress, drawn as a bar along the chip's bottom edge. An upload is three steps
  // (the server signs it, the bytes go to storage, the server checks them), and only the middle one
  // reports progress; so the bar also creeps on by itself, slowing as it goes, and never stalls.
  const sent = useSharedValue(0);
  const creep = useSharedValue(0);
  useEffect(() => {
    sent.set(withTiming(draft.progress ?? 0, { duration: dur.quick, easing: ease.move }));
  }, [draft.progress, sent]);
  useEffect(() => {
    if (uploading) creep.set(withTiming(0.9, { duration: 6000, easing: Easing.out(Easing.cubic) }));
    else creep.set(withTiming(1, { duration: dur.quick, easing: ease.out }));
  }, [uploading, creep]);
  const bar = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.max(creep.value, 0.08 + 0.8 * sent.value) }],
  }));
  const shade = useAnimatedStyle(() => ({
    opacity: withTiming(uploading ? 1 : 0, { duration: dur.quick, easing: ease.out }),
  }));

  return (
    <Animated.View
      entering={enter.pop}
      exiting={exit.fade}
      layout={layout}
      testID="draft-file"
      accessibilityLabel={`${name}, ${failed ? (draft.error ?? 'Could not upload') : uploading ? 'uploading' : fileSize(draft.file.size)}`}
      style={{
        height: 56,
        maxWidth: 220,
        borderRadius: radius.lg,
        backgroundColor: failed ? alpha(c.destructive, 0.1) : c.muted,
        overflow: 'hidden',
      }}
    >
      {/* The whole chip opens the picture (all but the X, which takes it out). */}
      <Press
        disabled={!picture}
        dim={false}
        haptic={false}
        scale={0.98}
        onPress={() => setViewing(true)}
        accessibilityRole={picture ? 'imagebutton' : undefined}
        accessibilityLabel={picture ? `View ${name}` : undefined}
        testID="draft-file-open"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 56,
          paddingLeft: 6,
          paddingRight: 34,
          borderRadius: radius.lg,
        }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: radius.sm,
            overflow: 'hidden',
            backgroundColor: c.background,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {picture ? (
            <Image
              source={{ uri: draft.file.uri }}
              style={{ width: 44, height: 44 }}
              contentFit="cover"
              transition={dur.quick}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <FileText size={20} color={c.mutedForeground} strokeWidth={2} />
          )}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
              shade,
            ]}
          >
            <ActivityIndicator size="small" color="#ffffff" />
          </Animated.View>
        </View>
        <View style={{ minWidth: 0, flexShrink: 1 }}>
          <T variant="captionMedium" numberOfLines={1} style={failed ? { color: c.destructive } : undefined}>
            {name}
          </T>
          <T
            variant="caption"
            numberOfLines={1}
            style={{ fontSize: 11, lineHeight: 15, color: failed ? c.destructive : c.mutedForeground }}
          >
            {failed
              ? (draft.error ?? 'Could not upload')
              : uploading
                ? 'Uploading…'
                : fileSize(draft.file.size)}
          </T>
        </View>
      </Press>
      <View style={{ position: 'absolute', top: 2, right: 2 }}>
        <IconButton icon={X} label={`Remove ${draft.file.name || 'file'}`} size={28} onPress={onRemove} />
      </View>
      {uploading && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 3,
              backgroundColor: c.primary,
              transformOrigin: 'left',
            },
            bar,
          ]}
        />
      )}
      {picture && (
        <ImageViewer uri={draft.file.uri} name={name} open={viewing} onClose={() => setViewing(false)} />
      )}
    </Animated.View>
  );
}

/** A picked image, full screen. Tap anywhere, the X or the back button closes it. */
function ImageViewer({
  uri,
  name,
  open,
  onClose,
}: {
  uri: string;
  name: string;
  open: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!open) return null;
  return (
    <Modal
      transparent
      visible
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        testID="image-viewer"
        accessibilityLabel="Close"
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.92)',
          paddingTop: insets.top + 56,
          paddingBottom: insets.bottom + 16,
          paddingHorizontal: 16,
        }}
      >
        <Animated.View entering={enter.pop} style={{ flex: 1 }}>
          <Image
            source={{ uri }}
            style={{ flex: 1, borderRadius: radius.md }}
            contentFit="contain"
            accessibilityLabel={name}
            accessibilityIgnoresInvertColors
          />
        </Animated.View>
        <View
          style={{
            position: 'absolute',
            top: insets.top + 8,
            left: 16,
            right: 64,
            height: 44,
            justifyContent: 'center',
          }}
        >
          <T variant="smallMedium" numberOfLines={1} style={{ color: '#ffffff' }}>
            {name}
          </T>
        </View>
        <Press
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={6}
          scale={0.9}
          style={{
            position: 'absolute',
            top: insets.top + 8,
            right: 8,
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={22} color="#ffffff" strokeWidth={2} />
        </Press>
      </Pressable>
    </Modal>
  );
}

export function DraftFiles({ drafts, onRemove }: { drafts: DraftFile[]; onRemove: (key: string) => void }) {
  if (!drafts.length) return null;
  return (
    <Animated.View
      layout={layout}
      accessibilityLabel="Attached files"
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingTop: 12 }}
    >
      {drafts.map((d) => (
        <DraftChip key={d.key} draft={d} onRemove={() => onRemove(d.key)} />
      ))}
    </Animated.View>
  );
}
