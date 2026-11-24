import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';

type Events = {
  onPartial: (e: { text: string }) => void;
  onResult: (e: { text: string }) => void;
  onError: (e: { message: string }) => void;
  onEnd: () => void;
  onLevel: (e: { level: number }) => void;
};

declare class SpeechInputNative extends NativeModule<Events> {
  isAvailable(): boolean;
  requestPermission(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  start(language: string): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
}

/**
 * Dictation with the phone's own speech recognizer (the one the keyboard's mic uses). Null on iOS,
 * web or a build without it.
 */
export const speechInput = requireOptionalNativeModule<SpeechInputNative>('SpeechInput');
