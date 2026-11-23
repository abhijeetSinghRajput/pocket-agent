import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

/**
 * Light or dark, your way: follow the phone (the default), or pin one. The choice is kept on this
 * phone and applied through React Native's appearance, so every `useColorScheme()` (and so every
 * `useTheme()`) in the app follows it.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'pocket-agent:theme';
const PREFERENCES: ThemePreference[] = ['system', 'light', 'dark'];

let current: ThemePreference = 'system';
const listeners = new Set<() => void>();

function apply(pref: ThemePreference) {
  current = pref;
  Appearance.setColorScheme(pref === 'system' ? 'auto' : pref);
  for (const l of listeners) l();
}

/** Reads the saved choice and applies it. Called once, before the first screen is shown. */
export async function loadThemePreference(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (PREFERENCES.includes(saved as ThemePreference)) apply(saved as ThemePreference);
  } catch {
    /* no saved choice: follow the phone */
  }
}

export function setThemePreference(pref: ThemePreference) {
  apply(pref);
  void (pref === 'system' ? AsyncStorage.removeItem(KEY) : AsyncStorage.setItem(KEY, pref)).catch(
    () => undefined,
  );
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, () => current);
}
