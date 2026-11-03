// Runs work when the app is idle (not mid-scroll or mid-animation), so saving
// to the phone never steals a frame. Falls back to a timer where unsupported.
export function whenIdle(fn: () => void, timeout = 2000) {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout });
  else setTimeout(fn, 0);
}
