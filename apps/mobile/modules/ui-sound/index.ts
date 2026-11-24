import { requireOptionalNativeModule } from 'expo-modules-core';

interface UiSoundNative {
  load(key: string, uri: string): void;
  play(key: string): void;
}

/**
 * Short UI sounds through Android's SoundPool (no media session, so no media player in the
 * notification shade). Null on iOS, web or a build without it.
 */
export const uiSound = requireOptionalNativeModule<UiSoundNative>('UiSound');
