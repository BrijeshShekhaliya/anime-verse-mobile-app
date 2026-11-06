package expo.modules.nativemedia3player

import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import kotlin.math.abs

// The chosen height, or the nearest this video has (the higher of two equally near).
internal fun nearestHeight(heights: List<Int>, target: Int): Int {
  if (heights.isEmpty() || target in heights) return target
  return heights.minWith(compareBy<Int> { abs(it - target) }.thenByDescending { it })
}

// Locked: only this height qualifies, so the player has nothing to adapt between, however
// weak the signal. Set as a rule rather than a pick of one track, it holds from the first
// segment and into the next episode. Only Auto ever adapts. Tested against the real
// library in src/test/.../QualityLockTest.kt.
@OptIn(UnstableApi::class)
internal fun DefaultTrackSelector.Parameters.Builder.lockVideoHeight(height: Int) {
  setMaxVideoSize(Int.MAX_VALUE, height)
  setMinVideoSize(0, height)
  setMaxVideoBitrate(Int.MAX_VALUE)
  clearViewportSizeConstraints()
}

@OptIn(UnstableApi::class)
internal fun DefaultTrackSelector.Parameters.Builder.adaptVideo() {
  setMaxVideoSize(Int.MAX_VALUE, Int.MAX_VALUE)
  setMinVideoSize(0, 0)
  setMaxVideoBitrate(Int.MAX_VALUE)
}
