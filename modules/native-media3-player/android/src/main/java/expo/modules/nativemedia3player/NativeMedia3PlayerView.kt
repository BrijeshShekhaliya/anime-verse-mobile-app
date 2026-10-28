package expo.modules.nativemedia3player

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackGroup
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.trackselection.TrackSelectionOverride
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher
import kotlin.math.max
import kotlin.math.roundToInt

@OptIn(UnstableApi::class)
class NativeMedia3PlayerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onLoad by EventDispatcher()
  val onProgress by EventDispatcher()
  val onBuffer by EventDispatcher()
  val onAudioTracks by EventDispatcher()
  val onTextTracks by EventDispatcher()
  val onVideoTracks by EventDispatcher()
  val onEnd by EventDispatcher()
  val onError by EventDispatcher()
  private val mainHandler = Handler(Looper.getMainLooper())
  private val trackSelector = DefaultTrackSelector(context)
  private val loadControl = DefaultLoadControl.Builder()
    .setBufferDurationsMs(60_000, 120_000, 2_500, 5_000)
    .setTargetBufferBytes(128 * 1024 * 1024)
    .setPrioritizeTimeOverSizeThresholds(true)
    .build()
  private val playerView = PlayerView(context).apply {
    useController = false
    useTextureView = true
    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    setShutterBackgroundColor(android.graphics.Color.BLACK)
  }
  private var player: ExoPlayer? = null
  private var currentUri: String? = null
  private var referer: String? = null
  private var paused = false
  private var playbackRate = 1f
  private var selectedQualityHeight = -1
  private var selectedAudioTrackId: Int? = null
  private var selectedTextTrackId: Int? = null
  private var subtitlesEnabled = true
  private var lastTracksSignature = ""
  private var lastReadyUri: String? = null
  private var progressRunnable: Runnable? = null
  private val audioGroups = mutableListOf<Pair<TrackGroup, Int>>()
  private val textGroups = mutableListOf<Pair<TrackGroup, Int>>()
  private val videoTracks = mutableListOf<Triple<TrackGroup, Int, Int>>()

  init {
    addView(playerView, ViewGroup.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    ensurePlayer()
  }

  private fun ensurePlayer() {
    if (player != null) return
    val dataSourceFactory = DefaultHttpDataSource.Factory()
      .setUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36")
      .setAllowCrossProtocolRedirects(true)
      .setConnectTimeoutMs(15_000)
      .setReadTimeoutMs(25_000)
    player = ExoPlayer.Builder(context)
      .setTrackSelector(trackSelector)
      .setLoadControl(loadControl)
      .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory))
      .build().also { exo ->
        playerView.player = exo
        exo.addListener(object : Player.Listener {
          override fun onPlaybackStateChanged(state: Int) {
            when (state) {
              Player.STATE_BUFFERING -> emit("onBuffer", mapOf("buffering" to true))
              Player.STATE_READY -> {
                emit("onBuffer", mapOf("buffering" to false))
                val duration = if (exo.duration == C.TIME_UNSET) 0.0 else exo.duration / 1000.0
                if (lastReadyUri != currentUri) {
                  lastReadyUri = currentUri
                  emit("onLoad", mapOf("duration" to duration))
                }
                publishTracks(exo.currentTracks)
              }
              Player.STATE_ENDED -> emit("onEnd", emptyMap<String, Any>())
            }
          }
          override fun onTracksChanged(tracks: Tracks) { publishTracks(tracks) }
          override fun onPlayerError(error: PlaybackException) {
            emit("onBuffer", mapOf("buffering" to false))
            emit("onError", mapOf("message" to (error.message ?: "Media3 playback failed")))
          }
        })
        exo.playWhenReady = !paused
        exo.setPlaybackSpeed(playbackRate)
      }
    startProgressLoop()
  }

  fun setUri(value: String?) {
    if (value.isNullOrBlank() || value == currentUri) return
    currentUri = value
    lastReadyUri = null
    lastTracksSignature = ""
    emit("onBuffer", mapOf("buffering" to true))
    val headers = mutableMapOf<String, String>()
    referer?.takeIf { it.isNotBlank() }?.let { headers["Referer"] = it; headers["referer"] = it }
    val item = MediaItem.Builder().setUri(Uri.parse(value)).setMimeType("application/x-mpegURL").build()
    val sourceFactory = DefaultHttpDataSource.Factory()
      .setUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36")
      .setAllowCrossProtocolRedirects(true)
      .setConnectTimeoutMs(15_000)
      .setReadTimeoutMs(25_000)
      .setDefaultRequestProperties(headers)
    val newSource = DefaultMediaSourceFactory(sourceFactory).createMediaSource(item)
    player?.setMediaSource(newSource, true)
    player?.prepare()
    player?.playWhenReady = !paused
    applyTrackPreferences()
  }

  fun setFitMode(value: String) {
    playerView.resizeMode = when (value) {
      "cover" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
      "fill" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
      else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
    }
  }

  fun setReferer(value: String?) {
    if (referer == value) return
    referer = value
    val uri = currentUri
    if (!uri.isNullOrBlank()) {
      currentUri = null
      setUri(uri)
    }
  }
  fun setPaused(value: Boolean) { paused = value; player?.playWhenReady = !value }
  fun setPlaybackRate(value: Float) {
    playbackRate = value.coerceIn(0.25f, 3f)
    player?.setPlaybackSpeed(playbackRate)
  }
  fun setSelectedQualityHeight(value: Int) { if (selectedQualityHeight != value) { selectedQualityHeight = value; applyTrackPreferences() } }
  fun setSelectedAudioTrackId(value: Int?) { if (selectedAudioTrackId != value) { selectedAudioTrackId = value; applyTrackPreferences() } }
  fun setSelectedTextTrackId(value: Int?) { if (selectedTextTrackId != value) { selectedTextTrackId = value; applyTrackPreferences() } }
  fun setSubtitlesEnabled(value: Boolean) { subtitlesEnabled = value; applyTrackPreferences() }

  fun seekToSeconds(seconds: Double) {
    if (seconds.isFinite()) player?.seekTo((max(0.0, seconds) * 1000).roundToInt().toLong())
  }

  private fun applyTrackPreferences() {
    val builder = trackSelector.buildUponParameters()
      .setMaxVideoSize(Int.MAX_VALUE, if (selectedQualityHeight < 0) Int.MAX_VALUE else selectedQualityHeight)
    val audio = selectedAudioTrackId
    if (audio == null || audio < 0) {
      builder.clearOverridesOfType(C.TRACK_TYPE_AUDIO)
    } else if (audioGroups.getOrNull(audio) != null) {
      val (group, trackIndex) = audioGroups[audio]
      builder.setOverrideForType(TrackSelectionOverride(group, listOf(trackIndex)))
    }
    val text = selectedTextTrackId
    if (!subtitlesEnabled || text == null || text < 0) {
      builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
    } else if (textGroups.getOrNull(text) != null) {
      val (group, trackIndex) = textGroups[text]
      builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
      builder.setOverrideForType(TrackSelectionOverride(group, listOf(trackIndex)))
    }
    trackSelector.setParameters(builder)
  }

  private fun publishTracks(tracks: Tracks) {
    val newAudio = mutableListOf<Pair<TrackGroup, Int>>()
    val newText = mutableListOf<Pair<TrackGroup, Int>>()
    val newVideo = mutableListOf<Triple<TrackGroup, Int, Int>>()
    val audioOut = mutableListOf<Map<String, Any>>()
    val textOut = mutableListOf<Map<String, Any>>()
    val videoOut = mutableListOf<Map<String, Any>>()
    var ai = 0; var ti = 0; var vi = 0
    tracks.groups.forEach { groupInfo ->
      val group = groupInfo.mediaTrackGroup
      for (trackIndex in 0 until group.length) {
        val format = group.getFormat(trackIndex)
        when (format.sampleMimeType?.let { androidx.media3.common.MimeTypes.getTrackType(it) } ?: C.TRACK_TYPE_UNKNOWN) {
          C.TRACK_TYPE_AUDIO -> {
            newAudio.add(group to trackIndex)
            audioOut.add(mapOf("id" to ai++, "name" to (format.label ?: format.language ?: "Audio ${ai}"), "lang" to (format.language ?: ""), "type" to "audio"))
          }
          C.TRACK_TYPE_TEXT -> {
            newText.add(group to trackIndex)
            textOut.add(mapOf("id" to ti++, "name" to (format.label ?: format.language ?: "Subtitle ${ti}"), "lang" to (format.language ?: ""), "type" to "text"))
          }
          C.TRACK_TYPE_VIDEO -> {
            newVideo.add(Triple(group, trackIndex, format.height))
            videoOut.add(mapOf("index" to vi++, "height" to format.height, "width" to format.width, "bitrate" to format.bitrate))
          }
        }
      }
    }
    audioGroups.clear(); audioGroups.addAll(newAudio)
    textGroups.clear(); textGroups.addAll(newText)
    videoTracks.clear(); videoTracks.addAll(newVideo)
    val signature = "${audioOut}| ${textOut}| ${videoOut}"
    if (signature != lastTracksSignature) {
      lastTracksSignature = signature
      emit("onAudioTracks", mapOf("tracks" to audioOut))
      emit("onTextTracks", mapOf("tracks" to textOut))
      emit("onVideoTracks", mapOf("levels" to videoOut))
    }
    applyTrackPreferences()
  }

  private fun startProgressLoop() {
    val runnable = object : Runnable {
      override fun run() {
        val exo = player
        if (exo != null) {
          val duration = if (exo.duration == C.TIME_UNSET) 0.0 else exo.duration.coerceAtLeast(0) / 1000.0
          val position = exo.currentPosition.coerceAtLeast(0) / 1000.0
          val buffered = exo.bufferedPosition.coerceAtLeast(0) / 1000.0
          emit("onProgress", mapOf("time" to position, "duration" to duration, "buffered" to buffered))
        }
        mainHandler.postDelayed(this, 400)
      }
    }
    progressRunnable = runnable
    mainHandler.post(runnable)
  }

  private fun emit(name: String, payload: Map<String, Any>) {
    when (name) {
      "onLoad" -> onLoad(payload)
      "onProgress" -> onProgress(payload)
      "onBuffer" -> onBuffer(payload)
      "onAudioTracks" -> onAudioTracks(payload)
      "onTextTracks" -> onTextTracks(payload)
      "onVideoTracks" -> onVideoTracks(payload)
      "onEnd" -> onEnd(payload)
      "onError" -> onError(payload)
    }
  }

  fun releasePlayer() {
    progressRunnable?.let { mainHandler.removeCallbacks(it) }
    progressRunnable = null
    playerView.player = null
    player?.release()
    player = null
  }
}
