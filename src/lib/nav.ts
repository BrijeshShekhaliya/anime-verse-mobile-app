import { router, type Href } from 'expo-router';

// One screen change at a time. A quick double tap (or a second tap while the
// screen is still opening) used to push the same page twice or go back two
// pages, which looked like the app was stuck. Taps inside this window after a
// screen change are ignored.
const GAP = 500;
let last = 0;

function ready() {
  const now = Date.now();
  if (now - last < GAP) return false;
  last = now;
  return true;
}

export const nav = {
  push(href: Href) {
    if (ready()) router.push(href);
  },
  back() {
    if (!ready()) return;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  },
};
