package expo.modules.speechinput

import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
 * same service the keyboard's mic uses). Words arrive as they are heard ("onPartial"), then once
 * more when the phrase ends ("onResult"); "onEnd" always follows, after an error too.
 */
class SpeechInputModule : Module() {
  private var recognizer: SpeechRecognizer? = null

  private fun release() {
    recognizer?.destroy()
    recognizer = null
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

    /** Starts listening (a phrase; it stops on its own after a pause). `language`: e.g. "en-IN", or "" for the phone's. */
    AsyncFunction("start") { language: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("No app context")
      release()
      val r = SpeechRecognizer.createSpeechRecognizer(context)
      recognizer = r
      r.setRecognitionListener(object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {
          // Roughly -2…10 dB: 0…1 for the mic's glow.
          sendEvent("onLevel", mapOf("level" to ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)))
        }
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onError(error: Int) {
          // Cancelled by us (a new start, or stop): nothing to report.
          if (error != SpeechRecognizer.ERROR_CLIENT) sendEvent("onError", mapOf("message" to message(error)))
          release()
          sendEvent("onEnd", mapOf<String, Any>())
        }
        override fun onResults(results: Bundle?) {
          sendEvent("onResult", mapOf("text" to firstText(results)))
          release()
          sendEvent("onEnd", mapOf<String, Any>())
        }
        override fun onPartialResults(partialResults: Bundle?) {
          val text = firstText(partialResults)
          if (text.isNotEmpty()) sendEvent("onPartial", mapOf("text" to text))
        }
        override fun onEvent(eventType: Int, params: Bundle?) {}
      })
      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
        if (language.isNotEmpty()) putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
      }
      r.startListening(intent)
    }.runOnQueue(Queues.MAIN)

    /** Stops listening; what was heard so far still arrives as the result. */
    AsyncFunction("stop") {
      recognizer?.stopListening()
    }.runOnQueue(Queues.MAIN)

    /** Stops and throws away what was heard. */
    AsyncFunction("cancel") {
      recognizer?.cancel()
      release()
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      // The recognizer belongs to the main thread.
      Handler(Looper.getMainLooper()).post { release() }
    }
  }
}
