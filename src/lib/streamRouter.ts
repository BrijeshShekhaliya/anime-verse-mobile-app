// Chooses the server for an episode. The one place that decides this.
//
//  - Each episode is decided on its own: what happened on episode 3 never pins
//    episode 4 to a server, and the viewer's language preference is left alone.
//  - The main server (every language) is asked first. If it hasn't answered after
//    a moment the backup starts too, without cancelling the main server, so a slow
//    server never makes anyone wait for long and a quick one costs nothing extra.
//  - A clear "no" is believed at once: no retries for an episode that isn't there
//    or a request the server refused. Only a lost connection gets one more try.
//  - When the main server keeps failing, it is left alone for a while (longer each
//    time) and viewers go straight to the backup with no wait. One lookup tests it
//    when the time is up. This is remembered across app restarts.
import type { StreamData } from './types';

let AsyncStorage: any = null;
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch {
  // Not available in tests
}

const HEALTH_KEY = 'animeverse:main-server-health';
const HEDGE_MS = 1200; // main server's head start before the backup starts too
const MAIN_WAIT_MS = 5000; // the longest anyone waits for the main server
const FAILURES_TO_REST = 2;
const FIRST_REST_MS = 2 * 60 * 1000;
const LONGEST_REST_MS = 15 * 60 * 1000;
const FORGET_AFTER_MS = 60 * 60 * 1000;

export type StreamFailure = 'missing' | 'refused' | 'connection';

export const isMainStream = (s?: Pick<StreamData, 'source'> | null) => !!s?.source?.toLowerCase().includes('multi');

// An error says what kind of failure it was; anything unlabelled counts as a lost connection.
export const failureKind = (e: unknown): StreamFailure => (e as { kind?: StreamFailure } | null)?.kind ?? 'connection';

const health = { failures: 0, rests: 0, restUntil: 0, testing: false, lastError: null as string | null };

// What's worth keeping from a saved state. A rest that ended long ago says nothing about
// today (the app reopened a day or two later starts clean), and bad data counts as none.
export function restoredHealth(saved: unknown, now = Date.now()) {
  const s = (saved && typeof saved === 'object' ? saved : {}) as { rests?: unknown; restUntil?: unknown; lastError?: unknown };
  const restUntil = typeof s.restUntil === 'number' && Number.isFinite(s.restUntil) ? s.restUntil : 0;
  if (restUntil < now - FORGET_AFTER_MS || restUntil > now + LONGEST_REST_MS) return { rests: 0, restUntil: 0, lastError: null };
  return { rests: typeof s.rests === 'number' ? s.rests : 0, restUntil, lastError: typeof s.lastError === 'string' ? s.lastError : null };
}

if (AsyncStorage) {
  AsyncStorage.getItem(HEALTH_KEY)
    .then((raw: string | null) => {
      if (!raw) return;
      Object.assign(health, restoredHealth(JSON.parse(raw)));
    })
    .catch(() => {});
}
const saveHealth = () =>
  AsyncStorage?.setItem(HEALTH_KEY, JSON.stringify({ rests: health.rests, restUntil: health.restUntil, lastError: health.lastError })).catch(() => {});

// May the main server be asked right now? After a rest, one lookup at a time tests it.
export function canAskMain(now = Date.now()): boolean {
  if (now >= health.restUntil) return health.restUntil === 0 || !health.testing;
  return false;
}

export function mainServerStatus(now = Date.now()) {
  return { resting: now < health.restUntil, lastError: health.lastError };
}

function noteMainAnswered() {
  const hadTrouble = health.failures > 0 || health.rests > 0 || health.restUntil > 0 || health.lastError;
  health.failures = 0;
  health.rests = 0;
  health.restUntil = 0;
  health.testing = false;
  health.lastError = null;
  if (hadTrouble) saveHealth();
}

function noteMainFailed(e: unknown, now = Date.now()) {
  // "This episode isn't on this server" says nothing about the server's health.
  const kind = failureKind(e);
  health.testing = false;
  if (kind === 'missing') return;
  health.lastError = e instanceof Error ? e.message : String(e);
  health.failures += 1;
  const wasTesting = health.restUntil > 0;
  if (wasTesting || health.failures >= FAILURES_TO_REST) {
    health.restUntil = now + Math.min(FIRST_REST_MS * 2 ** health.rests, LONGEST_REST_MS);
    health.rests += 1;
    health.failures = 0;
    console.log(`[Stream] main server rests for ${Math.round((health.restUntil - now) / 60000)} min: ${health.lastError}`);
  }
  saveHealth();
}

// Asks the main server, keeping its health up to date. Everything goes through here.
export function askMain(run: () => Promise<StreamData>): Promise<StreamData> {
  if (health.restUntil > 0) health.testing = true;
  return run().then(
    (stream) => {
      if (stream?.streamUrl) noteMainAnswered();
      return stream;
    },
    (e) => {
      noteMainFailed(e);
      throw e;
    },
  );
}

export function resetMainServerHealth() {
  Object.assign(health, { failures: 0, rests: 0, restUntil: 0, testing: false, lastError: null });
}

// A viewer started on the backup because the main server was slow: its answer may
// still arrive, and costs no new request to wait for.
const lateMain = new WeakMap<object, Promise<StreamData | null>>();
export const lateMainFor = (stream: StreamData) => lateMain.get(stream);

export async function pickServer(servers: { main: () => Promise<StreamData>; backup: () => Promise<StreamData> }): Promise<StreamData> {
  let backupRun: Promise<StreamData | null> | null = null;
  const startBackup = () => (backupRun ??= servers.backup().catch(() => null));

  if (!canAskMain()) {
    const backup = await startBackup();
    if (backup?.streamUrl) return backup;
    // The backup can't help: the resting main server is the last chance.
    return servers.main();
  }

  const main = askMain(servers.main).catch(() => null);
  const hedge = setTimeout(startBackup, HEDGE_MS);
  let waited: ReturnType<typeof setTimeout> | undefined;
  const first = await Promise.race([main, new Promise<null>((r) => (waited = setTimeout(() => r(null), MAIN_WAIT_MS)))]);
  clearTimeout(hedge);
  clearTimeout(waited);
  if (first?.streamUrl) return first;

  const backup = await startBackup();
  if (backup?.streamUrl) {
    lateMain.set(backup, main);
    return backup;
  }
  // Neither has answered: the main server may still be on its way.
  const late = await main;
  if (late?.streamUrl) return late;
  throw new Error('This episode is not available right now');
}
