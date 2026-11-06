package expo.modules.nativemedia3player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ViewEnhancementTest {
  @Test
  fun `a phone that keeps up stays on full`() {
    val governor = EnhanceGovernor()
    repeat(600) { assertFalse(governor.onFrame(12.0)) }
    assertEquals(EnhanceLevel.FULL, governor.level)
  }

  @Test
  fun `a slow phone steps down one level at a time, to colour at the lowest`() {
    val governor = EnhanceGovernor(windowFrames = 60)
    var drops = 0
    repeat(60) { if (governor.onFrame(50.0)) drops += 1 }
    assertEquals(1, drops)
    assertEquals(EnhanceLevel.LIGHT, governor.level)
    repeat(60) { governor.onFrame(50.0) }
    assertEquals(EnhanceLevel.COLOUR, governor.level)
    repeat(60) { assertFalse(governor.onFrame(50.0)) }
    assertEquals(EnhanceLevel.COLOUR, governor.level)
  }

  @Test
  fun `a few slow frames change nothing`() {
    val governor = EnhanceGovernor(windowFrames = 60)
    repeat(60) { i -> governor.onFrame(if (i % 10 == 0) 80.0 else 12.0) }
    assertEquals(EnhanceLevel.FULL, governor.level)
  }

  @Test
  fun `the lowest level is never raised by mistake`() {
    val governor = EnhanceGovernor()
    governor.lowerTo(EnhanceLevel.COLOUR)
    governor.lowerTo(EnhanceLevel.LIGHT)
    assertEquals(EnhanceLevel.COLOUR, governor.level)
  }

  @Test
  fun `shaders look further apart the more the video is enlarged`() {
    assertEquals(1f, enhanceSpread(1080, 1080), 0.001f)
    assertEquals(1.5f, enhanceSpread(1080, 720), 0.001f)
    assertEquals(2.25f, enhanceSpread(1080, 480), 0.001f)
    assertEquals(2.5f, enhanceSpread(1080, 240), 0.001f)
    // The small player in portrait shrinks 1080p: already sharp.
    assertEquals(1f, enhanceSpread(607, 1080), 0.001f)
    assertEquals(1f, enhanceSpread(0, 0), 0.001f)
  }

  @Test
  fun `softer sources are worked harder`() {
    assertEquals(0f, enhanceSoftness(1f), 0.001f)
    assertTrue(enhanceSoftness(1.5f) > 0f)
    assertEquals(1f, enhanceSoftness(2.5f), 0.001f)
  }
}
