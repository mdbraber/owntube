package expo.modules.playerstats

import android.view.View
import android.view.ViewGroup
import androidx.media3.common.Format
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reports the video rendition that is actually playing.
 *
 * expo-video 2.0 doesn't tell JS which track ExoPlayer's adaptive selection
 * picked, so "Auto" can't say what it is playing. This reads the format off
 * the player behind each media3 PlayerView in the activity.
 */
class PlayerStatsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PlayerStats")

    AsyncFunction("getVideoFormat") {
      val root = appContext.currentActivity?.window?.decorView
        ?: return@AsyncFunction null
      val players = mutableListOf<Player>()
      forEachPlayerView(root) { view -> view.player?.let { players.add(it) } }
      // Prefer the player that is playing (Up next can mount a second view).
      val ordered = players.sortedByDescending { it.isPlaying }
      for (player in ordered) {
        val format = (player as? ExoPlayer)?.videoFormat
        if (format != null && format.height > 0) return@AsyncFunction describe(format)
        val size = player.videoSize
        if (size.height > 0) {
          return@AsyncFunction mapOf("width" to size.width, "height" to size.height)
        }
      }
      null
    }.runOnQueue(Queues.MAIN)
  }

  private fun describe(format: Format): Map<String, Any> {
    val out = mutableMapOf<String, Any>("width" to format.width, "height" to format.height)
    if (format.bitrate != Format.NO_VALUE) out["bitrate"] = format.bitrate
    format.codecs?.let { out["codecs"] = it }
    if (format.frameRate != Format.NO_VALUE.toFloat()) out["frameRate"] = format.frameRate
    return out
  }

  private fun forEachPlayerView(view: View, action: (PlayerView) -> Unit) {
    if (view is PlayerView) action(view)
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) forEachPlayerView(view.getChildAt(i), action)
    }
  }
}
