package expo.modules.nativemedia3player

import android.content.Context
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.Timeline
import androidx.media3.common.TrackGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.RendererCapabilities
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.TrackGroupArray
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.upstream.DefaultBandwidthMeter
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// The lock, run through the real Media3 track selector with real quality lists. One track
// in the selection means the player has nothing to switch to, whatever the signal does.
@androidx.annotation.OptIn(UnstableApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class QualityLockTest {
  private val context: Context = ApplicationProvider.getApplicationContext()

  // Black Clover Season 2 episode 2 on the backup, as read from its playlist.
  private val blackClover = listOf(360 to 900_000, 480 to 1_500_000, 720 to 3_000_000, 1080 to 5_300_000)
  private val mainServer = listOf(240 to 150_000, 360 to 300_000, 480 to 800_000, 720 to 2_000_000, 1080 to 4_100_000)

  private fun format(height: Int, bitrate: Int): Format =
    Format.Builder()
      .setId("$height")
      .setSampleMimeType(MimeTypes.VIDEO_H264)
      .setCodecs("avc1.640028")
      .setWidth(height * 16 / 9)
      .setHeight(height)
      .setAverageBitrate(bitrate)
      .setPeakBitrate(bitrate)
      .build()

  private fun renderer(handles: (Format) -> Boolean) = object : RendererCapabilities {
    override fun getName() = "video"
    override fun getTrackType() = C.TRACK_TYPE_VIDEO
    override fun supportsFormat(format: Format): Int = RendererCapabilities.create(
      if (handles(format)) C.FORMAT_HANDLED else C.FORMAT_EXCEEDS_CAPABILITIES,
      RendererCapabilities.ADAPTIVE_SEAMLESS,
      RendererCapabilities.TUNNELING_NOT_SUPPORTED,
    )
    override fun supportsMixedMimeTypeAdaptation() = RendererCapabilities.ADAPTIVE_NOT_SUPPORTED
  }

  private fun select(
    tracks: List<Pair<Int, Int>>,
    handles: (Format) -> Boolean = { true },
    params: DefaultTrackSelector.Parameters.Builder.() -> Unit,
  ): List<Int> {
    val selector = DefaultTrackSelector(context)
    selector.init({}, DefaultBandwidthMeter.Builder(context).build())
    selector.setParameters(selector.buildUponParameters().apply(params))
    val group = TrackGroup("video", *tracks.map { format(it.first, it.second) }.toTypedArray())
    val result = selector.selectTracks(
      arrayOf(renderer(handles)),
      TrackGroupArray(group),
      MediaSource.MediaPeriodId(Any()),
      Timeline.EMPTY,
    )
    val selection = result.selections[0] ?: return emptyList()
    return (0 until selection.length()).map { selection.getFormat(it).height }
  }

  @Test
  fun `1080p chosen plays only 1080p, with nothing lower to drop to`() {
    assertEquals(listOf(1080), select(blackClover) { lockVideoHeight(1080) })
    assertEquals(listOf(1080), select(mainServer) { lockVideoHeight(1080) })
  }

  @Test
  fun `every other choice is locked the same way`() {
    for (height in listOf(360, 480, 720)) {
      assertEquals(listOf(height), select(blackClover) { lockVideoHeight(height) })
    }
    assertEquals(listOf(240), select(mainServer) { lockVideoHeight(240) })
  }

  @Test
  fun `Auto is the only one that can adapt`() {
    // As the app does it: Auto on this phone's screen, here a 1080p phone.
    val auto = select(blackClover) { adaptVideo(); setViewportSize(1080, 2400, true) }
    assertEquals(listOf(1080, 720, 480, 360), auto.sortedDescending())
  }

  // The screen limit belongs to Auto. A lock ignores it, so 1080p chosen on a smaller
  // screen is still 1080p (this test's default screen is only 320x470).
  @Test
  fun `a lock ignores the screen size, Auto does not`() {
    assertEquals(listOf(1080), select(blackClover) { setViewportSize(320, 470, true); lockVideoHeight(1080) })
    assertTrue(1080 !in select(blackClover) { adaptVideo(); setViewportSize(320, 470, true) })
  }

  @Test
  fun `going back from Auto locks again`() {
    assertEquals(listOf(1080), select(blackClover) { adaptVideo(); lockVideoHeight(1080) })
  }

  @Test
  fun `going from a lock to Auto adapts again`() {
    assertTrue(select(blackClover) { lockVideoHeight(1080); adaptVideo(); setViewportSize(1080, 2400, true) }.size > 1)
  }

  @Test
  fun `a video with one quality plays it`() {
    assertEquals(listOf(800), select(listOf(800 to 2_500_000)) { lockVideoHeight(nearestHeight(listOf(800), 1080)) })
    assertEquals(listOf(1080), select(listOf(1080 to 5_000_000)) { lockVideoHeight(nearestHeight(listOf(1080), 720)) })
  }

  @Test
  fun `a missing quality means the nearest, never far below`() {
    assertEquals(1080, nearestHeight(listOf(360, 1080), 720))
    assertEquals(720, nearestHeight(listOf(240, 360, 480, 720), 1080))
    assertEquals(480, nearestHeight(listOf(480, 720), 500))
    assertEquals(720, nearestHeight(listOf(360, 720), 720))
    assertEquals(1080, nearestHeight(emptyList(), 1080))
  }

  // Not what's wanted, but the honest limit: a phone that says it can't decode 1080p.
  @Test
  fun `a phone that cannot decode 1080p still plays something`() {
    assertEquals(listOf(720), select(blackClover, handles = { it.height <= 720 }) { lockVideoHeight(1080) })
  }
}
