import type { EventSubscription } from 'expo-modules-core';
import { useEffect, useRef, useState } from 'react';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { dur } from '@/lib/motion';
import { thud } from '@/ui/core';
import { speechInput } from '../../../modules/speech-input';

/** Is dictation possible on this phone (a speech service and this build's module). */
export function canDictate(): boolean {
  try {
    return !!speechInput?.isAvailable();
  } catch {
    return false;
  }
}

/**
 * How long you can be quiet before dictation stops: the shortest the module takes, so it ends
 * about when the phone's own recognizer would (the keyboard's mic feels the same).
 */
export const DICTATION_SILENCE_MS = 1000;

/**
 * Dictating into a message box: the words appear as they are heard, after whatever was already
 * typed. It stops at the phone's natural pause after you finish speaking, or with a second tap.
 */
export function useDictation(text: string, setText: (next: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const level = useSharedValue(0);
  const subs = useRef<EventSubscription[]>([]);

  const unsubscribe = () => {
    for (const s of subs.current) s.remove();
    subs.current = [];
  };
  useEffect(
    () => () => {
      for (const s of subs.current) s.remove();
      subs.current = [];
      void speechInput?.cancel().catch(() => undefined);
    },
    [],
  );

  async function start() {
    const native = speechInput;
    if (!native) return;
    setError(null);
    const permission = await native.requestPermission().catch(() => ({ granted: false, canAskAgain: false }));
    if (!permission.granted) {
      setError(
        permission.canAskAgain
          ? 'Dictation needs the microphone.'
          : 'The microphone is off for Pocket Agent. Turn it on in Android Settings → Apps → Pocket Agent → Permissions.',
      );
      return;
    }
    // Dictated words go after what is already in the box; each finished phrase is kept, and the
    // phrase being spoken shows after them.
    const join = (a: string, b: string) => (a && b ? `${a} ${b}` : a || b);
    let said = text.trimEnd();
    unsubscribe();
    subs.current = [
      native.addListener('onPartial', (e) => setText(join(said, e.text))),
      native.addListener('onResult', (e) => {
        said = join(said, e.text);
        setText(said);
      }),
      native.addListener('onError', (e) => setError(e.message)),
      native.addListener('onLevel', (e) => level.set(withTiming(e.level, { duration: 90 }))),
      native.addListener('onEnd', () => {
        unsubscribe();
        level.set(withTiming(0, { duration: dur.quick }));
        setListening(false);
      }),
    ];
    thud();
    setListening(true);
    try {
      await native.start('', DICTATION_SILENCE_MS);
    } catch (err) {
      unsubscribe();
      setListening(false);
      setError((err as Error).message);
    }
  }

  function toggle() {
    if (listening) void speechInput?.stop().catch(() => undefined);
    else void start();
  }

  /** Stops and drops anything still being heard (the message was sent). */
  function cancel() {
    if (!subs.current.length) return;
    unsubscribe();
    setListening(false);
    level.set(0);
    void speechInput?.cancel().catch(() => undefined);
  }

  return { listening, error, level, toggle, cancel };
}
