import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

/**
 * The app's UI sounds, rendered from their definitions by scripts/make-sounds.py. They mix with
 * whatever else is playing (expo-audio's default) and never block: a sound that can't play is
 * simply not heard.
 */
const SOURCES = {
  // Toggles and segmented choices (theme, effort).
  print: require('../../assets/sounds/print.wav') as number,
  // The PC came online (the big tick).
  landed: require('../../assets/sounds/landed.wav') as number,
};

const players = new Map<keyof typeof SOURCES, AudioPlayer>();

export function playSound(name: keyof typeof SOURCES): void {
  try {
    let player = players.get(name);
    if (!player) {
      player = createAudioPlayer(SOURCES[name]);
      players.set(name, player);
    }
    // Start from the beginning, also when the last play hasn't finished.
    void player.seekTo(0).catch(() => undefined);
    player.play();
  } catch {
    /* no sound */
  }
}
