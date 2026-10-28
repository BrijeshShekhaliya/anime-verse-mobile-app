package expo.modules.nativemedia3player

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NativeMedia3PlayerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NativeMedia3Player")
    View(NativeMedia3PlayerView::class) {
      Events("onLoad", "onProgress", "onBuffer", "onAudioTracks", "onTextTracks", "onVideoTracks", "onEnd", "onError")
      Prop("uri") { view: NativeMedia3PlayerView, value: String? -> view.setUri(value) }
      Prop("referer") { view: NativeMedia3PlayerView, value: String? -> view.setReferer(value) }
      Prop("paused") { view: NativeMedia3PlayerView, value: Boolean -> view.setPaused(value) }
      Prop("playbackRate") { view: NativeMedia3PlayerView, value: Double -> view.setPlaybackRate(value.toFloat()) }
      Prop("fitMode") { view: NativeMedia3PlayerView, value: String -> view.setFitMode(value) }
      Prop("selectedQualityHeight") { view: NativeMedia3PlayerView, value: Int -> view.setSelectedQualityHeight(value) }
      Prop("selectedAudioTrackId") { view: NativeMedia3PlayerView, value: Int? -> view.setSelectedAudioTrackId(value) }
      Prop("selectedTextTrackId") { view: NativeMedia3PlayerView, value: Int? -> view.setSelectedTextTrackId(value) }
      Prop("subtitlesEnabled") { view: NativeMedia3PlayerView, value: Boolean -> view.setSubtitlesEnabled(value) }
      AsyncFunction("seek") { view: NativeMedia3PlayerView, time: Double -> view.seekToSeconds(time) }
      OnViewDestroys { view: NativeMedia3PlayerView -> view.releasePlayer() }
    }
  }
}
