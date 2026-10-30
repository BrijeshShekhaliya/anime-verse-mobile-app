package expo.modules.nativemedia3player

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.view.LayoutInflater
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackGroup
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.Locale
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
    .setBufferDurationsMs(
      120_000, // minBufferMs: Keep preloading until 120s (2 minutes) ahead are buffered
      300_000, // maxBufferMs: Allow up to 300s (5 minutes) forward preload buffer
      1_500,   // bufferForPlaybackMs: Require 1.5s startup buffer for smooth instant start without starvation
      2_000    // bufferForPlaybackAfterRebufferMs: Require 2.0s buffer after rebuffering
    )
    .setBackBuffer(120_000, true) // Retain 2 minutes back buffer for instant backward scrubbing
    .setTargetBufferBytes(128 * 1024 * 1024)
    .setPrioritizeTimeOverSizeThresholds(true)
    .build()
  private val playerView: PlayerView = LayoutInflater.from(context)
    .inflate(R.layout.native_media3_player_view, this, false) as PlayerView
  private var player: ExoPlayer? = null
  private var desiredUri: String? = null
  private var currentUri: String? = null
  private var loadedReferer: String? = null
  private var referer: String? = null
  private var paused = false
  private var playbackRate = 1f
  private var selectedQualityHeight = -1
  private var selectedAudioTrackId: Int? = null
  private var preferredAudioLanguage: String? = null
  private var selectedTextTrackId: Int? = null
  private var subtitlesEnabled = true
  private var lastTracksSignature = ""
  private var lastReadyUri: String? = null
  private var progressRunnable: Runnable? = null
  private val audioGroups = mutableListOf<Pair<TrackGroup, Int>>()
  private val textGroups = mutableListOf<Pair<TrackGroup, Int>>()
  private val videoTracks = mutableListOf<Triple<TrackGroup, Int, Int>>()

  init {
    playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
    playerView.setShutterBackgroundColor(android.graphics.Color.BLACK)
    addView(playerView, ViewGroup.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    applyTrackPreferences()
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
              Player.STATE_BUFFERING -> {
                Log.d("AnimeVersePlayer", "Player state: BUFFERING at ${exo.currentPosition}ms")
                emit("onBuffer", mapOf("buffering" to true))
              }
              Player.STATE_READY -> {
                Log.d("AnimeVersePlayer", "Player state: READY (buffered: ${exo.bufferedPosition}ms, playing: ${exo.isPlaying})")
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
          override fun onVideoSizeChanged(videoSize: VideoSize) {
            Log.d("AnimeVersePlayer", "Active video size changed: ${videoSize.width}x${videoSize.height}")
          }
          override fun onIsPlayingChanged(isPlaying: Boolean) { playerView.keepScreenOn = isPlaying }
          override fun onPlayerError(error: PlaybackException) {
            Log.e("AnimeVersePlayer", "Player error: ${error.message}", error)
            emit("onBuffer", mapOf("buffering" to false))
            emit("onError", mapOf("message" to (error.message ?: "Media3 playback failed")))
          }
        })
        exo.setAudioAttributes(
          AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
          true,
        )
        exo.setSeekParameters(SeekParameters.CLOSEST_SYNC)
        exo.playWhenReady = !paused
        exo.setPlaybackSpeed(playbackRate)
      }
    startProgressLoop()
  }

  fun setUri(value: String?) {
    desiredUri = value
  }

  fun loadIfNeeded() {
    val target = desiredUri
    if (target.isNullOrBlank()) {
      releaseSource()
      return
    }
    if (target == currentUri && referer == loadedReferer) return
    currentUri = target
    loadedReferer = referer
    lastReadyUri = null
    ensurePlayer()
    applyTrackPreferences()
    val mediaItem = MediaItem.fromUri(Uri.parse(target))
    val dataSourceFactory = DefaultHttpDataSource.Factory()
      .setUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36")
      .setAllowCrossProtocolRedirects(true)
      .setConnectTimeoutMs(15_000)
      .setReadTimeoutMs(25_000)
    referer?.let { dataSourceFactory.setDefaultRequestProperties(mapOf("Referer" to it)) }
    val newSource = HlsMediaSource.Factory(dataSourceFactory).createMediaSource(mediaItem)
    player?.setMediaSource(newSource, true)
    player?.prepare()
    player?.playWhenReady = !paused
  }

  private fun releaseSource() {
    currentUri = null
    loadedReferer = null
    lastReadyUri = null
    lastTracksSignature = ""
    audioGroups.clear()
    textGroups.clear()
    videoTracks.clear()
    player?.stop()
    player?.clearMediaItems()
  }

  fun setFitMode(value: String) {
    playerView.resizeMode = when (value) {
      "cover" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
      "fill" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
      else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
    }
  }

  fun setReferer(value: String?) {
    referer = value
  }
  fun setPaused(value: Boolean) { paused = value; player?.playWhenReady = !value }
  fun setPlaybackRate(value: Float) {
    playbackRate = value.coerceIn(0.25f, 3f)
    player?.setPlaybackSpeed(playbackRate)
  }
  fun setSelectedQualityHeight(value: Int) {
    if (selectedQualityHeight != value) {
      Log.d("AnimeVersePlayer", "setSelectedQualityHeight: $value (was $selectedQualityHeight)")
      selectedQualityHeight = value
      applyTrackPreferences()
      player?.let { p ->
        if (p.playbackState == Player.STATE_READY) {
          p.seekTo(p.currentPosition)
        }
      }
    }
  }
  fun setSelectedAudioTrackId(value: Int?) {
    if (selectedAudioTrackId != value) {
      Log.d("AnimeVersePlayer", "setSelectedAudioTrackId: $value (was $selectedAudioTrackId)")
      selectedAudioTrackId = value
      applyTrackPreferences()
      player?.let { p ->
        if (p.playbackState == Player.STATE_READY || p.playbackState == Player.STATE_BUFFERING) {
          p.seekTo(p.currentPosition)
        }
      }
    }
  }
  fun setPreferredAudioLanguage(value: String?) {
    val normalized = value?.trim()?.lowercase(Locale.ROOT)
    if (preferredAudioLanguage != normalized) {
      Log.d("AnimeVersePlayer", "setPreferredAudioLanguage: $normalized (was $preferredAudioLanguage)")
      preferredAudioLanguage = normalized
      applyTrackPreferences()
    }
  }
  fun setSelectedTextTrackId(value: Int?) { if (selectedTextTrackId != value) { selectedTextTrackId = value; applyTrackPreferences() } }
  fun setSubtitlesEnabled(value: Boolean) { subtitlesEnabled = value; applyTrackPreferences() }

  fun seekToSeconds(seconds: Double) {
    if (seconds.isFinite()) {
      val posMs = (max(0.0, seconds) * 1000).roundToInt().toLong()
      val p = player ?: return
      if (p.playbackState == Player.STATE_ENDED) {
        p.seekTo(posMs)
        p.prepare()
        if (!paused) p.play()
      } else {
        p.seekTo(posMs)
      }
    }
  }

  private fun applyTrackPreferences() {
    val builder = trackSelector.buildUponParameters()
    if (selectedQualityHeight < 0) {
      // Auto restores ExoPlayer's adaptive bitrate selection.
      builder.clearOverridesOfType(C.TRACK_TYPE_VIDEO)
      builder.setMaxVideoSize(Int.MAX_VALUE, Int.MAX_VALUE)
      builder.setMinVideoSize(0, 0)
      builder.setMaxVideoBitrate(Int.MAX_VALUE)
      builder.setViewportSizeToPhysicalDisplaySize(context, true)
      Log.d("AnimeVersePlayer", "applyTrackPreferences: Video set to Auto (Adaptive)")
    } else {
      // Prefer an exact rendition when the master exposes it; otherwise cap
      // adaptive selection at the requested height rather than upscaling above it.
      val exact = videoTracks.firstOrNull { it.third == selectedQualityHeight }
      if (exact != null) {
        builder.setOverrideForType(TrackSelectionOverride(exact.first, listOf(exact.second)))
        Log.d("AnimeVersePlayer", "applyTrackPreferences: Locked video to exact track index ${exact.second} (${exact.third}p)")
      } else {
        builder.clearOverridesOfType(C.TRACK_TYPE_VIDEO)
        builder.setMaxVideoSize(Int.MAX_VALUE, selectedQualityHeight)
        Log.d("AnimeVersePlayer", "applyTrackPreferences: Capped video max height to $selectedQualityHeight")
      }
    }

    // Configure preferred language so ExoPlayer picks it natively on manifest load
    val prefLang = preferredAudioLanguage?.lowercase(Locale.ROOT)
    if (!prefLang.isNullOrBlank()) {
      when {
        prefLang.contains("hin") -> {
          builder.setPreferredAudioLanguages("hin", "hi")
          builder.setPreferredAudioLabels("Hindi", "hindi")
        }
        prefLang.contains("jpn") || prefLang.contains("ja") -> {
          builder.setPreferredAudioLanguages("jpn", "ja")
          builder.setPreferredAudioLabels("Japanese", "japanese")
        }
        prefLang.contains("eng") || prefLang.contains("en") -> {
          builder.setPreferredAudioLanguages("eng", "en")
          builder.setPreferredAudioLabels("English", "english")
        }
        prefLang.contains("tel") || prefLang.contains("te") -> {
          builder.setPreferredAudioLanguages("tel", "te")
          builder.setPreferredAudioLabels("Telugu", "telugu")
        }
        prefLang.contains("tam") || prefLang.contains("ta") -> {
          builder.setPreferredAudioLanguages("tam", "ta")
          builder.setPreferredAudioLabels("Tamil", "tamil")
        }
        else -> {
          builder.setPreferredAudioLanguages(prefLang)
        }
      }
    }

    // Lock exact audio track if selected and known in current groups
    val audio = selectedAudioTrackId
    if (audio != null && audio >= 0 && audioGroups.getOrNull(audio) != null) {
      val (group, trackIndex) = audioGroups[audio]
      builder.setOverrideForType(TrackSelectionOverride(group, listOf(trackIndex)))
      Log.d("AnimeVersePlayer", "applyTrackPreferences: Locked audio to track index $trackIndex")
    } else if (audio == null || audio < 0) {
      builder.clearOverridesOfType(C.TRACK_TYPE_AUDIO)
    }

    val text = selectedTextTrackId
    if (!subtitlesEnabled || (text != null && text < 0)) {
      builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
    } else {
      builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
      if (text == null) {
        builder.clearOverridesOfType(C.TRACK_TYPE_TEXT)
      } else if (textGroups.getOrNull(text) != null) {
        val (group, trackIndex) = textGroups[text]
        builder.setOverrideForType(TrackSelectionOverride(group, listOf(trackIndex)))
      }
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
    var activeAudioId: Int? = null

    tracks.groups.forEach { groupInfo ->
      val group = groupInfo.mediaTrackGroup
      val groupType = groupInfo.type
      for (trackIndex in 0 until group.length) {
        if (!groupInfo.isTrackSupported(trackIndex)) continue
        val format = group.getFormat(trackIndex)
        val effectiveType = if (groupType != C.TRACK_TYPE_UNKNOWN) {
          groupType
        } else {
          (format.sampleMimeType ?: format.containerMimeType)
            ?.let { androidx.media3.common.MimeTypes.getTrackType(it) } ?: C.TRACK_TYPE_UNKNOWN
        }
        when (effectiveType) {
          C.TRACK_TYPE_AUDIO -> {
            newAudio.add(group to trackIndex)
            val id = ai++
            val isSelected = groupInfo.isTrackSelected(trackIndex)
            if (isSelected) {
              activeAudioId = id
            }
            val language = format.language ?: ""
            val readableLanguage = language.takeIf { it.isNotBlank() && it != "und" }
              ?.let { Locale.forLanguageTag(it).getDisplayLanguage(Locale.ENGLISH) }
            audioOut.add(
              mapOf(
                "id" to id,
                "name" to (format.label ?: readableLanguage ?: "Audio ${id + 1}"),
                "lang" to language,
                "type" to "audio",
                "selected" to isSelected
              )
            )
          }
          C.TRACK_TYPE_TEXT -> {
            newText.add(group to trackIndex)
            val id = ti++
            val isSelected = groupInfo.isTrackSelected(trackIndex)
            val language = format.language ?: ""
            val readableLanguage = language.takeIf { it.isNotBlank() && it != "und" }
              ?.let { Locale.forLanguageTag(it).getDisplayLanguage(Locale.ENGLISH) }
            textOut.add(
              mapOf(
                "id" to id,
                "name" to (format.label ?: readableLanguage ?: "Subtitle ${id + 1}"),
                "lang" to language,
                "type" to "text",
                "selected" to isSelected
              )
            )
          }
          C.TRACK_TYPE_VIDEO -> {
            if (format.height > 0) {
              newVideo.add(Triple(group, trackIndex, format.height))
              videoOut.add(
                mapOf(
                  "index" to vi++,
                  "height" to format.height,
                  "width" to format.width,
                  "bitrate" to format.bitrate,
                  "selected" to groupInfo.isTrackSelected(trackIndex)
                )
              )
            }
          }
        }
      }
    }
    audioGroups.clear(); audioGroups.addAll(newAudio)
    textGroups.clear(); textGroups.addAll(newText)
    videoTracks.clear(); videoTracks.addAll(newVideo)
    Log.d("AnimeVersePlayer", "publishTracks: detected ${audioOut.size} audios (active: $activeAudioId), ${videoOut.size} video variants")
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
          val videoFormat = exo.videoFormat
          val videoWidth = videoFormat?.width ?: 0
          val videoHeight = videoFormat?.height ?: 0
          emit(
            "onProgress",
            mapOf(
              "time" to position,
              "duration" to duration,
              "buffered" to buffered,
              "videoWidth" to videoWidth,
              "videoHeight" to videoHeight
            )
          )
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
