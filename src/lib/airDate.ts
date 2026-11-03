// "Sat, Nov 8 · 9:30 PM" in the phone's language and time zone.
export function airDateLabel(airingAt: number | null | undefined): string {
  if (!airingAt) return 'Date to be announced';
  const d = new Date(airingAt * 1000);
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}
