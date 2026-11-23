package expo.modules.imagepaste

import android.content.ClipData
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.MimeTypeMap
import androidx.core.view.ContentInfoCompat
import androidx.core.view.ViewCompat
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID

/**
 * Lets a text field take images from the keyboard (Gboard's clipboard, stickers, GIFs) and from
 * "Paste" in its menu. React Native's text field accepts only text, so the keyboard says the app
 * "does not support image pasting". Once attached, images are copied into the app's cache (the
 * keyboard's permission to read them is short-lived) and reported to JS; text pastes as before.
 */
class ImagePasteModule : Module() {
  private val mimeTypes = arrayOf("image/*")

  override fun definition() = ModuleDefinition {
    Name("ImagePaste")

    Events("onImagePaste")

    AsyncFunction("attach") { viewTag: Int ->
      val view = appContext.findView<View>(viewTag) ?: return@AsyncFunction false
      ViewCompat.setOnReceiveContentListener(view, mimeTypes) { _, payload -> receive(payload) }
      // The keyboard reads which content types the field takes when it connects to it.
      view.post { (view.context.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as? android.view.inputmethod.InputMethodManager)?.restartInput(view) }
      true
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("detach") { viewTag: Int ->
      val view = appContext.findView<View>(viewTag) ?: return@AsyncFunction
      ViewCompat.setOnReceiveContentListener(view, null, null)
    }.runOnQueue(Queues.MAIN)
  }

  /** Takes the images out of what was pasted; anything else (text) goes on to the field. */
  private fun receive(payload: ContentInfoCompat): ContentInfoCompat? {
    val split = payload.partition { item -> item.uri != null }
    val images = split.first ?: return split.second
    val clip = images.clip
    val files = mutableListOf<Bundle>()
    for (i in 0 until clip.itemCount) {
      copy(clip, i)?.let { files.add(it) }
    }
    if (files.isNotEmpty()) sendEvent("onImagePaste", mapOf("files" to files))
    return split.second
  }

  private fun copy(clip: ClipData, index: Int): Bundle? {
    val uri: Uri = clip.getItemAt(index).uri ?: return null
    val context = appContext.reactContext ?: return null
    val resolver = context.contentResolver
    return try {
      val mime = resolver.getType(uri) ?: clip.description.takeIf { it.mimeTypeCount > 0 }?.getMimeType(0) ?: "image/png"
      if (!mime.startsWith("image/")) return null
      val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: "png"
      val dir = File(context.cacheDir, "pasted").apply { mkdirs() }
      val file = File(dir, "pasted-${UUID.randomUUID()}.$ext")
      resolver.openInputStream(uri)?.use { input -> file.outputStream().use { input.copyTo(it) } } ?: return null
      Bundle().apply {
        putString("uri", Uri.fromFile(file).toString())
        putString("name", "image.$ext")
        putString("mime", mime)
        putDouble("size", file.length().toDouble())
      }
    } catch (e: Exception) {
      null
    }
  }
}
