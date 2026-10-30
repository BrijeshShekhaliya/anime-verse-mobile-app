// "Open Browse with the search box ready": the Home search button raises a
// flag; Browse focuses its input as soon as it becomes the active screen.
// Works the same whether Browse is already mounted or opening for the first time.
let pending = false;
const listeners = new Set<() => void>();

export function requestSearchFocus() {
  pending = true;
  listeners.forEach((l) => l());
}

// Returns true once per request, so the keyboard isn't reopened on every visit.
export function takeSearchFocus() {
  const was = pending;
  pending = false;
  return was;
}

// True while a request is waiting (without using it up).
export const searchFocusPending = () => pending;

export function onSearchFocusRequest(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
