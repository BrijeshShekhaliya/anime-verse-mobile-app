package expo.modules.nativemedia3player

import android.content.Context
import android.media.AudioManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NativeMedia3PlayerModule : Module() {
  private val audio: AudioManager?
    get() = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("NativeMedia3Player")

    // The phone's media volume, 0 to 1.
    Function("getSystemVolume") {
      val manager = audio ?: return@Function null
      val max = manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
      if (max > 0) manager.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / max else null
    }
    // Flags 0: no phone volume popup. The player draws its own bar.
    Function("setSystemVolume") { value: Double ->
      val manager = audio ?: return@Function
      try {
        val max = manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val level = Math.round(value.coerceIn(0.0, 1.0) * max).toInt()
        if (level != manager.getStreamVolume(AudioManager.STREAM_MUSIC)) {
          manager.setStreamVolume(AudioManager.STREAM_MUSIC, level, 0)
        }
      } catch (_: SecurityException) {
        // Do Not Disturb can refuse this; the volume simply stays as it is.
      }
    }

    View(NativeMedia3PlayerView::class) {
      Events("onLoad", "onProgress", "onBuffer", "onAudioTracks", "onTextTracks", "onVideoTracks", "onEnd", "onError", "onSystemPause")
      Prop("uri") { view: NativeMedia3PlayerView, value: String? -> view.setUri(value) }
      Prop("referer") { view: NativeMedia3PlayerView, value: String? -> view.setReferer(value) }
      Prop("paused") { view: NativeMedia3PlayerView, value: Boolean -> view.setPaused(value) }
      Prop("playbackRate") { view: NativeMedia3PlayerView, value: Double -> view.setPlaybackRate(value.toFloat()) }
      Prop("volume") { view: NativeMedia3PlayerView, value: Double -> view.setVolume(value.toFloat()) }
      Prop("fitMode") { view: NativeMedia3PlayerView, value: String -> view.setFitMode(value) }
      Prop("selectedQualityHeight") { view: NativeMedia3PlayerView, value: Int -> view.setSelectedQualityHeight(value) }
      Prop("selectedAudioTrackId") { view: NativeMedia3PlayerView, value: Int? -> view.setSelectedAudioTrackId(value) }
      Prop("preferredAudioLanguage") { view: NativeMedia3PlayerView, value: String? -> view.setPreferredAudioLanguage(value) }
      Prop("fallbackAudioLanguage") { view: NativeMedia3PlayerView, value: String? -> view.setFallbackAudioLanguage(value) }
      Prop("preload") { view: NativeMedia3PlayerView, value: List<String>? -> view.preloadNext(value) }
      Prop("enhanced") { view: NativeMedia3PlayerView, value: Boolean -> view.setEnhanced(value) }
      Prop("startTime") { view: NativeMedia3PlayerView, value: Double? -> view.setStartTime(value) }
      Prop("selectedTextTrackId") { view: NativeMedia3PlayerView, value: Int? -> view.setSelectedTextTrackId(value) }
      Prop("subtitlesEnabled") { view: NativeMedia3PlayerView, value: Boolean -> view.setSubtitlesEnabled(value) }
      OnViewDidUpdateProps { view: NativeMedia3PlayerView -> view.loadIfNeeded() }
      AsyncFunction("seek") { view: NativeMedia3PlayerView, time: Double -> view.seekToSeconds(time) }
      OnViewDestroys { view: NativeMedia3PlayerView -> view.releasePlayer() }
    }
  }
}
