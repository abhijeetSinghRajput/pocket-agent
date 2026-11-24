package expo.modules.speechinput

import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Dictating a message with the phone's own speech recognizer (Android's SpeechRecognizer, the
 * same service the keyboard's mic uses).
 *
 * The recognizer itself ends a phrase after a short pause (about a second; most phones ignore a
 * longer pause asked for). So one dictation is a run of phrases: when a phrase ends, listening
 * starts again at once, and only `silenceMs` without a word (or `stop`) ends the dictation.
 *
 * Events: "onPartial" (the phrase so far), "onResult" (a finished phrase: add it to the text),
 * "onLevel" (mic level), "onError"; "onEnd" once, when the dictation is over.
 */
class SpeechInputModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null
  private var intent: Intent? = null
  /** True once the dictation should end (silence, or a tap): the next result is the last. */
  private var finishing = false
  private var active = false
  private var lastSpeechAt = 0L
  private var silenceMs = 3000L

  private val silenceCheck = object : Runnable {
    override fun run() {
      if (!active || finishing) return
      val quiet = SystemClock.elapsedRealtime() - lastSpeechAt
      if (quiet >= silenceMs) finish() else main.postDelayed(this, silenceMs - quiet)
    }
  }

  private fun heard() {
    lastSpeechAt = SystemClock.elapsedRealtime()
  }

  private fun release() {
    recognizer?.destroy()
    recognizer = null
  }

  /** The dictation is over: one "onEnd", and the recognizer is let go. */
  private fun end() {
    if (!active) return
    active = false
    main.removeCallbacks(silenceCheck)
    release()
    sendEvent("onEnd", mapOf<String, Any>())
  }

  /** Stop listening; what is still being heard arrives as the last result, then it ends. */
  private fun finish() {
    if (!active) return
    finishing = true
    main.removeCallbacks(silenceCheck)
    recognizer?.stopListening() ?: end()
    // Between two phrases the recognizer may not answer a stop at all: end anyway.
    main.postDelayed({ end() }, 1500)
  }

  /** The next phrase of the same dictation. */
  private fun listenAgain() {
    val r = recognizer
    val i = intent
    if (!active || finishing || r == null || i == null) return end()
    try {
      r.startListening(i)
    } catch (e: Exception) {
      end()
    }
  }

  private fun firstText(results: Bundle?): String =
    results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""

  private fun message(code: Int): String = when (code) {
    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Didn’t catch that. Try again."
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Pocket Agent isn’t allowed to use the microphone."
    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech needs a connection right now."
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "The microphone is busy. Try again in a moment."
    SpeechRecognizer.ERROR_AUDIO -> "The microphone couldn’t be read."
    else -> "Dictation stopped (error $code)."
  }

  private val listener = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) {}
    override fun onBeginningOfSpeech() = heard()
    override fun onRmsChanged(rmsdB: Float) {
      // Roughly -2…10 dB: 0…1 for the mic's glow.
      sendEvent("onLevel", mapOf("level" to ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)))
    }
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() {}
    override fun onError(error: Int) {
      if (!active) return
      val nothingHeard = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
      when {
        // A pause with nothing said: keep listening until the silence is long enough.
        nothingHeard && !finishing -> main.post { listenAgain() }
        // Ending (silence or a tap) with nothing more to add, or cancelled by us: just end.
        nothingHeard || error == SpeechRecognizer.ERROR_CLIENT -> end()
        else -> {
          sendEvent("onError", mapOf("message" to message(error)))
          end()
        }
      }
    }
    override fun onResults(results: Bundle?) {
      if (!active) return
      val text = firstText(results)
      if (text.isNotEmpty()) {
        heard()
        sendEvent("onResult", mapOf("text" to text))
      }
      if (finishing) end() else main.post { listenAgain() }
    }
    override fun onPartialResults(partialResults: Bundle?) {
      val text = firstText(partialResults)
      if (text.isEmpty()) return
      heard()
      sendEvent("onPartial", mapOf("text" to text))
    }
    override fun onEvent(eventType: Int, params: Bundle?) {}
  }

  override fun definition() = ModuleDefinition {
    Name("SpeechInput")
    Events("onPartial", "onResult", "onError", "onEnd", "onLevel")

    /** Is there a speech service on this phone at all. */
    Function("isAvailable") {
      val context = appContext.reactContext ?: return@Function false
      SpeechRecognizer.isRecognitionAvailable(context)
    }

    AsyncFunction("requestPermission") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.RECORD_AUDIO,
      )
    }

    /**
     * Starts a dictation: it keeps listening through short pauses and ends after `silenceMs`
     * without a word (or with `stop`). `language`: e.g. "en-IN", or "" for the phone's.
     */
    AsyncFunction("start") { language: String, silence: Int ->
      val context = appContext.reactContext ?: throw IllegalStateException("No app context")
      if (active) {
        active = false
        main.removeCallbacks(silenceCheck)
        recognizer?.cancel()
      }
      release()
      silenceMs = silence.coerceIn(1000, 15000).toLong()
      finishing = false
      active = true
      // A little longer to start speaking than between sentences.
      lastSpeechAt = SystemClock.elapsedRealtime() + 2000
      val r = SpeechRecognizer.createSpeechRecognizer(context)
      recognizer = r
      r.setRecognitionListener(listener)
      intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        // Asked for; phones that honour it end fewer phrases early.
        putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, silenceMs)
        putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, silenceMs)
        if (language.isNotEmpty()) putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
      }
      r.startListening(intent)
      main.postDelayed(silenceCheck, silenceMs + 2000)
    }.runOnQueue(Queues.MAIN)

    /** Ends the dictation now; what was heard so far still arrives as the last result. */
    AsyncFunction("stop") {
      finish()
    }.runOnQueue(Queues.MAIN)

    /** Ends the dictation and throws away what is still being heard. */
    AsyncFunction("cancel") {
      if (active) {
        active = false
        main.removeCallbacks(silenceCheck)
        recognizer?.cancel()
      }
      release()
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      // The recognizer belongs to the main thread.
      main.post {
        active = false
        main.removeCallbacks(silenceCheck)
        release()
      }
    }
  }
}
