# Required Source Code: Birvana / AnimeVerse Mobile & Working Website Reference

## 1. Mobile Application: `animeverse-app`

### File: `src/app/watch/[id].tsx`

#### Fullscreen State, Dimensions, and Orientation Lifecycle
```tsx
// Location: src/app/watch/[id].tsx (Lines 75-185)
const insets = useSafeAreaInsets();
const { width, height } = useWindowDimensions();

// Authoritative fullscreen state
const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

// Live container layout measurements (avoids pre-rotation Dimensions stale reads)
const [layoutDimensions, setLayoutDimensions] = useState<{ width: number; height: number }>({
  width: width,
  height: height,
});

const onRootLayout = useCallback((e: LayoutChangeEvent) => {
  const { width: w, height: h } = e.nativeEvent.layout;
  if (w > 0 && h > 0) {
    setLayoutDimensions({ width: Math.round(w), height: Math.round(h) });
  }
}, []);

const activeWidth = layoutDimensions.width || width;
const activeHeight = layoutDimensions.height || height;
const isPhysicalLandscape = activeWidth > activeHeight;
const isFullscreenView = isFullscreen || isPhysicalLandscape;

// Integrated Orientation Control (immediate non-blocking request)
const enterLandscape = useCallback(() => {
  ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
}, []);

const restoreOrientation = useCallback(() => {
  ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
    .catch(() => {})
    .then(() => ScreenOrientation.unlockAsync().catch(() => {}));
}, []);

const enterFullscreen = useCallback(() => {
  setIsFullscreen(true);
  RNStatusBar.setHidden(true, 'none');
  enterLandscape();
}, [enterLandscape]);

const exitFullscreen = useCallback(() => {
  setIsFullscreen(false);
  RNStatusBar.setHidden(false, 'none');
  restoreOrientation();
}, [restoreOrientation]);

const toggleFullscreen = useCallback(() => {
  if (isFullscreenView) {
    exitFullscreen();
  } else {
    enterFullscreen();
  }
}, [isFullscreenView, enterFullscreen, exitFullscreen]);

// Listen to physical device orientation changes
useEffect(() => {
  const sub = ScreenOrientation.addOrientationChangeListener((evt) => {
    const orientation = evt.orientationInfo.orientation;
    const isLand =
      orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
      orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;
    if (isLand && !isFullscreen) {
      setIsFullscreen(true);
      RNStatusBar.setHidden(true, 'none');
    } else if (!isLand && isFullscreen) {
      setIsFullscreen(false);
      RNStatusBar.setHidden(false, 'none');
    }
  });
  return () => {
    ScreenOrientation.removeOrientationChangeListener(sub);
  };
}, [isFullscreen]);

// Handle hardware Android back button / back swipe
useEffect(() => {
  const onBackPress = () => {
    if (settingsOpen) {
      setSettingsOpen(false);
      return true;
    }
    if (allEpisodesOpen) {
      setAllEpisodesOpen(false);
      return true;
    }
    if (isFullscreenView) {
      // Exit fullscreen to portrait instead of navigating away!
      exitFullscreen();
      return true;
    }
    return false; // In portrait, let default router back handle it
  };

  const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
  return () => sub.remove();
}, [isFullscreenView, settingsOpen, allEpisodesOpen, exitFullscreen]);
```

#### Persistent WebView and Overlays Rendering
```tsx
// Location: src/app/watch/[id].tsx (Lines 880-960)
<View
  style={[styles.container, isFullscreenView ? styles.containerFullscreen : { paddingTop: insets.top }]}
  onLayout={onRootLayout}
>
  <StatusBar hidden={isFullscreenView} style="light" />

  {/* Video Player Container */}
  <View
    style={[
      styles.playerContainer,
      isFullscreenView
        ? styles.playerContainerLandscape
        : [styles.playerContainerPortrait, { height: Math.floor((activeWidth * 9) / 16) }],
    ]}
    onLayout={(e) => {
      progressBarWidthRef.current = e.nativeEvent.layout.width;
    }}
    onTouchStart={handleTouchStart}
    onTouchMove={handleTouchMove}
    onTouchEnd={handleTouchEnd}
  >
    {/* Stream View: Persistent Native WebView (Never Unmounted) */}
    <MobileWebView
      ref={webViewRef}
      source={server === 'vidrift' ? { uri: vidriftEmbedUrl } : { html: hianimeHtml }}
      style={styles.webView}
      containerStyle={{ backgroundColor: '#000000' }}
      javaScriptEnabled={true}
      domStorageEnabled={true}
      allowsFullscreenVideo={true}
      allowsInlineMediaPlayback={true}
      mediaPlaybackRequiresUserAction={false}
      setSupportMultipleWindows={true}
      originWhitelist={['*']}
      injectedJavaScriptBeforeContentLoaded={injectedCode}
      onMessage={handleWebViewMessage}
      startInLoadingState={false}
      renderToHardwareTextureAndroid={true}
      overScrollMode="never"
      scrollEnabled={false}
      scalesPageToFit={false}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    />

    {/* Non-destructive Overlays */}
    {server === 'hianime' && resolvingHls && (
      <View style={[StyleSheet.absoluteFill, styles.playerPlaceholder]} pointerEvents="none">
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.placeholderText}>Connecting to HiAnime Stream...</Text>
      </View>
    )}
```

#### Injected HTML, JavaScript, and Hls.js Configuration
```javascript
// Location: src/app/watch/[id].tsx (Inside hianimeHtml useMemo, Lines 600-750)
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; }
    html, body {
      width: 100vw; height: 100vh; margin: 0; padding: 0; background-color: #000000;
      overflow: hidden; display: flex; align-items: center; justify-content: center;
    }
    #player {
      width: 100%; height: 100%; background-color: #000000;
      transform: translateZ(0); backface-visibility: hidden; -webkit-backface-visibility: hidden;
      transition: object-fit 0.2s ease;
    }
    #player.contain { object-fit: contain !important; }
    #player.cover { object-fit: cover !important; }
    #player.fill { object-fit: fill !important; }
    ::cue, video::cue {
      background: transparent !important; color: #ffffff !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      font-weight: 700 !important; font-size: 1.18rem !important; line-height: 1.35 !important;
      text-shadow: 2px 2px 3px rgba(0,0,0,0.95), -2px -2px 3px rgba(0,0,0,0.95);
    }
  </style>
</head>
<body>
  <video id="player" class="contain" crossorigin="anonymous" playsinline autoplay preload="auto">
    ${subTracks}
  </video>
  <script>
    const video = document.getElementById('player');
    const streamSrc = "${proxiedUrl}";
    const epToken = "${currentSeason}:${currentEp}";

    function post(type, payload) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ type: type, epToken: epToken }, payload || {})));
      }
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        autoStartLoad: true,
        enableWorker: true,
        startFragPrefetch: true,
        lowLatencyMode: false,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        backBufferLength: 60,
        maxBufferSize: 60 * 1024 * 1024,
        manifestLoadingTimeOut: 20000,
        levelLoadingTimeOut: 20000,
        fragLoadingTimeOut: 25000,
      });
      window._hls = hls;
      hls.loadSource(streamSrc);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, function(event, data) {
        if (data.levels && data.levels.length > 0) {
          hls.currentLevel = data.levels.length - 1; // CAUSE OF BUFFERING: forces 1080p, disables ABR!
          var levels = data.levels.map(function(l, idx) {
            return { index: idx, height: l.height, width: l.width, bitrate: l.bitrate };
          });
          post('levels', { levels: levels });
        }
        video.play().catch(function(){});
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function(event, data) {
        if (data.audioTracks && data.audioTracks.length > 0) {
          var tracks = data.audioTracks.map(function(t, idx) {
            return { id: idx, name: t.name || t.lang, lang: t.lang };
          });
          post('audioTracks', { audioTracks: tracks, currentTrack: hls.audioTrack });
        }
      });

      hls.on(Hls.Events.ERROR, function(event, data) {
        if (data.fatal) {
          post('error', { details: data.details });
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamSrc;
      video.play().catch(function(){});
    }
    // ... event listeners for timeupdate, durationchange, buffered, play, pause, ended, buffering
  </script>
</body>
</html>
```

#### Relevant Styles
```tsx
// Location: src/app/watch/[id].tsx (Lines 1630-1790)
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  containerFullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
    zIndex: 9999,
  },
  playerContainer: {
    backgroundColor: '#000',
    overflow: 'hidden',
    position: 'relative',
  },
  playerContainerPortrait: {
    width: '100%',
  },
  playerContainerLandscape: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    zIndex: 9999,
    backgroundColor: '#000',
  },
  webView: {
    flex: 1,
    backgroundColor: '#000000',
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    justifyContent: 'space-between',
    zIndex: 20,
  },
  playerTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 24,
  },
  playerBottomBar: {
    paddingHorizontal: 14,
    paddingTop: 24,
    paddingBottom: 6,
  },
});
```

---

## 2. Mobile API Client: `src/lib/api.ts`

```typescript
// Location: src/lib/api.ts (Lines 4-15, 105-114)
export const BASE: string =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  'https://13.236.161.33.sslip.io';

export const toFullUrl = (url: string) => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${BASE}${url.startsWith('/') ? '' : '/'}${url}`;
};

export const api = {
  // ...
  resolveStream: (params: { title: string; romaji?: string; season: number; episode: number; mode?: 'sub' | 'dub' }) => {
    const qs = new URLSearchParams({
      title: params.title,
      season: String(params.season),
      episode: String(params.episode),
      mode: params.mode || 'sub',
    });
    if (params.romaji) qs.set('romaji', params.romaji);
    return get<StreamData>(`/stream/resolve?${qs.toString()}`, 30 * 60 * 1000);
  },
};
```

---

## 3. Working Website Reference: `stream-aggregator/public/app.js`

```javascript
// Location: stream-aggregator/public/app.js (Lines 60, 1266-1335, 1435-1445)
const API_BASE = '';

// HLS.js Initialization on Website (Auto-ABR preserved, resume preserved)
if (window.Hls && Hls.isSupported()) {
  if (activeHls) {
    try { activeHls.destroy(); } catch {}
    activeHls = null;
  }
  const hls = new Hls({
    autoStartLoad: true,
    enableWorker: true,
    startPosition: targetResumeSec > 1.5 ? targetResumeSec : -1,
    startFragPrefetch: true,
    progressive: false,
    lowLatencyMode: false,
    maxBufferLength: 60,
    maxMaxBufferLength: 120,
    backBufferLength: 60,
    maxBufferSize: 60 * 1024 * 1024,
    manifestLoadingTimeOut: 20000,
    levelLoadingTimeOut: 20000,
    fragLoadingTimeOut: 25000,
  });

  activeHls = hls;
  hls.loadSource(finalStreamUrl);
  hls.attachMedia(video);

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    if (thisGen !== currentResolveGen) return;
    applyResume();
    hideLoader();
    video.play().catch(() => {});
  });

  hls.on(Hls.Events.ERROR, (evt, errData) => {
    if (errData.fatal) {
      switch (errData.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          hls.startLoad();
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          hls.recoverMediaError();
          break;
        default:
          hls.destroy();
          break;
      }
    }
  });
}

// Audio Language Switching on Website (Re-resolves separate SUB vs DUB streams with position memory):
function onSelectAudioLang(lang) {
  if (lang === currentLang) return;
  const currentPos = (activeVideo && activeVideo.currentTime > 1) ? activeVideo.currentTime : null;
  currentLang = lang;
  try {
    localStorage.setItem('animeverse_lang', currentLang);
  } catch {}
  loadStream(currentPos);
}
```

---

## 4. Backend Stream Proxy: `stream-aggregator/src/services/streamProxy.js`

```javascript
// Location: stream-aggregator/src/services/streamProxy.js (Lines 16-35, 110-142)
function proxiedUrl(targetUrl, ref) {
  return `/api/stream/proxy?url=${encodeURIComponent(targetUrl)}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`;
}

function rewritePlaylist(text, playlistUrl, ref) {
  const abs = (u) => new URL(u, playlistUrl).href;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${proxiedUrl(abs(u), ref)}"`);
      }
      return proxiedUrl(abs(t), ref);
    })
    .join('\n');
}

// Media chunks and playlist passing
res.writeHead(status, {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Accept, Origin, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
  'X-Content-Type-Options': 'nosniff',
});
proxyRes.pipe(res);
```

---

## 5. Backend Route & Provider: `stream-aggregator/src/routes/anime.js` & `hianime.js`

```javascript
// Location: stream-aggregator/src/routes/anime.js (Lines 243-265)
router.get(
  '/stream/resolve',
  handle(async (req) => {
    const title = (req.query.title || '').trim();
    const romaji = (req.query.romaji || '').trim();
    const season = Math.max(1, parseInt(req.query.season, 10) || 1);
    const episode = Math.max(1, parseInt(req.query.episode, 10) || 1);
    const mode = req.query.mode === 'dub' ? 'dub' : 'sub';

    const cacheKey = `stream:${title}:${season}:${episode}:${mode}`;
    return cache.getOrSet(cacheKey, 60 * 60, async () => {
      const resolved = await hianime.resolveStream({ title, romaji, season, episode, mode });
      const ref = resolved.referer || 'https://zokoanime.video/';
      const proxiedMaster = `/api/stream/proxy?url=${encodeURIComponent(resolved.masterUrl)}&ref=${encodeURIComponent(ref)}`;
      const proxiedSubs = (resolved.subtitles || []).map((s) => ({
        ...s,
        src: `/api/stream/proxy?url=${encodeURIComponent(s.src)}&ref=${encodeURIComponent(ref)}`,
      }));

      return {
        success: true,
        source: 'HiAnime (Native)',
        mode: resolved.mode,
        seasonNumber: resolved.seasonNumber,
        episodeNumber: resolved.episodeNumber,
        streamUrl: proxiedMaster,
        rawMasterUrl: resolved.masterUrl,
        referer: ref,
        subtitles: proxiedSubs,
      };
    });
  })
);
```
