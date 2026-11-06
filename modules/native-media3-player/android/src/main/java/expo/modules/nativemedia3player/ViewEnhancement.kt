package expo.modules.nativemedia3player

import kotlin.math.max
import kotlin.math.min

// View Enhancement: what runs on the phone's GPU for every video frame. Not DLSS, which needs
// a game engine's motion data and NVIDIA's network, but the same family as FSR and Anime4K:
// rebuilding hard edges from the picture itself. Written for anime, which is flat colour and
// lines, and for streams, whose flat areas hold compression noise that must not be sharpened.

// What this phone can keep up with, best first.
enum class EnhanceLevel { FULL, LIGHT, COLOUR }

// How much the video is enlarged on screen decides how far apart the shaders look, and how hard
// they work: 720p on a 1080p screen has edges 1.5 pixels wider than the source drew them.
fun enhanceSpread(viewHeight: Int, videoHeight: Int): Float {
  if (viewHeight <= 0 || videoHeight <= 0) return 1f
  return min(2.5f, max(1f, viewHeight.toFloat() / videoHeight))
}

fun enhanceSoftness(spread: Float): Float = min(1f, max(0f, (spread - 1f) / 1.5f))

// Steps down when the GPU keeps missing frames: smooth video always beats a sharper picture.
class EnhanceGovernor(private val windowFrames: Int = 60, private val slowShare: Float = 0.25f) {
  var level = EnhanceLevel.FULL
    private set
  private var frames = 0
  private var slow = 0

  // True when the level just dropped.
  fun onFrame(gpuMillis: Double): Boolean {
    frames += 1
    if (gpuMillis > SLOW_FRAME_MS) slow += 1
    if (frames < windowFrames) return false
    val tooSlow = slow > windowFrames * slowShare
    frames = 0
    slow = 0
    if (!tooSlow || level == EnhanceLevel.COLOUR) return false
    level = if (level == EnhanceLevel.FULL) EnhanceLevel.LIGHT else EnhanceLevel.COLOUR
    return true
  }

  fun lowerTo(next: EnhanceLevel) {
    if (next > level) level = next
  }

  private companion object {
    const val SLOW_FRAME_MS = 33.0 // a frame of 30 fps video
  }
}

// First pass: steepens edges. Each pixel on an edge moves to the light or the dark side it's
// nearer to (a shock filter), which narrows the blur itself and so leaves no bright halo, then
// lines get a little darker. Flat areas are left alone, compression noise included.
const val ENHANCE_EDGE_SHADER = """
uniform shader content;
uniform float2 size;
uniform float strength;
uniform float spread;
uniform float soft;

half3 at(float2 p) {
  return content.eval(clamp(p, float2(0.5), size - float2(0.5))).rgb;
}
float lum(half3 c) {
  return dot(c, half3(0.299, 0.587, 0.114));
}

half4 main(float2 p) {
  half3 e = at(p);
  float2 x = float2(spread, 0.0);
  float2 y = float2(0.0, spread);
  half3 n = at(p - y);
  half3 w = at(p - x);
  half3 r = at(p + x);
  half3 s = at(p + y);
  float le = lum(e);
  float ln = lum(n);
  float lw = lum(w);
  float lr = lum(r);
  float ls = lum(s);
  float nw = lum(at(p - x - y));
  float ne = lum(at(p + x - y));
  float sw = lum(at(p - x + y));
  float se = lum(at(p + x + y));

  float hi = max(max(max(ln, lw), max(lr, ls)), max(max(nw, ne), max(sw, se)));
  float lo = min(min(min(ln, lw), min(lr, ls)), min(min(nw, ne), min(sw, se)));
  float range = max(hi, le) - min(lo, le);
  float edge = smoothstep(0.07, 0.22, range);

  // Above zero: this pixel is darker than what's around it.
  float lap = (nw + ne + sw + se + 2.0 * (ln + lw + lr + ls)) / 12.0 - le;
  float t = clamp(lap / (0.3 * range + 0.004), -1.0, 1.0);
  float amount = strength * edge * (0.5 + 0.28 * soft);
  half3 low = min(min(min(n, w), min(r, s)), e);
  half3 high = max(max(max(n, w), max(r, s)), e);
  half3 c = t > 0.0 ? mix(e, low, half(t * amount)) : mix(e, high, half(-t * amount));

  float dark = clamp(lap * 6.0, 0.0, 1.0) * edge * strength * smoothstep(0.14, 0.4, hi);
  c *= half(1.0 - 0.3 * dark);
  // A pixel already in shadow keeps its brightness: this step mustn't crush dark detail.
  c = max(c, e * half(1.0 - 0.3 * smoothstep(0.03, 0.22, le)));
  return half4(c, 1.0);
}
"""

// Second pass: fine detail, depth and colour.
//  - Sharpening limited per pixel so it can't clip or ring (AMD's Contrast Adaptive Sharpening,
//    which AMD advises over its FSR sharpener when there's no upscaler before it).
//  - Local contrast over a wider area, in the midtones: what makes a picture look deeper.
//  - A tone curve and colour that follow the picture: shadows are never pushed down, and a
//    night scene is treated differently from a bright one, with no settings to choose.
//  - A touch of noise too small to see, because more contrast would otherwise show banding.
const val ENHANCE_DETAIL_SHADER = """
uniform shader content;
uniform float2 size;
uniform float strength;
uniform float spread;
uniform float soft;
uniform float clarity;

half3 at(float2 p) {
  return content.eval(clamp(p, float2(0.5), size - float2(0.5))).rgb;
}
float lum(half3 c) {
  return dot(c, half3(0.299, 0.587, 0.114));
}

half4 main(float2 p) {
  half3 e = at(p);
  float2 x = float2(spread, 0.0);
  float2 y = float2(0.0, spread);
  half3 n = at(p - y);
  half3 w = at(p - x);
  half3 r = at(p + x);
  half3 s = at(p + y);

  half3 low = min(min(n, w), min(r, s));
  half3 high = max(max(n, w), max(r, s));
  half3 peak = max(high, e);
  half3 amp = sqrt(clamp(min(min(low, e), 1.0 - peak) / max(peak, half3(0.004)), 0.0, 1.0));

  float le = lum(e);
  float around = (lum(n) + lum(w) + lum(r) + lum(s)) * 0.25;
  float spanHi = max(max(lum(high), lum(low)), le);
  float spanLo = min(min(lum(high), lum(low)), le);
  float grain = clamp(abs(around - le) / max(spanHi - spanLo, 0.004), 0.0, 1.0);
  float busy = smoothstep(0.015, 0.07, spanHi - spanLo);
  float limit = (1.0 - 0.5 * grain) * busy * smoothstep(0.03, 0.16, spanHi) * strength * (1.1 + 0.25 * soft);
  half3 lobe = max(amp * half(-0.2 * limit), half3(-0.23));
  half3 c = (lobe * (n + w + r + s) + e) / (4.0 * lobe + 1.0);
  // Never far past the brightest neighbour, which is what a halo is, and never down into
  // the dark: in shadow a pixel keeps its value, where more sharpening only crushes detail.
  c = min(c, peak + half(0.035 * strength));
  c = max(c, e * half(1.0 - 0.35 * smoothstep(0.03, 0.24, le)));

  // How bright the whole picture is, from five points: 0 in the day, 1 at night. Everything
  // below follows it, so each scene gets its own treatment with no settings to choose.
  float scene = (lum(at(size * 0.5)) + lum(at(size * float2(0.25, 0.25))) + lum(at(size * float2(0.75, 0.25)))
    + lum(at(size * float2(0.25, 0.75))) + lum(at(size * float2(0.75, 0.75)))) * 0.2;
  float night = 1.0 - smoothstep(0.1, 0.34, scene);

  float l = lum(c);
  if (clarity > 0.0) {
    float2 diag = float2(3.0 * spread);
    float2 axis = float2(4.2 * spread, 0.0);
    float a0 = lum(at(p - diag));
    float a1 = lum(at(p + diag));
    float a2 = lum(at(p + diag * float2(1.0, -1.0)));
    float a3 = lum(at(p + diag * float2(-1.0, 1.0)));
    float a4 = lum(at(p - axis));
    float a5 = lum(at(p + axis));
    float a6 = lum(at(p - axis.yx));
    float a7 = lum(at(p + axis.yx));
    float wide = (a0 + a1 + a2 + a3 + a4 + a5 + a6 + a7) * 0.125;
    float wideHi = max(max(max(a0, a1), max(a2, a3)), max(max(a4, a5), max(a6, a7)));
    float wideLo = min(min(min(a0, a1), min(a2, a3)), min(min(a4, a5), min(a6, a7)));
    float calm = 1.0 - smoothstep(0.16, 0.42, wideHi - wideLo);
    // Less on the bright side: that's what would draw a pale fringe beside a line.
    float detail = clamp(l - wide, -0.09, 0.014);
    float gate = smoothstep(0.014, 0.045, abs(detail)) * calm;
    c += half(detail * gate * clarity * strength * (7.2 - 3.2 * night) * l * (1.0 - l));
  }

  c = clamp(c, 0.0, 1.0);
  // Tone, on brightness alone so colours keep their hue. Midtones and highlights rise, which
  // gives contrast without pushing anything down, and shadows are lifted a little, more so at
  // night. Black stays black (l is 0) and white stays white (1 - l is 0), so neither can clip.
  l = lum(c);
  float shade = 1.0 - l;
  float toned = l + strength * ((0.38 - 0.26 * night) * l * shade * (l - 0.16) + (0.08 + 0.2 * night) * l * shade * shade * shade * shade);
  c *= half(toned / max(l, 0.004));

  // Colour: a little, mostly where it's muted. Almost none in the dark, where more of it only
  // shows up as colour blotches, and less in a night scene as a whole.
  c = clamp(c, 0.0, 1.0);
  l = lum(c);
  float muted = 1.0 - (max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b));
  float colour = (0.065 + 0.26 * muted) * (1.0 - 0.6 * night) * smoothstep(0.05, 0.3, l) * strength;
  c = mix(half3(l), c, half(1.0 + colour));

  float speck = fract(52.9829189 * fract(dot(p, float2(0.06711056, 0.00583715))));
  c += half((speck - 0.5) / 255.0 * strength);
  return half4(clamp(c, 0.0, 1.0), 1.0);
}
"""
