package expo.modules.uisound

import android.media.AudioAttributes
import android.media.SoundPool
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The app's short UI sounds (a tick, a "landed" chime) through Android's SoundPool: made for
 * exactly this, with no media session, so the phone shows no media player for them in the
 * notification shade (a media player per sound did).
 */
class UiSoundModule : Module() {
  private var pool: SoundPool? = null
  private val sounds = mutableMapOf<String, Int>()

  private fun pool(): SoundPool =
    pool ?: SoundPool.Builder()
      .setMaxStreams(4)
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build(),
      )
      .build()
      .also { pool = it }

  override fun definition() = ModuleDefinition {
    Name("UiSound")

    /** Loads a sound file (a file:// URI or a path) under `key`; playing it before then is silent. */
    Function("load") { key: String, uri: String ->
      if (sounds.containsKey(key)) return@Function
      val path = if (uri.startsWith("file://")) Uri.parse(uri).path ?: return@Function else uri
      sounds[key] = pool().load(path, 1)
    }

    /** Plays a loaded sound from the start (several may overlap). */
    Function("play") { key: String ->
      val id = sounds[key] ?: return@Function
      pool?.play(id, 1f, 1f, 1, 0, 1f)
    }

    OnDestroy {
      pool?.release()
      pool = null
      sounds.clear()
    }
  }
}
