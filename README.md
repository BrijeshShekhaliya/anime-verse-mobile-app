# AnimeVerse mobile app

React Native (Expo SDK 58, Expo Router) companion to the AnimeVerse website: same backend, same design, built for phones.

There's no video player. **Watch** buttons open the official platform (Crunchyroll, Netflix, …), and **Continue Watching** tracks which episode you're on so you can pick up there.

## Run it

```bash
npm install
npx expo start
```

Scan the QR code with **Expo Go** (Android / iOS), or press `w` for a browser preview.

The app uses the same API as the website (`extra.apiUrl` in `app.json`). To point it at your local server instead:

```bash
EXPO_PUBLIC_API_URL=http://<your-computer-ip>:3000 npx expo start
```

Use your computer's LAN IP, not `localhost`, when testing on a phone.

## Screens

| Tab / screen | What it does |
|---|---|
| **Home** | Swipeable spotlight (auto-advances, parallax, official title logos), Continue Watching, Top 10, This Season, Dubbed, Top Rated, Popular, Next Season, Movies. Pull to refresh. |
| **Browse** | Sort, status, format, English-dub and genre chips; 3-column grid with infinite scroll. "View all" links from Home open it pre-filtered. |
| **Schedule** | This week's episodes in local time, sliding day picker, live countdowns, a "Now" marker. |
| **My List** | Continue Watching, saved titles, and viewing history (remove items or clear). |
| **Anime page** | Backdrop with parallax, series facts (seasons, episodes, status, age rating), Watch on…, Trailer, My List, progress tracker, ratings, available languages, related titles, fan stats, cast, recommendations. |
| **Search** | Search as you type, highlighted matches, recent searches, trending suggestions. |

## On-device data

History, My List, episode progress and recent searches are stored on the phone with AsyncStorage (`src/lib/library.tsx`). Nothing is sent anywhere.

## Code map

```
src/app/            screens (Expo Router)
  (tabs)/           Home, Browse, Schedule, My List + custom tab bar
  anime/[id].tsx    anime page
  search.tsx        search
src/components/     cards, rows, hero, icons, skeletons, buttons
src/lib/            API client, theme, formatting, on-device library
```

## Checks

```bash
npx tsc --noEmit
npx expo lint
```
