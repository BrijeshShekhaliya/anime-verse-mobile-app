// The rules of pinching the video in fullscreen. It always grows from the centre of the screen,
// wherever the fingers are. All run on the UI thread during the gesture.
export type FitMode = 'contain' | 'cover' | 'fill';

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;

export const clampZoom = (zoom: number) => {
  'worklet';
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
};

// Less than half a percent is what a resting finger does.
export const isZoomed = (zoom: number) => {
  'worklet';
  return Math.abs(zoom - 1) >= 0.005;
};

// The zoom at which a picture of this shape, fitted, exactly fills the screen. 0 if it already does.
export const fillZoom = (width: number, height: number, videoAspect = 16 / 9) => {
  'worklet';
  if (width <= 0 || height <= 0) return 0;
  const ratio = width / height / videoAspect;
  const fill = ratio > 1 ? ratio : 1 / ratio;
  return fill > 1.01 ? fill : 0;
};

export const nextFit = (mode: FitMode): FitMode => (mode === 'contain' ? 'cover' : mode === 'cover' ? 'fill' : 'contain');

// The fit button: a zoomed picture goes back to this mode's own size first. Only then does a
// tap change the mode.
export const fitTap = (mode: FitMode, zoomed: boolean): { reset: boolean; mode: FitMode } =>
  zoomed ? { reset: true, mode } : { reset: false, mode: nextFit(mode) };

// A saved zoom can't be trusted: an old or damaged value mustn't leave the picture off screen.
export const savedZoom = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.round(clampZoom(value) * 100) / 100;
};
