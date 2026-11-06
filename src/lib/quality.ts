// Quality as the viewer sees it.

// The chosen height, or the nearest this video has (the higher of two equally near). The
// same rule the APK's player locks to (QualityLock.kt).
export function nearestHeight(heights: number[], target: number): number {
  if (!heights.length || heights.includes(target)) return target;
  return heights.reduce((best, h) => {
    const d = Math.abs(h - target);
    const bestD = Math.abs(best - target);
    return d < bestD || (d === bestD && h > best) ? h : best;
  });
}

// What the quality button says: what's really playing once known. Until then, what this
// video will play for the choice. A locked choice and the real quality are the same in the
// APK, unless the video or the phone can't do it, and then this says so truthfully.
export function qualityLabel(selected: number, playing: number, heights: number[]): string {
  if (selected < 0) return 'Auto';
  return `${playing > 0 ? playing : nearestHeight(heights, selected)}p`;
}

// The short name for a height. By ranges, because a wide film's "1080p" can be 800 pixels tall
// or less in its picture, and video sites differ by a few pixels. Null while it isn't known.
export function qualityBadge(height: number): '4K' | '2K' | 'FHD' | 'HD' | 'SD' | null {
  if (!(height > 0)) return null;
  if (height >= 2000) return '4K';
  if (height >= 1400) return '2K';
  if (height >= 1000) return 'FHD';
  if (height >= 700) return 'HD';
  return 'SD';
}
