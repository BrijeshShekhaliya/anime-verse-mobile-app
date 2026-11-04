package expo.modules.nativemedia3player

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.view.LayoutInflater
import android.view.View.MeasureSpec
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
import androidx.media3.datasource.ByteArrayDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.exoplayer.hls.HlsManifest
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
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
      30_000, // minBufferMs: Top up whenever less than 30s is ready ahead
      50_000, // maxBufferMs: Stop at 50s: rides out a bad signal without downloading video that may never be watched
      800,    // bufferForPlaybackMs: Start as soon as 0.8s is ready
      1_500   // bufferForPlaybackAfterRebufferMs: A little more after a real stall, so it doesn't stall again at once
    )
    .setBackBuffer(30_000, true) // Keep the last 30s, so skipping back is instant and costs no data
    .setTargetBufferBytes(64 * 1024 * 1024)
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
  private var volume = 1f
  private var selectedQualityHeight = -1
  private var selectedAudioTrackId: Int? = null
  private var activeAudioTrackId: Int? = null
  private var preferredAudioLanguage: String? = null
  private var selectedTextTrackId: Int? = null
  private var subtitlesEnabled = false
  private var lastTracksSignature = ""
  private var lastReadyUri: String? = null
  private var progressRunnable: Runnable? = null
  private val audioGroups = mutableListOf<Pair<TrackGroup, Int>>()
  private val textGroups = mutableListOf<Pair<TrackGroup, Int>>()
  private val videoTracks = mutableListOf<Triple<TrackGroup, Int, Int>>()
  // Language playlists, read ahead (see preloadAudioPlaylists).
  private val playlistCache = ConcurrentHashMap<String, ByteArray>()
  private var preloadedFor: String? = null
  private var networkRetries = 0
  private var retriedAtMs = 0L
  private var retryRunnable: Runnable? = null

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
                preloadAudioPlaylists(exo)
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
            if (isTemporaryNetworkError(error) && networkRetries < MAX_NETWORK_RETRIES) {
              // A lost signal isn't a broken video: try again from the same moment
              // instead of reloading the episode or changing server.
              networkRetries += 1
              retriedAtMs = exo.currentPosition
              emit("onBuffer", mapOf("buffering" to true))
              val retry = Runnable { player?.prepare() }
              retryRunnable = retry
              mainHandler.postDelayed(retry, 1_000L * networkRetries)
              return
            }
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
        exo.volume = volume
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
    // The last video's tracks mean nothing for this one.
    audioGroups.clear()
    textGroups.clear()
    videoTracks.clear()
    playlistCache.clear()
    preloadedFor = null
    networkRetries = 0
    retryRunnable?.let { mainHandler.removeCallbacks(it) }
    ensurePlayer()
    applyTrackPreferences()
    val mediaItem = MediaItem.fromUri(Uri.parse(target))
    val dataSourceFactory = DefaultHttpDataSource.Factory()
      .setUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36")
      .setAllowCrossProtocolRedirects(true)
      .setConnectTimeoutMs(15_000)
      .setReadTimeoutMs(25_000)
    referer?.let { dataSourceFactory.setDefaultRequestProperties(mapOf("Referer" to it)) }
    val cachingFactory = DataSource.Factory { PlaylistCacheDataSource(dataSourceFactory.createDataSource(), playlistCache) }
    val newSource = HlsMediaSource.Factory(cachingFactory)
      .setLoadErrorHandlingPolicy(DefaultLoadErrorHandlingPolicy(MIN_LOAD_RETRIES))
      .createMediaSource(mediaItem)
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
    playlistCache.clear()
    preloadedFor = null
    retryRunnable?.let { mainHandler.removeCallbacks(it) }
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
  fun setVolume(value: Float) {
    volume = value.coerceIn(0f, 1f)
    player?.volume = volume
  }
  fun setSelectedQualityHeight(value: Int) {
    if (selectedQualityHeight != value) {
      Log.d("AnimeVersePlayer", "setSelectedQualityHeight: $value (was $selectedQualityHeight)")
      selectedQualityHeight = value
      applyTrackPreferences()
    }
  }
  fun setSelectedAudioTrackId(value: Int?) {
    if (selectedAudioTrackId != value) {
      Log.d("AnimeVersePlayer", "setSelectedAudioTrackId: $value (was $selectedAudioTrackId)")
      selectedAudioTrackId = value
      // If already playing this track (e.g. native preferredAudioLanguage already selected it),
      // avoid re-applying preferences to prevent buffer drops.
      if (value != null && value == activeAudioTrackId) {
        return
      }
      applyTrackPreferences()
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
    builder.clearOverridesOfType(C.TRACK_TYPE_VIDEO)
    if (selectedQualityHeight < 0) {
      // Auto restores ExoPlayer's adaptive bitrate selection.
      builder.setMaxVideoSize(Int.MAX_VALUE, Int.MAX_VALUE)
      builder.setMinVideoSize(0, 0)
      builder.setMaxVideoBitrate(Int.MAX_VALUE)
      builder.setViewportSizeToPhysicalDisplaySize(context, true)
      Log.d("AnimeVersePlayer", "applyTrackPreferences: Video set to Auto (Adaptive)")
    } else {
      // Locked: only this height qualifies, so the player has nothing to adapt
      // between. Set as a rule rather than a pick of one track, it holds from the
      // first segment (no low-quality start, no re-download once tracks are known)
      // and into the next episode. If a video lacks this height, the player takes
      // the closest one below it.
      builder.setMaxVideoSize(Int.MAX_VALUE, selectedQualityHeight)
      builder.setMinVideoSize(0, selectedQualityHeight)
      builder.setMaxVideoBitrate(Int.MAX_VALUE)
      builder.clearViewportSizeConstraints()
      Log.d("AnimeVersePlayer", "applyTrackPreferences: Locked video height to $selectedQualityHeight")
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
    } else {
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
    val newParams = builder.build()
    if (trackSelector.parameters != newParams) {
      trackSelector.parameters = newParams
    }
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
    activeAudioTrackId = activeAudioId
    Log.d("AnimeVersePlayer", "publishTracks: detected ${audioOut.size} audios (active: $activeAudioId), ${videoOut.size} video variants")
    val signature = audioOut.joinToString { "${it["id"]}:${it["name"]}:${it["lang"]}" } + "|" +
                    textOut.joinToString { "${it["id"]}:${it["name"]}:${it["lang"]}" } + "|" +
                    videoOut.joinToString { "${it["height"]}x${it["width"]}" }
    if (signature != lastTracksSignature) {
      lastTracksSignature = signature
      emit("onAudioTracks", mapOf("tracks" to audioOut))
      emit("onTextTracks", mapOf("tracks" to textOut))
      emit("onVideoTracks", mapOf("levels" to videoOut))
      val wanted = selectedAudioTrackId
      if (wanted != null && wanted >= 0 && wanted != activeAudioId) applyTrackPreferences()
    }
  }

  // Changing language has to wait for that language's playlist, and this server
  // takes 0.5 to 0.8 s to send one. Reading them once playback has started (about
  // 100 KB an episode) means a change only has to fetch the audio itself.
  private fun preloadAudioPlaylists(exo: ExoPlayer) {
    val source = currentUri ?: return
    if (preloadedFor == source) return
    val manifest = exo.currentManifest as? HlsManifest ?: return
    preloadedFor = source
    val urls = manifest.multivariantPlaylist.audios.mapNotNull { it.url?.toString() }.distinct()
    if (urls.size < 2 || urls.size > MAX_PRELOADED_PLAYLISTS) return
    val from = loadedReferer
    Thread {
      for (url in urls) {
        if (preloadedFor != source) return@Thread
        val body = readPlaylist(url, from) ?: continue
        if (preloadedFor == source) playlistCache[url] = body
      }
    }.start()
  }

  private fun readPlaylist(url: String, from: String?): ByteArray? {
    var connection: HttpURLConnection? = null
    return try {
      connection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 10_000
        readTimeout = 10_000
        setRequestProperty("User-Agent", USER_AGENT)
        from?.let { setRequestProperty("Referer", it) }
      }
      if (connection.responseCode != 200 || connection.url.toString() != url) return null
      val body = connection.inputStream.use { it.readBytes() }
      val text = String(body, Charsets.UTF_8)
      // Only a finished playlist never changes, so only that is safe to keep.
      if (text.startsWith("#EXTM3U") && text.contains("#EXT-X-ENDLIST")) body else null
    } catch (e: Exception) {
      null
    } finally {
      connection?.disconnect()
    }
  }

  private fun isTemporaryNetworkError(error: PlaybackException): Boolean {
    val status = (error.cause as? HttpDataSource.InvalidResponseCodeException)?.responseCode
    return error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
      error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ||
      error.errorCode == PlaybackException.ERROR_CODE_IO_UNSPECIFIED ||
      (status != null && status >= 500)
  }

  private fun startProgressLoop() {
    val runnable = object : Runnable {
      override fun run() {
        val exo = player
        if (exo != null) {
          val duration = if (exo.duration == C.TIME_UNSET) 0.0 else exo.duration.coerceAtLeast(0) / 1000.0
          val position = exo.currentPosition.coerceAtLeast(0) / 1000.0
          // Past the trouble: forget it. (Forgetting as soon as it recovers would
          // retry a truly broken segment forever instead of changing server.)
          if (networkRetries > 0 && exo.currentPosition > retriedAtMs + RETRY_CLEAR_MS) networkRetries = 0
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

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val width = MeasureSpec.getSize(widthMeasureSpec)
    val height = MeasureSpec.getSize(heightMeasureSpec)
    setMeasuredDimension(width, height)
    playerView.measure(
      MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
    )
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    val w = right - left
    val h = bottom - top
    playerView.layout(0, 0, w, h)
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    measureAndLayoutPlayer(w, h)
  }

  // React Native doesn't pass on layout requests from inside a native view, so
  // a new fit mode or video shape would only apply at the next rotation. Do it
  // here, once per frame at most, measuring first so the video gets its new shape.
  private var layoutQueued = false

  override fun requestLayout() {
    super.requestLayout()
    if (layoutQueued) return
    layoutQueued = true
    post {
      layoutQueued = false
      measureAndLayoutPlayer(width, height)
    }
  }

  private fun measureAndLayoutPlayer(w: Int, h: Int) {
    playerView.measure(
      MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY)
    )
    playerView.layout(0, 0, w, h)
  }

  fun releasePlayer() {
    progressRunnable?.let { mainHandler.removeCallbacks(it) }
    progressRunnable = null
    retryRunnable?.let { mainHandler.removeCallbacks(it) }
    retryRunnable = null
    preloadedFor = null
    playlistCache.clear()
    playerView.player = null
    player?.release()
    player = null
  }

  private companion object {
    const val USER_AGENT = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36"
    const val MAX_NETWORK_RETRIES = 3
    const val RETRY_CLEAR_MS = 10_000L
    const val MIN_LOAD_RETRIES = 6
    const val MAX_PRELOADED_PLAYLISTS = 8
  }
}

// Answers from a playlist read ahead of time; everything else goes to the network.
@OptIn(UnstableApi::class)
private class PlaylistCacheDataSource(
  private val upstream: DataSource,
  private val cache: Map<String, ByteArray>,
) : DataSource {
  private var local: ByteArrayDataSource? = null

  override fun addTransferListener(transferListener: TransferListener) = upstream.addTransferListener(transferListener)

  override fun open(dataSpec: DataSpec): Long {
    val body = if (dataSpec.position == 0L) cache[dataSpec.uri.toString()] else null
    if (body == null) return upstream.open(dataSpec)
    return ByteArrayDataSource(body).also { local = it }.open(dataSpec)
  }

  override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
    local?.read(buffer, offset, length) ?: upstream.read(buffer, offset, length)

  override fun getUri(): Uri? = local?.uri ?: upstream.uri

  override fun getResponseHeaders(): Map<String, List<String>> = if (local != null) emptyMap() else upstream.responseHeaders

  override fun close() {
    val open = local
    if (open != null) {
      local = null
      open.close()
    } else {
      upstream.close()
    }
  }
}
