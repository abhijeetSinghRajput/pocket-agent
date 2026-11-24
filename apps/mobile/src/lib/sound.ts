import { Asset } from 'expo-asset';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { uiSound } from '../../modules/ui-sound';

/**
 * The app's UI sounds, rendered from their definitions by scripts/make-sounds.py. They mix with
 * whatever else is playing and never block: a sound that can't play is simply not heard.
 *
 * On Android they go through SoundPool (modules/ui-sound): a media player (expo-audio) gets a media
 * session, and the phone then shows a media player for a tick in the notification shade.
 */
const SOURCES = {
  // Toggles and segmented choices (theme, effort).
  print: require('../../assets/sounds/print.wav') as number,
  // The PC came online (the big tick).
  landed: require('../../assets/sounds/landed.wav') as number,
};
type Sound = keyof typeof SOURCES;

// SoundPool reads files: the bundled sounds are copied to the app's cache once, at start.
const pool = uiSound;
if (pool) {
  for (const [name, source] of Object.entries(SOURCES)) {
    void Asset.fromModule(source)
      .downloadAsync()
      .then((a) => a.localUri && pool.load(name, a.localUri))
      .catch(() => undefined);
  }
}

const players = new Map<Sound, AudioPlayer>();

export function playSound(name: Sound): void {
  try {
    if (pool) return pool.play(name);
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
