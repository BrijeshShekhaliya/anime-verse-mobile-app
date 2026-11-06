// Whether the screen is in fullscreen, told straight to whoever needs it the moment it changes.
// The player's controls read this instead of waiting for the watch screen to re-render, which
// takes hundreds of milliseconds: the video turned at once, and the buttons followed late.
export type ScreenShape = {
  get: () => boolean;
  set: (fullscreen: boolean) => void;
  subscribe: (listener: () => void) => () => void;
  changedAt: () => number;
};

export function createScreenShape(initial: boolean): ScreenShape {
  let fullscreen = initial;
  let changedAt = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => fullscreen,
    set: (next) => {
      if (next === fullscreen) return;
      fullscreen = next;
      changedAt = Date.now();
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    changedAt: () => changedAt,
  };
}
