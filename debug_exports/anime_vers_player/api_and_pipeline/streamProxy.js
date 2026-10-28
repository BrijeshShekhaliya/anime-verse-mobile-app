// ── Stream Proxy Service ──────────────────────────────────────────────────────
// Proxies .m3u8 playlists, .ts segments, and subtitle files with proper Referer
// headers and CORS headers so native HTML5 / hls.js can play video ad-free.

const https = require('https');
const http = require('http');
const { assertPublicUrl } = require('./hianime');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 300, keepAliveMsecs: 60000, timeout: 15000 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 300, keepAliveMsecs: 60000, timeout: 15000 });

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
        // Rewrite URI attributes in tags like #EXT-X-KEY or #EXT-X-MEDIA
        return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${proxiedUrl(abs(u), ref)}"`);
      }
      // Line is a segment or sub-playlist URL
      return proxiedUrl(abs(t), ref);
    })
    .join('\n');
}

async function handleProxy(req, res, hops = 0) {
  const target = req.query.url;
  const ref = req.query.ref || 'https://zokoanime.video/';

  if (!target) {
    return res.status(400).send('Missing url parameter');
  }

  let targetUrl;
  try {
    targetUrl = await assertPublicUrl(target);
  } catch (err) {
    return res.status(403).send('Forbidden: ' + err.message);
  }

  const lib = targetUrl.protocol === 'https:' ? https : http;
  const headers = {
    'User-Agent': USER_AGENT,
    Referer: ref,
    Accept: '*/*',
    'Accept-Encoding': 'identity',
  };

  if (req.headers['range']) {
    headers['Range'] = req.headers['range'];
  }

  const proxyReq = lib.request(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port || undefined,
      path: targetUrl.pathname + targetUrl.search,
      method: 'GET',
      headers,
      agent: lib === https ? httpsAgent : httpAgent,
    },
    (proxyRes) => {
      const status = proxyRes.statusCode || 502;

      // Handle redirects
      if (status >= 300 && status < 400 && proxyRes.headers.location && hops < 8) {
        proxyRes.resume();
        const nextUrl = new URL(proxyRes.headers.location, target).href;
        req.query.url = nextUrl;
        return handleProxy(req, res, hops + 1);
      }

      const contentType = String(proxyRes.headers['content-type'] || '');
      const isPlaylist =
        /\.m3u8(\?|$)/i.test(targetUrl.pathname + targetUrl.search) ||
        /mpegurl/i.test(contentType);

      // CORS headers for browser player
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Accept, Origin, Content-Type');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

      if (isPlaylist && status === 200) {
        const chunks = [];
        let size = 0;
        proxyRes.on('data', (c) => {
          size += c.length;
          if (size > MAX_PLAYLIST_BYTES) {
            proxyReq.destroy();
            return;
          }
          chunks.push(c);
        });
        proxyRes.on('end', () => {
          if (size > MAX_PLAYLIST_BYTES) {
            return res.status(502).send('Playlist too large');
          }
          const text = Buffer.concat(chunks).toString('utf8');
          let output = text;
          try {
            if (text.trimStart().startsWith('#EXTM3U')) {
              output = rewritePlaylist(text, target, ref);
            }
          } catch {
            return res.status(502).send('Failed to parse playlist');
          }

          res.writeHead(200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'X-Content-Type-Options': 'nosniff',
          });
          res.end(output);
        });
        proxyRes.on('error', () => {
          if (!res.headersSent) res.status(502).send('Proxy error');
        });
        return;
      }

      // Media chunk or subtitle or direct binary stream
      const passHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Accept, Origin, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
        'X-Content-Type-Options': 'nosniff',
      };
      for (const h of [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'last-modified',
        'etag',
      ]) {
        if (proxyRes.headers[h]) passHeaders[h] = proxyRes.headers[h];
      }

      res.writeHead(status, passHeaders);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    if (!res.headersSent) res.status(502).send('Proxy connection failed: ' + err.message);
  });
  proxyReq.setTimeout(25000, () => {
    proxyReq.destroy();
  });
  res.on('close', () => {
    proxyReq.destroy();
  });
  proxyReq.end();
}

module.exports = {
  handleProxy,
};
