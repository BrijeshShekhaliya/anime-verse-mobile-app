/* AnimeVerse — single-page anime discovery app (no build step). */
(() => {
  'use strict';

  const app = document.getElementById('app');
  const nav = document.getElementById('nav');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmtNum = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
  // Custom icon set: soft filled shapes with a duotone accent layer (class "ic").
  const svg = (body, cls = '') => `<svg class="ic${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  const tint = 'fill="currentColor" stroke="none" opacity=".2"';
  const solid = 'fill="currentColor" stroke="none"';
  const icon = {
    star: svg(`<path ${solid} d="M12 2.8c.4 0 .7.2.9.6l2.3 4.7 5.1.8c.8.1 1.1 1.1.5 1.7l-3.7 3.6.9 5.1c.1.8-.7 1.4-1.4 1l-4.6-2.4-4.6 2.4c-.7.4-1.6-.2-1.4-1l.9-5.1-3.7-3.6c-.6-.6-.3-1.6.5-1.7l5.1-.8 2.3-4.7c.2-.4.5-.6.9-.6z"/>`),
    play: svg(`<path ${solid} d="M8 5.6v12.8c0 .9 1 1.5 1.8 1l10-6.4c.7-.5.7-1.5 0-2l-10-6.4C9 4.1 8 4.7 8 5.6z"/>`),
    info: svg(`<rect ${tint} x="3" y="3" width="18" height="18" rx="6"/><rect x="3" y="3" width="18" height="18" rx="6"/><path d="M12 11.5v5"/><circle ${solid} cx="12" cy="7.8" r="1.3"/>`),
    left: svg('<path d="M14.5 6.5L9 12l5.5 5.5" stroke-width="2.6"/>'),
    right: svg('<path d="M9.5 6.5L15 12l-5.5 5.5" stroke-width="2.6"/>'),
    chevron: svg('<path d="M7 10l5 4.5 5-4.5" stroke-width="2.4"/>', 'cs-chev'),
    ext: svg(`<rect ${tint} x="3.5" y="6.5" width="14" height="14" rx="4"/><path d="M13 3.5h7.5V11M20.5 3.5L11 13"/><path d="M17.5 14v2.5a4 4 0 01-4 4h-6a4 4 0 01-4-4v-6a4 4 0 014-4H10"/>`),
    check: svg('<path d="M5 12.5l4.2 4.2L19 7" stroke-width="2.8"/>'),
    mic: svg(`<rect ${tint} x="8" y="2.5" width="8" height="12.5" rx="4"/><rect x="8" y="2.5" width="8" height="12.5" rx="4"/><path d="M4.5 11.5a7.5 7.5 0 0015 0M12 19v2.5"/>`),
    cc: svg(`<rect ${tint} x="2.5" y="4.5" width="19" height="15" rx="5"/><rect x="2.5" y="4.5" width="19" height="15" rx="5"/><path d="M10.5 10.2a2.2 2.2 0 100 3.6M16.5 10.2a2.2 2.2 0 100 3.6"/>`),
    clock: svg(`<circle ${tint} cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="9.5"/><path d="M12 7v5.2l3.2 2"/>`),
    x: svg('<path d="M7 7l10 10M17 7L7 17" stroke-width="2.4"/>'),
    search: svg(`<circle ${tint} cx="10.5" cy="10.5" r="7"/><circle cx="10.5" cy="10.5" r="7"/><path d="M16 16l4.5 4.5" stroke-width="2.8"/>`),
    globe: svg(`<circle ${tint} cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.6 2.8 3.8 6 3.8 9.5s-1.2 6.7-3.8 9.5c-2.6-2.8-3.8-6-3.8-9.5s1.2-6.7 3.8-9.5z"/>`),
    spark: svg(`<path ${solid} d="M12 2l2.2 6.3L20.5 10.5l-6.3 2.2L12 19l-2.2-6.3L3.5 10.5l6.3-2.2z"/>`),
    shield: svg(`<path ${tint} d="M12 2.8l7.5 3v5.6c0 4.6-3.1 8.4-7.5 9.8-4.4-1.4-7.5-5.2-7.5-9.8V5.8z"/><path d="M12 2.8l7.5 3v5.6c0 4.6-3.1 8.4-7.5 9.8-4.4-1.4-7.5-5.2-7.5-9.8V5.8z"/>`),
  };

  // Detect season number from anime title or romaji (e.g. "Season 2", "2nd Season", "Part 3")
  function detectSeasonNumber(title, romaji = '') {
    const combined = `${title || ''} ${romaji || ''}`;
    const m1 = combined.match(/\b(?:Season|Part|Cour)\s*(\d+)\b/i);
    if (m1) return parseInt(m1[1], 10);
    const m2 = combined.match(/\b(\d+)(?:st|nd|rd|th)\s+Season\b/i);
    if (m2) return parseInt(m2[1], 10);
    const m3 = combined.match(/\b(?:Season|Part)\s*(II|III|IV|V|VI)\b/i);
    if (m3) {
      const roman = { II: 2, III: 3, IV: 4, V: 5, VI: 6 };
      return roman[m3[1].toUpperCase()] || 1;
    }
    return 1;
  }

  // Small client cache so going back and forth is instant.
  const memo = new Map();
  // Every page asks for data through here: one request per URL at a time (two
  // parts of the page asking for the same thing share it), a short memory so
  // going back and forth doesn't re-download, one quiet retry on a network
  // blip or 5xx, and the last good copy if the server can't answer.
  const API_BASE = '';

  const inflightApi = new Map();
  async function api(path, ttlMs = 5 * 60 * 1000) {
    const hit = memo.get(path);
    if (hit && Date.now() - hit.t < ttlMs) return hit.data;
    if (inflightApi.has(path)) return inflightApi.get(path);

    const attempt = async () => {
      const res = await fetch(`${API_BASE}/api${path}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(body.error || `Request failed (${res.status})`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    };
    const promise = (async () => {
      try {
        let data;
        try {
          data = await attempt();
        } catch (err) {
          if (err.status && err.status < 500) throw err; // 404 etc: a real answer
          await new Promise((r) => setTimeout(r, 800));
          data = await attempt();
        }
        memo.set(path, { t: Date.now(), data });
        return data;
      } catch (err) {
        if (hit) return hit.data; // stale beats an error page
        throw err;
      } finally {
        inflightApi.delete(path);
      }
    })();
    inflightApi.set(path, promise);
    return promise;
  }

  function toast(msg) {
    let el = $('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3000);
  }

  // ---------- Custom dropdown ----------
  // Replaces a native <select> with an animated listbox while keeping the select
  // as the source of truth, so forms and "change" listeners keep working.
  let openDropdown = null;
  function customSelect(select) {
    const wrap = select.parentElement;
    wrap.classList.add('cs');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cs-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', select.getAttribute('aria-label') || '');
    const menu = document.createElement('div');
    menu.className = 'cs-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    wrap.append(btn, menu);

    let active = -1;
    let filter = '';
    const options = () => [...select.options];
    const visible = () => $$('.cs-opt', menu);

    const syncButton = () => {
      const o = select.selectedOptions[0];
      btn.innerHTML = `<span class="cs-label">${esc(o ? o.textContent : '')}</span>${icon.chevron}`;
      wrap.classList.toggle('has-value', Boolean(select.value));
    };

    const renderMenu = () => {
      const opts = options().filter((o) => !filter || o.textContent.toLowerCase().includes(filter));
      const searchable = options().length > 12;
      menu.innerHTML = `
        ${searchable ? `<div class="cs-search">${icon.search}<input type="text" placeholder="Type to filter…" value="${esc(filter)}" aria-label="Filter options"></div>` : ''}
        <div class="cs-list">${opts.map((o, i) => `
          <button type="button" class="cs-opt${o.selected ? ' on' : ''}" role="option" aria-selected="${o.selected}" data-value="${esc(o.value)}" style="--i:${Math.min(i, 12)}">
            <span>${esc(o.textContent)}</span>${icon.check}
          </button>`).join('') || '<p class="cs-empty">No matches</p>'}
        </div>`;
      const input = $('.cs-search input', menu);
      if (input) {
        input.addEventListener('input', () => {
          filter = input.value.trim().toLowerCase();
          const pos = input.selectionStart;
          renderMenu();
          const next = $('.cs-search input', menu);
          next.focus();
          next.setSelectionRange(pos, pos);
        });
        input.addEventListener('keydown', onMenuKey);
      }
    };

    const highlight = (i) => {
      const items = visible();
      if (!items.length) return;
      active = (i + items.length) % items.length;
      items.forEach((el, j) => el.classList.toggle('kb', j === active));
      items[active].scrollIntoView({ block: 'nearest' });
    };

    const open = () => {
      if (openDropdown && openDropdown !== api) openDropdown.close();
      filter = '';
      renderMenu();
      menu.hidden = false;
      wrap.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      // Flip upward if there's no room below.
      const r = btn.getBoundingClientRect();
      wrap.classList.toggle('up', window.innerHeight - r.bottom < 280 && r.top > 320);
      openDropdown = api;
      const items = visible();
      active = items.findIndex((el) => el.classList.contains('on'));
      if (active >= 0) items[active].scrollIntoView({ block: 'nearest' });
      ($('.cs-search input', menu) || items[Math.max(active, 0)])?.focus({ preventScroll: true });
    };

    const close = (focusBtn = false) => {
      if (menu.hidden) return;
      wrap.classList.remove('open');
      wrap.classList.add('closing');
      btn.setAttribute('aria-expanded', 'false');
      setTimeout(() => { menu.hidden = true; wrap.classList.remove('closing'); }, reduceMotion ? 0 : 140);
      if (openDropdown === api) openDropdown = null;
      if (focusBtn) btn.focus();
    };

    const pick = (value) => {
      const changed = select.value !== value;
      select.value = value;
      syncButton();
      close(true);
      if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
    };

    function onMenuKey(e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active - 1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const el = visible()[active] || visible()[0];
        if (el) pick(el.dataset.value);
      } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') close();
    }

    btn.addEventListener('click', () => (menu.hidden ? open() : close()));
    btn.addEventListener('keydown', (e) => {
      if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); open(); }
    });
    menu.addEventListener('click', (e) => {
      const opt = e.target.closest('.cs-opt');
      if (opt) pick(opt.dataset.value);
    });
    menu.addEventListener('keydown', (e) => { if (!e.target.closest('.cs-search')) onMenuKey(e); });
    menu.addEventListener('mousemove', (e) => {
      const opt = e.target.closest('.cs-opt');
      if (opt) highlight(visible().indexOf(opt));
    });
    select.addEventListener('change', syncButton);

    const api = { open, close, refresh: syncButton, wrap };
    select._cs = api;
    syncButton();
    return api;
  }
  document.addEventListener('pointerdown', (e) => {
    if (openDropdown && !openDropdown.wrap.contains(e.target)) openDropdown.close();
  });

  // ---------- Shared fragments ----------
  const scoreLabel = (a) => (a.source === 'jikan' ? 'MAL' : 'AniList');

  function scoreHtml(a) {
    return a.score ? `<span class="score" title="${scoreLabel(a)} score">${icon.star}${a.score.toFixed(1)}</span>` : '';
  }

  function langHtml(a) {
    const l = a.languages || {};
    const parts = [];
    if (l.sub !== false) parts.push('<span class="s" title="Japanese audio with subtitles">SUB</span>');
    if (l.dub === 'full') parts.push('<span class="d" title="English dub available">DUB</span>');
    if (l.dub === 'partial') parts.push('<span class="d partial" title="English dub in progress">DUB*</span>');
    return `<span class="lang">${parts.join('')}</span>`;
  }

  // Only the languages that are actually available, nothing else.
  function languagesHtml(a) {
    const l = a.languages || {};
    const audio = (l.audio || ['Japanese']).map((lang) =>
      lang === 'English' && l.dub === 'partial' ? { lang, note: 'some episodes' } : { lang });
    const subs = l.subtitles || ['English'];
    const chip = (ic, { lang, note }) =>
      `<span class="av-chip">${ic}${esc(lang)}${note ? `<small>${esc(note)}</small>` : ''}</span>`;
    return `
      <section class="section reveal">
        <div class="av-langs">
          <div class="av-group"><h3>Audio</h3><div class="av-list">${audio.map((x) => chip(icon.mic, x)).join('')}</div></div>
          <div class="av-group"><h3>Subtitles</h3><div class="av-list">${subs.map((lang) => chip(icon.cc, { lang })).join('')}</div></div>
        </div>
      </section>`;
  }

  function factsOf(a, { long = false } = {}) {
    const eps = (n) => `${n} ${long ? 'Episodes' : 'eps'}`;
    if (a.seasonCount) {
      return [a.year, `${a.seasonCount} ${a.seasonCount === 1 ? 'Season' : 'Seasons'}`, a.episodeCount ? eps(a.episodeCount) : null].filter(Boolean);
    }
    // Series totals still loading: show nothing that could contradict them.
    if (a.factsPending) return [a.type, a.year].filter(Boolean);
    return [a.type, a.year, a.episodes ? eps(a.episodes) : null].filter(Boolean);
  }

  function cardHtml(a, i = 0) {
    const meta = factsOf(a);
    return `
      <a class="card" href="/anime/${esc(a.id)}" data-link style="--i:${i}" aria-label="${esc(a.title)}">
        <div class="card-poster${a.image ? '' : ' no-img'}" data-title="${esc(a.title)}">
          ${a.airing ? '<span class="pill card-tag airing">Airing</span>' : ''}
          ${a.image ? `<img src="${esc(a.image)}"${a.image2x && a.image2x !== a.image ? ` srcset="${esc(a.image)} 1x, ${esc(a.image2x)} 2x"` : ''} alt="" loading="${i < 8 ? 'eager' : 'lazy'}" decoding="async"${i < 4 ? ' fetchpriority="high"' : ''}>` : ''}
          <div class="card-hover" aria-hidden="true">
            <h4>${esc(a.title)}</h4>
            <div class="meta">${scoreHtml(a)}${meta.map(esc).join('<i class="sep"></i>')}</div>
            ${langHtml(a)}
            <p class="syn">${esc(a.synopsis || 'No synopsis yet.')}</p>
            <span class="go">Details ${icon.right}</span>
          </div>
        </div>
        <h3 class="card-title">${esc(a.title)}</h3>
        <p class="card-sub">${langHtml(a)}${a.score ? scoreHtml(a) : ''}</p>
      </a>`;
  }

  const skeletonCards = (n) =>
    Array.from({ length: n }, () => '<div><div class="sk sk-poster"></div><div class="sk sk-line"></div></div>').join('');

  function rowHtml({ title, sub, items, more, ranked }) {
    if (!items?.length) return '';
    const cards = ranked
      ? items.slice(0, 10).map((a, i) => `<div class="ranked-item"><span class="rank-num${i >= 9 ? ' two' : ''}" aria-hidden="true">${i + 1}</span>${cardHtml(a, i)}</div>`).join('')
      : items.map((a, i) => cardHtml(a, i)).join('');
    return `
      <section class="row reveal">
        <div class="row-head">
          <div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
          ${more ? `<a class="row-more" href="${esc(more)}" data-link>View all ${icon.right}</a>` : ''}
        </div>
        <div class="track-wrap">
          <button class="track-btn prev" aria-label="Scroll left" disabled>${icon.left}</button>
          <div class="track${ranked ? ' ranked' : ''}">${cards}</div>
          <button class="track-btn next" aria-label="Scroll right">${icon.right}</button>
        </div>
      </section>`;
  }

  // Safety net for every image on the page, including ones added without
  // enhance(): show it as soon as it loads, swap in a placeholder if it breaks.
  document.addEventListener('load', (e) => {
    if (e.target.tagName === 'IMG') e.target.classList.add('loaded');
  }, true);
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || img.closest('.detail-poster')) return;
    const box = img.parentElement;
    if (box && (box.classList.contains('card-poster') || box.classList.contains('result-img') || box.classList.contains('slot-img'))) {
      box.classList.add('no-img');
      img.remove();
    }
  }, true);

  // ---------- Behaviours wired after each render ----------
  function enhance(root) {
    // If the browser never started the entrance animation (some embedded or
    // throttled views freeze animations), show the cards anyway.
    setTimeout(() => {
      $$('.card', root).forEach((c) => c.getAnimations().forEach((a) => {
        try { if (!a.currentTime) a.finish(); } catch { /* infinite animations can't finish */ }
      }));
    }, 1500);
    // Fade images in once they load.
    $$('img', root).forEach((img) => {
      const done = () => img.classList.add('loaded');
      if (img.complete) {
        if (img.naturalWidth) done();
        else {
          img.parentElement?.classList.add('no-img');
          img.remove();
        }
      } else {
        img.addEventListener('load', done, { once: true });
        // Broken artwork falls back to a branded placeholder instead of a blank box.
        img.addEventListener('error', () => {
          img.parentElement?.classList.add('no-img');
          img.remove();
        }, { once: true });
      }
    });

    // Horizontal row arrows.
    $$('.track-wrap', root).forEach((wrap) => {
      const track = $('.track', wrap);
      const prev = $('.prev', wrap);
      const next = $('.next', wrap);
      const update = () => {
        prev.disabled = track.scrollLeft < 8;
        next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 8;
      };
      const go = (dir) => track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: reduceMotion ? 'auto' : 'smooth' });
      prev.addEventListener('click', () => go(-1));
      next.addEventListener('click', () => go(1));
      track.addEventListener('scroll', update, { passive: true });
      requestAnimationFrame(update);
    });

    // Scroll-triggered reveals.
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }),
      { rootMargin: '0px 0px -8% 0px' }
    );
    $$('.reveal', root).forEach((el) => io.observe(el));
  }

  // Live countdowns for "next episode" labels.
  function formatCountdown(sec) {
    if (sec <= 0) return 'Out now';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return d ? `${d}d ${h}h ${m}m` : `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }
  setInterval(() => {
    const now = Date.now() / 1000;
    $$('[data-countdown]').forEach((el) => { el.textContent = formatCountdown(Number(el.dataset.countdown) - now); });
  }, 1000);

  // ---------- Trailer modal ----------
  const modal = document.getElementById('trailerModal');
  const frame = document.getElementById('trailerFrame');
  let lastFocus = null;
  function openTrailer(id) {
    if (!/^[\w-]{11}$/.test(id)) return;
    lastFocus = document.activeElement;
    frame.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0" title="Trailer" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    modal.hidden = false;
    $('.modal-close', modal).focus();
    heroCtl?.pause();
  }
  function closeTrailer() {
    modal.hidden = true;
    frame.innerHTML = '';
    lastFocus?.focus();
    heroCtl?.resume();
  }
  modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeTrailer(); });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-trailer]');
    if (btn) { e.preventDefault(); openTrailer(btn.dataset.trailer); }
  });

  // ---------- Hero carousel ----------
  let heroCtl = null;
  const HERO_MS = 5000;

  // Backdrop: TMDB w1280 on small screens, original resolution on large ones.
  function artVars(a) {
    const sm = a.backdrop || a.banner || a.image;
    const lg = a.backdropHd || sm;
    return `--bg-sm:url('${esc(sm)}');--bg-lg:url('${esc(lg)}')`;
  }

  // Official title logo when TMDB has one, plain text otherwise.
  function titleHtml(a) {
    if (!a.logo) return `<h1>${esc(a.title)}</h1>`;
    const wide = (a.logoAspect || 3) >= 2.2;
    // The logo shows the series name, so say which season or film this page is.
    const cur = a.series?.seasons.find((x) => x.id === String(a.id));
    const extra = !cur && a.series?.extras.find((x) => x.id === String(a.id));
    const label = cur && a.series.seasons.length > 1
      ? `Season ${cur.number} of ${a.series.seasons.length}${/part\s*\d/i.test(a.title) ? ` · ${a.title.match(/part\s*\d+/i)[0]}` : ''}`
      : extra ? `${extra.format} · ${a.title}`
      : (a.title.match(/(season\s*\d+|\d+(st|nd|rd|th)\s*season|part\s*\d+|final season)/i)?.[0] || '');
    return `<h1 class="title-logo-wrap"><img class="title-logo${wide ? ' wide' : ''}" src="${esc(a.logo)}" alt="${esc(a.title)}" onerror="this.parentNode.textContent=this.alt"></h1>${label ? `<p class="logo-sub">${esc(label)}</p>` : ''}`;
  }

  function heroHtml(items) {
    if (!items.length) return '';
    const slides = items.map((a, i) => {
      const meta = [a.type, a.year, a.episodes ? `${a.episodes} episodes` : null, ...(a.genres || []).slice(0, 2)].filter(Boolean);
      return `
        <div class="hero-slide${i === 0 ? ' active' : ''}" aria-hidden="${i !== 0}" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${items.length}">
          <div class="hero-bg${a.backdrop ? ' hd' : ''}" style="${artVars(a)}"></div>
          <div class="hero-content">
            <span class="hero-kicker"><span class="dot"></span>${a.airing ? 'Trending · Airing now' : 'Spotlight'}</span>
            ${titleHtml(a)}
            <div class="hero-meta">${scoreHtml(a)}${langHtml(a)}${meta.map((m) => `<span>${esc(m)}</span>`).join('<i class="sep"></i>')}</div>
            <p class="hero-synopsis">${esc(a.synopsis)}</p>
            <div class="hero-actions">
              <a class="btn btn-primary" href="/anime/${esc(a.id)}" data-link>${icon.info}View details</a>
              ${a.trailer ? `<button class="btn btn-ghost" data-trailer="${esc(a.trailer)}">${icon.play}Trailer</button>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');
    const dots = items.map((a, i) => `<button class="hero-dot${i === 0 ? ' active' : ''}" aria-label="Show ${esc(a.title)}"><span></span></button>`).join('');
    return `
      <section class="hero" aria-roledescription="carousel" aria-label="Spotlight" style="--hero-ms:${HERO_MS}ms">
        ${slides}
        <div class="hero-dots">${dots}</div>
        <div class="hero-arrows">
          <button data-dir="-1" aria-label="Previous slide">${icon.left}</button>
          <button data-dir="1" aria-label="Next slide">${icon.right}</button>
        </div>
      </section>`;
  }

  function startHero(root) {
    const hero = $('.hero', root);
    if (!hero) return null;
    const slides = $$('.hero-slide', hero);
    const dots = $$('.hero-dot', hero);
    let index = 0;
    let timer = null;
    let remaining = HERO_MS;
    let startedAt = 0;
    let paused = false;

    const show = (i) => {
      index = (i + slides.length) % slides.length;
      slides.forEach((s, j) => {
        s.classList.toggle('active', j === index);
        s.setAttribute('aria-hidden', String(j !== index));
        $$('a,button', s).forEach((el) => (el.tabIndex = j === index ? 0 : -1));
      });
      dots.forEach((d, j) => {
        d.classList.remove('active', 'done');
        if (j < index) d.classList.add('done');
      });
      void dots[index].offsetWidth; // restart the progress animation
      dots[index].classList.add('active');
      remaining = HERO_MS;
      schedule();
    };
    const schedule = () => {
      clearTimeout(timer);
      if (paused || reduceMotion) return;
      startedAt = Date.now();
      timer = setTimeout(() => show(index + 1), remaining);
    };
    const pause = () => {
      if (paused) return;
      paused = true;
      hero.classList.add('paused');
      clearTimeout(timer);
      remaining -= Date.now() - startedAt;
    };
    const resume = () => {
      if (!paused) return;
      paused = false;
      hero.classList.remove('paused');
      schedule();
    };

    dots.forEach((d, i) => d.addEventListener('click', () => show(i)));
    $$('.hero-arrows button', hero).forEach((b) => b.addEventListener('click', () => show(index + Number(b.dataset.dir))));
    hero.addEventListener('mouseenter', pause);
    hero.addEventListener('mouseleave', resume);
    hero.addEventListener('focusin', pause);
    hero.addEventListener('focusout', resume);

    // Swipe on touch screens.
    let x0 = null;
    hero.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    hero.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
      x0 = null;
    });

    const onVisibility = () => (document.hidden ? pause() : resume());
    document.addEventListener('visibilitychange', onVisibility);

    show(0);
    return {
      pause,
      resume,
      destroy() {
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVisibility);
      },
    };
  }

  // ---------- Pages ----------
  async function homePage(view) {
    view.innerHTML = `<div class="sk sk-hero"></div><div class="rows" style="margin-top:24px">${[0, 1].map(() => `
      <section class="row"><div class="row-head"><div class="sk" style="height:22px;width:200px"></div></div>
      <div class="track">${skeletonCards(8)}</div></section>`).join('')}</div>`;

    const data = await api('/home', 10 * 60 * 1000);
    const season = data.seasonNow?.[0]?.season;
    const seasonYear = data.seasonNow?.[0]?.year;
    view.innerHTML = `
      ${heroHtml(data.spotlight)}
      <div class="rows"${data.spotlight.length ? '' : ' style="margin-top:calc(var(--nav-h) + 24px)"'}>
        ${rowHtml({ title: 'Top 10 Airing Right Now', sub: 'Updated automatically every 30 minutes', items: data.trending, ranked: true, more: '/browse?status=airing&order=popularity' })}
        ${rowHtml({ title: season ? `${cap(season)} ${seasonYear || ''} Season` : 'This Season', sub: 'Everything airing this season', items: data.seasonNow, more: '/browse?status=airing' })}
        ${rowHtml({ title: 'Dubbed in English', sub: 'Popular titles you can watch with English audio', items: [...data.popular, ...data.topRated].filter((a, i, arr) => a.languages?.dub && arr.findIndex((b) => b.id === a.id) === i), more: '/browse?dub=1' })}
        ${rowHtml({ title: 'Highest Rated of All Time', items: data.topRated, more: '/browse?order=score' })}
        ${rowHtml({ title: 'Most Popular', items: data.popular, more: '/browse?order=popularity' })}
        ${rowHtml({ title: 'Coming Next Season', sub: 'Most anticipated upcoming anime', items: data.upcoming, more: '/browse?status=upcoming' })}
        ${rowHtml({ title: 'Top Anime Movies', items: data.movies, more: '/browse?type=movie&order=score' })}
      </div>`;
    enhance(view);
    heroCtl = startHero(view);
    return `AnimeVerse — Discover Anime`;
  }

  // ---------- Detail page sections ----------
  // Prefer the big subscription platforms for the main "Watch on" button.
  const PLATFORM_ORDER = ['crunchyroll', 'netflix', 'hidive', 'amazon prime video', 'prime video', 'disney plus', 'hulu', 'max', 'bilibili tv', 'muse asia', 'ani-one asia', 'youtube'];
  function primaryStream(a) {
    const list = (a.links || []).filter((l) => l.type === 'STREAMING');
    const pool = list.length ? list : a.streaming || [];
    const rank = (n) => { const i = PLATFORM_ORDER.indexOf(String(n).toLowerCase()); return i < 0 ? 50 : i; };
    return [...pool].sort((x, y) => rank(x.name) - rank(y.name))[0] || null;
  }

  // ---------- Streambert OTT Style Watch Engine (Ad-Shielded) ----------
  const STREAM_SERVERS = [
    {
      id: 'hianime',
      name: 'HiAnime (Native)',
      tag: '1080p • 0 Ads',
      supportsDub: true,
      isNative: true,
      getUrl: () => '',
    },
    {
      id: 'vidrift',
      name: 'Vidrift',
      tag: 'Anime \u00B7 Multi-Audio',
      supportsDub: true,
      isNative: false,
      getUrl: (alId, ep, lang, tmdbId, season) => {
        const logoUrl = 'https://api.iconify.design/ri/moon-clear-fill.svg?color=%23ff640a';
        const params = new URLSearchParams({
          brand: 'AnimeVerse',
          brandColor: 'ff640a',
          brandLogo: logoUrl,
          watermark: '1',
          font: 'Inter',
          controlBg: 'solid',
          hide: 'episodes,next,server,cast',
          fs: 'parent',
        });
        if (lang === 'dub') params.set('dub', '1');
        return tmdbId
          ? `https://embed.vidrift.net/embed/tv/${tmdbId}/${season}/${ep}?${params.toString()}`
          : `https://embed.vidrift.net/embed/anilist/${alId}/${ep}?${params.toString()}`;
      },
    },
  ];

  // Accurately calculates only genuinely available / aired episodes
  function getAvailableEpisodes(a) {
    if (a.status === 'Not yet aired') return 0;
    if (a.type === 'Movie') return 1;

    // Currently airing anime: nextEpisode tells what airs next (e.g., ep 5 next means 1..4 are out)
    if (a.nextEpisode?.episode && Number(a.nextEpisode.episode) > 1) {
      return Number(a.nextEpisode.episode) - 1;
    }

    // Finished airing anime: all episodes are out
    if (a.status === 'Finished Airing' && a.episodes && Number(a.episodes) > 0) {
      return Number(a.episodes);
    }

    // Airing ongoing without nextEpisode: estimate based on start date
    if (a.airing) {
      if (a.aired) {
        const match = a.aired.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
        if (match) {
          const startDate = new Date(`${match[1]} ${match[2]}, ${match[3]}`);
          const diffWeeks = Math.floor((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
          if (diffWeeks > 0) {
            return a.episodes ? Math.min(diffWeeks, Number(a.episodes)) : diffWeeks;
          }
        }
      }
      return 1;
    }

    if (a.episodes && Number(a.episodes) > 0) {
      return Number(a.episodes);
    }

    return 1;
  }

  async function watchPage(view, id, params) {
    view.innerHTML = `
      <div class="watch-page">
        <div class="player-top-header">
          <div class="sk" style="height:28px;width:340px;border-radius:6px;"></div>
        </div>
        <div class="player-wrap">
          <div class="player-loader">
            <div class="spinner"></div>
            <p>Loading episode stream…</p>
          </div>
        </div>
        <div class="episodes-section" style="margin-top:36px;">
          <div class="sk" style="height:24px;width:140px;margin-bottom:18px;"></div>
          <div class="episodes-grid">
            ${Array.from({ length: 8 }, () => '<div class="sk" style="height:110px;border-radius:8px;"></div>').join('')}
          </div>
        </div>
      </div>
    `;

    const seasonParam = params.get('season');
    const epUrl = seasonParam
      ? `/anime/${encodeURIComponent(id)}/episodes?season=${encodeURIComponent(seasonParam)}`
      : `/anime/${encodeURIComponent(id)}/episodes`;
    const [a, initialEpData] = await Promise.all([
      api(`/anime/${encodeURIComponent(id)}`, 30 * 60 * 1000),
      api(epUrl, 60 * 60 * 1000).catch(() => null),
    ]);
    const alId = a.anilistId || (String(a.id).startsWith('al') ? Number(a.id.slice(2)) : a.id);
    const availableEp = getAvailableEpisodes(a);

    if (availableEp === 0) {
      view.innerHTML = `
        <div class="watch-page" style="text-align:center;padding:80px 20px;">
          <h2>Not Yet Available</h2>
          <p style="color:var(--muted);margin:12px auto 24px;max-width:500px;">
            ${esc(a.title)} has not started airing yet. Please check back when episode 1 releases.
          </p>
          <a href="/anime/${esc(a.id)}" class="btn btn-primary" data-link>Back to Anime Details</a>
        </div>
      `;
      return `${a.title} — AnimeVerse`;
    }

    const detectedSeason = detectSeasonNumber(a.title, a.titleRomaji);
    const requestedSeason = params.get('season') ? Number(params.get('season')) : null;
    const isRequestedSeasonValid = requestedSeason && initialEpData?.seasons?.some((s) => s.season_number === requestedSeason);
    let currentSeason = isRequestedSeasonValid
      ? requestedSeason
      : Number(initialEpData?.selectedSeason || (detectedSeason > 1 ? detectedSeason : 1));
    let viewingSeason = currentSeason;
    let currentEp = Number(params.get('ep') || localStorage.getItem(`animeverse_ep_${a.id}`) || 1);

    // Reuse prefetched episodes metadata if season matches, else fetch
    let epData = (initialEpData && (initialEpData.selectedSeason === currentSeason || !params.get('season') || !isRequestedSeasonValid))
      ? initialEpData
      : await api(`/anime/${encodeURIComponent(id)}/episodes?season=${currentSeason}`, 60 * 60 * 1000).catch(() => null);

    const tmdbId = epData?.tmdbId || null;
    let seasons = (epData?.seasons && epData.seasons.length > 0) ? epData.seasons : [{ season_number: currentSeason, name: `Season ${currentSeason}`, episode_count: availableEp }];
    let episodes = (epData?.episodes && epData.episodes.length > 0) ? epData.episodes : [];

    // Fallback if episodes empty
    if (!episodes.length) {
      for (let i = 1; i <= availableEp; i++) {
        episodes.push({
          episode_number: i,
          season_number: currentSeason,
          name: `Episode ${i}`,
          overview: a.synopsis || '',
          still_path: a.banner || a.image,
          air_date: a.aired || null,
        });
      }
    }

    // Only filter to available episodes if this season is the currently airing one
    if (currentSeason === detectedSeason && a.airing && availableEp < episodes.length) {
      episodes = episodes.filter((e) => e.episode_number <= availableEp);
    }
    // Ensure genuinely released episodes are always included even if metadata lagged
    if (currentSeason === detectedSeason && a.airing && episodes.length < availableEp) {
      for (let i = episodes.length + 1; i <= availableEp; i++) {
        episodes.push({
          episode_number: i,
          season_number: currentSeason,
          name: `Episode ${i}`,
          overview: a.synopsis || '',
          still_path: a.banner || a.image,
          air_date: null,
          hasDub: epData?.dubCount ? (i <= epData.dubCount) : false,
          hasSub: true,
        });
      }
    }

    if (currentEp < 1) currentEp = 1;
    if (currentEp > episodes.length) currentEp = episodes.length;

    let currentServer = 'hianime';
    const savedServer = sessionStorage.getItem('animeverse_server_session');
    if (savedServer && ['hianime', 'vidrift'].includes(savedServer)) {
      currentServer = savedServer;
    } else {
      localStorage.setItem('animeverse_server', 'hianime');
    }
    let currentLang = localStorage.getItem('animeverse_lang') || 'sub';

    const storageKeyWatched = `animeverse_watched_${a.id}`;
    let watched = new Set();
    try {
      const saved = JSON.parse(localStorage.getItem(storageKeyWatched) || '[]');
      if (Array.isArray(saved)) watched = new Set(saved);
    } catch {}

    const storageKeyProgress = (ep, s = currentSeason) => `animeverse_prog_${a.id}_s${s}_e${ep}`;
    const storageKeyExactTime = (ep, s = currentSeason) => `animeverse_time_${a.id}_s${s}_e${ep}`;
    let currentEpPct = Number(localStorage.getItem(storageKeyProgress(currentEp, currentSeason)) || (watched.has(currentEp) ? 100 : 0));

    function getActiveServer() {
      return STREAM_SERVERS.find((srv) => srv.id === currentServer) || STREAM_SERVERS[0];
    }

    function getServerUrl(ep = currentEp) {
      const s = getActiveServer();
      return s.getUrl(alId, ep, currentLang, tmdbId, currentSeason);
    }

    const currentEpObj = episodes.find((e) => e.episode_number === currentEp) || {
      episode_number: currentEp,
      name: `Episode ${currentEp}`,
      overview: a.synopsis,
      still_path: a.banner || a.image,
    };

    function renderEpisodeCardsHtml(list = episodes, cur = currentEp, isSeasonActive = true, sNum = currentSeason) {
      return list.map((ep) => {
        const isCur = isSeasonActive && ep.episode_number === cur;
        const isWatched = watched.has(ep.episode_number);
        const epProgress = Number(localStorage.getItem(storageKeyProgress(ep.episode_number, sNum)) || (isWatched ? 100 : 0));
        const thumb = ep.still_path || a.banner || a.image;
        const overview = ep.overview || a.synopsis || 'No episode description available.';

        return `
          <div class="episode-card${isCur ? ' playing' : ''}${isWatched ? ' ep-watched' : ''}" data-ep-card="${ep.episode_number}">
            <div class="episode-thumb">
              <img src="${esc(thumb)}" alt="Episode ${ep.episode_number}" loading="lazy" decoding="async">
              ${isCur ? `
                <div class="episode-playing-badge">
                  <span class="episode-playing-dot"></span> Playing
                </div>
              ` : `
                <div class="episode-thumb-play">${icon.play}</div>
              `}
            </div>
            <div class="episode-info">
              <div class="episode-num">
                <span>E${ep.episode_number}</span>
                <span class="ep-lang-tag ${(ep.hasDub !== undefined ? ep.hasDub : (epData?.dubCount ? ep.episode_number <= epData.dubCount : false)) ? 'sub-dub' : 'sub-only'}">${(ep.hasDub !== undefined ? ep.hasDub : (epData?.dubCount ? ep.episode_number <= epData.dubCount : false)) ? 'SUB | DUB' : 'SUB'}</span>
                ${isWatched ? '<span class="episode-watched-check">✓</span>' : ''}
              </div>
              <div class="episode-name">${esc(ep.name || `Episode ${ep.episode_number}`)}</div>
              <div class="episode-desc-wrap">
                <p class="episode-desc clamped" id="epDesc_${ep.episode_number}">
                  ${esc(overview)}
                </p>
                ${overview.length > 90 ? `
                  <button type="button" class="episode-desc-toggle" data-desc-toggle="${ep.episode_number}">MORE</button>
                ` : ''}
              </div>
              ${epProgress > 0 && !isWatched ? `
                <div class="episode-progress-bar">
                  <div class="episode-progress-fill" style="width: ${Math.min(epProgress, 100)}%"></div>
                </div>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');
    }

    view.innerHTML = `
      <div class="watch-page" id="watchPageContainer">
        <!-- Top Header Above Player -->
        <div class="player-top-header">
          <div class="player-title-row">
            <span class="tag tag-red" id="seasonEpTag">Season ${currentSeason} · E${currentEp}</span>
            <span class="player-ep-title" id="playerEpTitle">${esc(currentEpObj.name || `Episode ${currentEp}`)}</span>
            <button type="button" class="mark-watched-btn${watched.has(currentEp) ? ' watched' : ''}" id="markWatchedBtn">
              ${watched.has(currentEp) ? '✓ Watched' : '✓ Mark Watched'}
            </button>
          </div>
        </div>

        <!-- Cinema Video Player Viewport -->
        <div class="cinema-player-box" id="playerBox">
          <div class="cinema-loader" id="playerLoader">
            <div class="spinner"></div>
            <p id="playerLoaderMsg">Connecting to stream...</p>
          </div>

          <!-- Up Next Floating Card -->
          <div class="up-next-card" id="upNextCard">
            <div class="up-next-thumb-wrap">
              <img id="upNextThumb" src="" alt="Next Episode">
            </div>
            <div class="up-next-info">
              <div class="up-next-kicker" id="upNextKicker">UP NEXT</div>
              <div class="up-next-title" id="upNextTitle">Episode Title</div>
              <div class="up-next-sub" id="upNextSub">STARTS IN 10s</div>
            </div>
            <div class="up-next-actions">
              <button type="button" class="up-next-play-btn" id="upNextPlayBtn">
                <span class="up-next-progress-fill" id="upNextProgressFill"></span>
                <span class="up-next-btn-text">Play now</span>
              </button>
              <button type="button" class="up-next-cancel-btn" id="upNextCancelBtn">Cancel</button>
            </div>
          </div>

          <div class="cinema-player-mount" id="playerMount"></div>
        </div>

        <!-- Permanent Server Bar (OUTSIDE player frame, ALWAYS VISIBLE) -->
        <div class="player-toolbar" id="playerToolbar">
          <div class="toolbar-section">
            <span class="toolbar-label">
              <svg class="ic" viewBox="0 0 24 24" style="width:14px;height:14px;"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="2"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1 4-10z" fill="none" stroke="currentColor" stroke-width="2"/></svg>
              SERVER:
            </span>
            <div class="server-pill-list" id="serverSelectorList">
              ${STREAM_SERVERS.map((s) => `
                <button type="button" class="server-pill${s.id === currentServer ? ' active' : ''}" data-server-id="${s.id}">
                  <span class="server-dot"></span>
                  ${esc(s.name)}
                </button>
              `).join('')}
            </div>
          </div>
          <div class="toolbar-section audio-section" id="audioSection">
            <span class="toolbar-label">
              <svg class="ic" viewBox="0 0 24 24" style="width:14px;height:14px;" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              AUDIO:
            </span>
            <div class="audio-toggle-pills" id="audioToggleList">
              <button type="button" class="audio-pill${currentLang === 'sub' ? ' active' : ''}" data-audio-lang="sub">SUB</button>
              <button type="button" class="audio-pill${currentLang === 'dub' ? ' active' : ''}${!(currentEpObj?.hasDub !== undefined ? currentEpObj.hasDub : (epData?.dubCount ? currentEp <= epData.dubCount : false)) ? ' disabled' : ''}" data-audio-lang="dub" id="dubAudioBtn" title="${(currentEpObj?.hasDub !== undefined ? currentEpObj.hasDub : (epData?.dubCount ? currentEp <= epData.dubCount : false)) ? 'English Dub Available' : 'Japanese Audio (Sub) only for this episode'}">DUB</button>
            </div>
          </div>
          <div class="toolbar-section toolbar-section-contrast">
            <span class="toolbar-label">
              <svg class="ic" viewBox="0 0 24 24" style="width:14px;height:14px;" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor"/></svg>
              CONTRAST:
            </span>
            <div class="contrast-pill-list" id="contrastSelectorList">
              <button type="button" class="contrast-pill active" data-contrast="standard">Standard</button>
              <button type="button" class="contrast-pill" data-contrast="vivid">Vivid Anime</button>
              <button type="button" class="contrast-pill" data-contrast="high">High Contrast</button>
              <button type="button" class="contrast-pill" data-contrast="cinema">Cinema Soft</button>
            </div>
          </div>
        </div>

        <!-- Episodes Section -->
        <div class="episodes-section">
          <div class="episodes-section-header">
            <h2 class="episodes-section-title">EPISODES</h2>
            <span class="episodes-count-badge" id="episodesCountBadge">${episodes.length} Episodes</span>
          </div>

          <!-- Season Selector Tabs -->
          <div class="season-selector" id="seasonSelector">
            ${seasons.map((s) => `
              <button type="button" class="season-btn${s.season_number === viewingSeason ? ' active' : ''}" data-season-num="${s.season_number}">
                ${esc(s.name || `Season ${s.season_number}`)}
              </button>
            `).join('')}
          </div>

          <!-- Episodes Grid -->
          <div class="episodes-grid" id="episodesGrid">
            ${renderEpisodeCardsHtml(episodes, currentEp, true, currentSeason)}
          </div>
        </div>
      </div>
    `;

    setupWatchPageInteractions({
      view,
      a,
      alId,
      tmdbId,
      currentSeason,
      viewingSeason,
      detectedSeason,
      availableEp,
      currentEp,
      episodes,
      seasons,
      currentServer,
      currentLang,
      watched,
      storageKeyWatched,
      storageKeyExactTime,
      renderEpisodeCardsHtml,
      epData,
    });

    return `Watch E${currentEp}: ${a.title} — AnimeVerse`;
  }

  function setupWatchPageInteractions(ctx) {
    const {
      view,
      a,
      alId,
      seasons,
      watched,
      storageKeyWatched,
      renderEpisodeCardsHtml,
      detectedSeason,
      epData,
      availableEp,
    } = ctx;

    let currentSeason = ctx.currentSeason;
    let viewingSeason = ctx.viewingSeason || currentSeason;
    let currentEp = ctx.currentEp;
    let currentServer = ctx.currentServer;
    let currentLang = ctx.currentLang;
    let episodes = ctx.episodes;

    const storageKeyProgress = (ep, s = currentSeason) => `animeverse_prog_${a.id}_s${s}_e${ep}`;
    const storageKeyExactTime = ctx.storageKeyExactTime || ((ep, s = currentSeason) => `animeverse_time_${a.id}_s${s}_e${ep}`);

    function getActiveServer() {
      return STREAM_SERVERS.find((srv) => srv.id === currentServer) || STREAM_SERVERS[0];
    }

    let tmdbId = ctx.tmdbId || a.tmdbId || null;
    const playerBox = $('#playerBox', view);
    const playerMount = $('#playerMount', view);
    const playerLoader = $('#playerLoader', view);
    const playerLoaderMsg = $('#playerLoaderMsg', view);
    const seasonEpTag = $('#seasonEpTag', view);
    const playerEpTitle = $('#playerEpTitle', view);
    const markWatchedBtn = $('#markWatchedBtn', view);
    const episodesGrid = $('#episodesGrid', view);
    const episodesCountBadge = $('#episodesCountBadge', view);
    const seasonSelector = $('#seasonSelector', view);

    // Up Next Popup elements & state
    const upNextCard = $('#upNextCard', view);
    const upNextThumb = $('#upNextThumb', view);
    const upNextKicker = $('#upNextKicker', view);
    const upNextTitle = $('#upNextTitle', view);
    const upNextSub = $('#upNextSub', view);
    const upNextPlayBtn = $('#upNextPlayBtn', view);
    const upNextCancelBtn = $('#upNextCancelBtn', view);
    const upNextProgressFill = $('#upNextProgressFill', view);

    let upNextActive = false;
    let upNextCancelled = false;
    let upNextAnimFrame = null;
    let upNextStartTime = 0;
    let playbackCurrentTime = 0;
    let playbackDuration = 0;
    const UP_NEXT_DURATION_MS = 10000;


    // Contrast & Video Enhancement Engine
    let currentContrast = localStorage.getItem('animeverse_contrast') || 'standard';
    function applyContrast(mode) {
      currentContrast = mode;
      try { localStorage.setItem('animeverse_contrast', mode); } catch {}
      if (playerMount) {
        playerMount.dataset.contrast = mode;
      }
      $$('.contrast-pill', view).forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.contrast === mode);
      });
    }
    applyContrast(currentContrast);

    $$('.contrast-pill', view).forEach((btn) => {
      btn.addEventListener('click', () => {
        applyContrast(btn.dataset.contrast);
      });
    });

    let activeHls = null;
    let activeVideo = null;
    let activeIframe = null;
    let currentResolveGen = 0;

    // ── Teardown & Clean Up: Guarantees MULTIPLE PLAYERS NEVER RUN AT ONCE ──
    function teardownPlayer() {
      if (activeHls) {
        try {
          activeHls.stopLoad();
          activeHls.destroy();
        } catch (e) {}
        activeHls = null;
      }
      if (activeVideo) {
        try {
          activeVideo.pause();
          activeVideo.removeAttribute('src');
          activeVideo.load();
        } catch (e) {}
        activeVideo.remove();
        activeVideo = null;
      }
      if (activeIframe) {
        try {
          activeIframe.src = 'about:blank';
        } catch (e) {}
        activeIframe.remove();
        activeIframe = null;
      }
      if (playerMount) {
        playerMount.innerHTML = '';
      }
    }

    function showLoader(msg = 'Connecting to stream...') {
      if (playerLoaderMsg) playerLoaderMsg.textContent = msg;
      if (playerLoader) playerLoader.classList.remove('hidden');
    }

    function hideLoader() {
      if (playerLoader) playerLoader.classList.add('hidden');
    }

    // Save exact position safely
    function savePlaybackProgress(curTime, dur) {
      playbackCurrentTime = curTime || 0;
      playbackDuration = dur || 0;
      if (curTime > 1) {
        try {
          localStorage.setItem(storageKeyExactTime(currentEp), curTime.toFixed(2));
        } catch {}
      }
      if (dur && !isNaN(dur) && dur > 0) {
        const pct = Math.min(100, Math.floor((curTime / dur) * 100));
        if (pct > 0) {
          try {
            localStorage.setItem(storageKeyProgress(currentEp), String(pct));
          } catch {}
        }
        if (pct >= 85 && !watched.has(currentEp)) {
          watched.add(currentEp);
          try {
            localStorage.setItem(storageKeyWatched, JSON.stringify([...watched]));
          } catch {}
          if (markWatchedBtn) {
            markWatchedBtn.classList.add('watched');
            markWatchedBtn.textContent = '✓ Watched';
          }
          if (episodesGrid && viewingSeason === currentSeason) {
            episodesGrid.innerHTML = renderEpisodeCardsHtml(episodes, currentEp, true, currentSeason);
            attachCardListeners(episodes, currentSeason);
          }
        }
      }
    }

    // ── Unified Stream Loader (Seamless Re-use & Fullscreen-Safe) ──
    async function loadStream(explicitResumeTime = null) {
      const thisGen = ++currentResolveGen;
      const s = getActiveServer();

      // Read exact resume timestamp in seconds
      const targetResumeSec = explicitResumeTime !== null
        ? explicitResumeTime
        : Number(localStorage.getItem(storageKeyExactTime(currentEp)) || 0);

      cancelUpNext();
      upNextCancelled = false;
      playbackCurrentTime = 0;
      playbackDuration = 0;

      // 1. Sync toolbar UI
      $$('.server-pill', view).forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.serverId === currentServer);
      });
      $$('.audio-pill', view).forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.audioLang === currentLang);
      });

      // 2. If switching between server types (Native vs Iframe), teardown the other one
      if (s.isNative && activeIframe) {
        teardownPlayer();
      } else if (!s.isNative && activeVideo) {
        teardownPlayer();
      }

      // 3. Mount / Update Native HLS Player
      if (s.isNative) {
        showLoader(`Loading ${s.name}...`);
        try {
          const res = await api(
            `/stream/resolve?title=${encodeURIComponent(a.title)}&romaji=${encodeURIComponent(a.titleRomaji || '')}&season=${currentSeason}&episode=${currentEp}&mode=${currentLang}`,
            30 * 60 * 1000
          );

          if (thisGen !== currentResolveGen) return;

          if (!res || !res.streamUrl) {
            throw new Error('No stream URL available');
          }

          const finalStreamUrl = res.streamUrl.startsWith('http')
            ? res.streamUrl
            : `${API_BASE}${res.streamUrl}`;

          let video = activeVideo;
          if (!video) {
            video = document.createElement('video');
            video.className = 'cinema-video-element';
            video.controls = true;
            video.playsInline = true;
            video.preload = 'auto';
            video.crossOrigin = 'anonymous';

            playerMount.appendChild(video);
            activeVideo = video;

            const onProgressFlush = () => {
              if (video && video.currentTime > 1) {
                savePlaybackProgress(video.currentTime, video.duration);
              }
            };

            video.addEventListener('timeupdate', () => {
              if (video.currentTime > 1) {
                savePlaybackProgress(video.currentTime, video.duration);
              }
              // Trigger Up Next card 30 seconds before ending
              if (video.duration > 35 && (video.duration - video.currentTime) <= 30) {
                triggerUpNext();
              }
            });
            video.addEventListener('pause', onProgressFlush);
            video.addEventListener('seeking', onProgressFlush);
            video.addEventListener('seeked', onProgressFlush);
            window.addEventListener('beforeunload', onProgressFlush);
            window.addEventListener('pagehide', onProgressFlush);

            video.addEventListener('ended', () => {
              watched.add(currentEp);
              try {
                localStorage.setItem(storageKeyWatched, JSON.stringify([...watched]));
                localStorage.setItem(storageKeyProgress(currentEp), '100');
              } catch {}
              if (markWatchedBtn) {
                markWatchedBtn.classList.add('watched');
                markWatchedBtn.textContent = '✓ Watched';
              }
              triggerUpNext(true);
            });
          }

          // Subtitle tracks
          while (video.firstChild) {
            video.removeChild(video.firstChild);
          }
          if (res.subtitles && res.subtitles.length > 0) {
            res.subtitles.forEach((sub, idx) => {
              const track = document.createElement('track');
              track.kind = 'subtitles';
              track.label = sub.label || sub.lang || `Track ${idx + 1}`;
              track.srclang = sub.lang || 'en';
              track.src = sub.src.startsWith('http') ? sub.src : `${API_BASE}${sub.src}`;
              if (sub.default) track.default = true;
              video.appendChild(track);
            });
          }

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

            let restored = false;
            const applyResume = () => {
              if (restored) return;
              if (targetResumeSec > 1.5) {
                try {
                  if (Math.abs(video.currentTime - targetResumeSec) > 1.5) {
                    video.currentTime = targetResumeSec;
                  }
                  restored = true;
                } catch (e) {}
              }
            };

            video.addEventListener('loadedmetadata', applyResume, { once: true });
            video.addEventListener('canplay', applyResume, { once: true });
            hls.once(Hls.Events.LEVEL_LOADED, applyResume);

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
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = finalStreamUrl;
            video.addEventListener('loadedmetadata', () => {
              if (thisGen !== currentResolveGen) return;
              hideLoader();
              if (targetResumeSec > 1.5) video.currentTime = targetResumeSec;
              video.play().catch(() => {});
            }, { once: true });
          }
        } catch (err) {
          if (thisGen !== currentResolveGen) return;
          console.warn('[Player] Native stream failed:', err.message);
          hideLoader();
          if (playerMount) {
            playerMount.innerHTML = `
              <div class="player-error-view">
                <p class="err-title">Stream currently unavailable on HiAnime</p>
                <p class="err-desc">${esc(err.message || 'Could not resolve video stream.')}</p>
                <div class="err-actions">
                  <button type="button" class="btn btn-red" id="retryStreamBtn">Retry</button>
                  <button type="button" class="btn btn-ghost" id="fallbackVidriftBtn">Switch to Vidrift</button>
                </div>
              </div>
            `;
            $('#retryStreamBtn', playerMount)?.addEventListener('click', () => loadStream());
            $('#fallbackVidriftBtn', playerMount)?.addEventListener('click', () => switchServer('vidrift'));
          }
        }
      } else {
        // 4. Mount / Update Embed Iframe (Vidrift) — Seamless reuse retains fullscreen!
        const embedUrl = s.getUrl(alId, currentEp, currentLang, tmdbId, currentSeason);

        const notifyNextEp = (win) => {
          if (!win) return;
          try {
            // Send next: null to Vidrift so Vidrift suppresses its duplicate internal Up Next card.
            // Our custom AnimeVerse floating Up Next card with the 10s progress bar and cancel button
            // will exclusively handle up next transitions.
            win.postMessage({ type: 'vidrift:nextup-info', next: null }, 'https://embed.vidrift.net');
            win.postMessage({
              type: 'vidrift:fullscreen-state',
              on: !!(document.fullscreenElement || playerBox?.classList.contains('is-fullscreen')),
            }, 'https://embed.vidrift.net');
          } catch (e) {}
        };

        if (activeIframe) {
          // REUSE existing iframe to prevent exiting fullscreen and eliminate delay!
          activeIframe.title = `${a.title} - S${currentSeason}E${currentEp}`;
          if (activeIframe.src !== embedUrl) {
            showLoader(`Loading Episode ${currentEp}...`);
            activeIframe.onload = () => {
              if (thisGen !== currentResolveGen) return;
              hideLoader();
              notifyNextEp(activeIframe.contentWindow);
            };
            activeIframe.src = embedUrl;
          } else {
            hideLoader();
            notifyNextEp(activeIframe.contentWindow);
          }
          setTimeout(() => {
            if (thisGen === currentResolveGen) hideLoader();
          }, 1500);
        } else {
          showLoader(`Loading ${s.name}...`);
          const iframe = document.createElement('iframe');
          iframe.className = 'cinema-iframe-element';
          iframe.title = `${a.title} - S${currentSeason}E${currentEp}`;
          iframe.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
          iframe.allowFullscreen = true;
          iframe.src = embedUrl;

          playerMount.appendChild(iframe);
          activeIframe = iframe;

          iframe.onload = () => {
            if (thisGen !== currentResolveGen) return;
            hideLoader();
            notifyNextEp(iframe.contentWindow);
          };
          setTimeout(() => {
            if (thisGen === currentResolveGen) hideLoader();
          }, 2000);
        }
      }
    }

    // Server selection listener
    function switchServer(sid) {
      if (sid === currentServer) return;
      const currentPos = (activeVideo && activeVideo.currentTime > 1) ? activeVideo.currentTime : null;
      currentServer = sid;
      try {
        localStorage.setItem('animeverse_server', currentServer);
        sessionStorage.setItem('animeverse_server_session', currentServer);
      } catch {}
      loadStream(currentPos);
    }

    $$('.server-pill', view).forEach((btn) => {
      btn.addEventListener('click', () => switchServer(btn.dataset.serverId));
    });

    // Audio language listener
    function switchAudio(lang) {
      if (lang === currentLang) return;
      const currentPos = (activeVideo && activeVideo.currentTime > 1) ? activeVideo.currentTime : null;
      currentLang = lang;
      try {
        localStorage.setItem('animeverse_lang', currentLang);
      } catch {}
      loadStream(currentPos);
    }

    $$('.audio-pill', view).forEach((btn) => {
      btn.addEventListener('click', () => switchAudio(btn.dataset.audioLang));
    });

    // Up Next Next-Episode Metadata Helper
    function getNextEpMeta() {
      if (currentEp < episodes.length) {
        if (a.airing && currentSeason === detectedSeason && (currentEp + 1) > availableEp) {
          return null;
        }
        const nextEpObj = episodes.find((e) => e.episode_number === currentEp + 1) || {
          episode_number: currentEp + 1,
          name: `Episode ${currentEp + 1}`,
        };
        return {
          season: currentSeason,
          episode: currentEp + 1,
          name: nextEpObj.name || `Episode ${currentEp + 1}`,
          still: nextEpObj.still_path || a.banner || a.image,
          isNextSeason: false,
        };
      }
      const nextSeasonObj = seasons && seasons.find((s) => s.season_number > currentSeason && (s.episode_count || 0) > 0);
      if (nextSeasonObj) {
        return {
          season: nextSeasonObj.season_number,
          episode: 1,
          name: `Season ${nextSeasonObj.season_number} Premiere`,
          still: a.banner || a.image,
          isNextSeason: true,
        };
      }
      return null;
    }

    // Up Next Floating Popup with 5-Second Progress Bar
    function cancelUpNext() {
      upNextActive = false;
      upNextCancelled = true;
      if (upNextAnimFrame) {
        cancelAnimationFrame(upNextAnimFrame);
        upNextAnimFrame = null;
      }
      if (upNextCard) {
        upNextCard.classList.remove('visible');
      }
    }

    function playNextNow() {
      cancelUpNext();
      const nextMeta = getNextEpMeta();
      if (!nextMeta) return;
      if (nextMeta.isNextSeason) {
        switchSeasonAndEpisode(nextMeta.season, 1);
      } else {
        switchEpisode(nextMeta.episode);
      }
    }

    window.triggerUpNext = triggerUpNext;
    window.cancelUpNext = cancelUpNext;
    window.playNextNow = playNextNow;

    function triggerUpNext(force = false) {
      if (upNextActive || upNextCancelled) return;

      // STRICT TIMING GUARD: Never trigger Up Next if playback is early/mid episode!
      // Only trigger if remaining time is <= 90s, or position is >= 85% of total duration, or forced on video ended.
      if (!force) {
        const cur = (activeVideo ? activeVideo.currentTime : playbackCurrentTime) || 0;
        const dur = (activeVideo ? activeVideo.duration : playbackDuration) || 0;
        if (dur > 60) {
          const remaining = dur - cur;
          if (remaining > 90 && (cur / dur) < 0.85) {
            console.log(`[UpNext] Suppressed trigger at ${cur.toFixed(0)}s of ${dur.toFixed(0)}s (remaining: ${remaining.toFixed(0)}s)`);
            return;
          }
        } else if (cur < 900) {
          // If duration is unknown yet, suppress any trigger unless user has played for at least 15 minutes
          console.log(`[UpNext] Suppressed trigger at ${cur.toFixed(0)}s (duration unknown or <= 60s)`);
          return;
        }
      }

      const nextMeta = getNextEpMeta();
      if (!nextMeta || !upNextCard) return;

      upNextActive = true;
      if (upNextThumb) upNextThumb.src = nextMeta.still || a.image || '';
      if (upNextKicker) upNextKicker.textContent = `UP NEXT \u00B7 S${nextMeta.season} \u00B7 E${nextMeta.episode}`;
      if (upNextTitle) upNextTitle.textContent = nextMeta.name;
      if (upNextSub) upNextSub.textContent = 'STARTS IN 10s';
      if (upNextProgressFill) upNextProgressFill.style.width = '0%';

      upNextCard.classList.add('visible');
      upNextStartTime = performance.now();

      function tick(now) {
        if (!upNextActive) return;
        const elapsed = now - upNextStartTime;
        const pct = Math.min(100, (elapsed / UP_NEXT_DURATION_MS) * 100);
        if (upNextProgressFill) {
          upNextProgressFill.style.width = `${pct}%`;
        }
        const remainingSec = Math.max(1, Math.ceil((UP_NEXT_DURATION_MS - elapsed) / 1000));
        if (upNextSub) {
          upNextSub.textContent = `STARTS IN ${remainingSec}s`;
        }

        if (elapsed >= UP_NEXT_DURATION_MS) {
          playNextNow();
        } else {
          upNextAnimFrame = requestAnimationFrame(tick);
        }
      }
      upNextAnimFrame = requestAnimationFrame(tick);
    }

    if (upNextPlayBtn) {
      upNextPlayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        playNextNow();
      });
    }

    if (upNextCancelBtn) {
      upNextCancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cancelUpNext();
      });
    }


    // Handle Vidrift postMessages (Seamless auto-next & episode switching)
    function handleVidriftMessage(e) {
      if (e.origin !== 'https://embed.vidrift.net' && e.origin !== 'https://embed.vidrift.in' && e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || !d.type) return;

      if (d.type === 'vidrift:nextup') {
        triggerUpNext();
      } else if (d.type === 'vidrift:nextup-play') {
        playNextNow();
      } else if (d.type === 'vidrift:ended') {
        triggerUpNext(true);
      } else if (d.type === 'vidrift:fullscreen') {
        const shouldFs = !!d.on;
        if (shouldFs) {
          if (playerBox && !document.fullscreenElement) {
            playerBox.requestFullscreen().catch(() => {});
          }
          playerBox?.classList.add('is-fullscreen');
          if (window.desktopAPI?.setFullScreen) {
            window.desktopAPI.setFullScreen(true);
          }
        } else {
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          }
          playerBox?.classList.remove('is-fullscreen');
          if (window.desktopAPI?.setFullScreen) {
            window.desktopAPI.setFullScreen(false);
          }
        }
        if (activeIframe && activeIframe.contentWindow) {
          activeIframe.contentWindow.postMessage({
            type: 'vidrift:fullscreen-state',
            on: shouldFs,
          }, 'https://embed.vidrift.net');
        }
      } else if (d.type === 'vidrift:progress') {
        if (d.currentTime > 1) {
          savePlaybackProgress(d.currentTime, d.duration);
        }
      } else if (d.type === 'vidrift:episode') {
        if (d.episode && (d.episode !== currentEp || (d.season && d.season !== currentSeason))) {
          if (d.season && d.season !== currentSeason) {
            switchSeasonAndEpisode(d.season, d.episode);
          } else {
            switchEpisode(d.episode);
          }
        }
      }
    }
    window.addEventListener('message', handleVidriftMessage);

    function onFullscreenChange() {
      const isFs = !!document.fullscreenElement;
      if (playerBox) {
        playerBox.classList.toggle('is-fullscreen', isFs);
      }
      if (window.desktopAPI?.setFullScreen) {
        window.desktopAPI.setFullScreen(isFs);
      }
      if (activeIframe && activeIframe.contentWindow) {
        activeIframe.contentWindow.postMessage({
          type: 'vidrift:fullscreen-state',
          on: isFs,
        }, 'https://embed.vidrift.net');
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);

    // Global 'F' / 'f' Fullscreen Toggle
    function onFsKey(e) {
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
        const isFs = !!document.fullscreenElement || playerBox?.classList.contains('is-fullscreen');
        const nextFs = !isFs;
        if (nextFs) {
          if (playerBox) playerBox.requestFullscreen().catch(() => {});
          playerBox?.classList.add('is-fullscreen');
          if (window.desktopAPI?.setFullScreen) window.desktopAPI.setFullScreen(true);
        } else {
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          playerBox?.classList.remove('is-fullscreen');
          if (window.desktopAPI?.setFullScreen) window.desktopAPI.setFullScreen(false);
        }
        if (activeIframe && activeIframe.contentWindow) {
          activeIframe.contentWindow.postMessage({
            type: 'vidrift:fullscreen-state',
            on: nextFs,
          }, 'https://embed.vidrift.net');
        }
      }
    }
    window.addEventListener('keydown', onFsKey);
    cleanup.push(() => window.removeEventListener('keydown', onFsKey));

    async function switchSeasonAndEpisode(targetSeason, targetEp = 1) {
      cancelUpNext();
      upNextCancelled = false;
      if (targetSeason === currentSeason) {
        switchEpisode(targetEp);
        return;
      }
      if (activeVideo && activeVideo.currentTime > 1) {
        savePlaybackProgress(activeVideo.currentTime, activeVideo.duration);
      }
      showLoader(`Loading Season ${targetSeason}...`);

      currentSeason = targetSeason;
      viewingSeason = targetSeason;

      if (seasonSelector) {
        $$('.season-btn', seasonSelector).forEach((b) => b.classList.toggle('active', Number(b.dataset.seasonNum) === targetSeason));
      }
      if (episodesGrid) {
        episodesGrid.innerHTML = Array.from({ length: 6 }, () => '<div class="sk" style="height:110px;border-radius:8px;"></div>').join('');
      }

      try {
        const newEpData = await api(`/anime/${encodeURIComponent(a.id)}/episodes?season=${targetSeason}`, 60 * 60 * 1000);
        if (newEpData?.tmdbId) tmdbId = newEpData.tmdbId;
        let seasonEpisodes = (newEpData && newEpData.episodes && newEpData.episodes.length > 0) ? newEpData.episodes : [];
        if (targetSeason === detectedSeason && a.airing && availableEp < seasonEpisodes.length) {
          seasonEpisodes = seasonEpisodes.filter((e) => e.episode_number <= availableEp);
        }
        if (seasonEpisodes.length > 0) {
          episodes = seasonEpisodes;
        }
      } catch (err) {
        console.warn('[Player] Failed to load season episodes:', err);
      }

      switchEpisode(targetEp);
    }

    // Mark watched button
    if (markWatchedBtn) {
      markWatchedBtn.addEventListener('click', () => {
        const isNowWatched = !watched.has(currentEp);
        if (isNowWatched) {
          watched.add(currentEp);
          markWatchedBtn.classList.add('watched');
          markWatchedBtn.textContent = '✓ Watched';
        } else {
          watched.delete(currentEp);
          markWatchedBtn.classList.remove('watched');
          markWatchedBtn.textContent = 'Mark Watched';
        }
        try {
          localStorage.setItem(storageKeyWatched, JSON.stringify([...watched]));
        } catch {}
        if (episodesGrid && viewingSeason === currentSeason) {
          episodesGrid.innerHTML = renderEpisodeCardsHtml(episodes, currentEp, true, currentSeason);
          attachCardListeners(episodes, currentSeason);
        }
      });
    }

    function switchEpisode(epNum) {
      if (activeVideo && activeVideo.currentTime > 1) {
        savePlaybackProgress(activeVideo.currentTime, activeVideo.duration);
      }
      currentEp = epNum;
      viewingSeason = currentSeason;
      try {
        localStorage.setItem(`animeverse_season_${a.id}`, String(currentSeason));
        localStorage.setItem(`animeverse_ep_${a.id}`, String(currentEp));
      } catch {}

      const epObj = episodes.find((e) => e.episode_number === currentEp) || {
        episode_number: currentEp,
        name: `Episode ${currentEp}`,
      };

      if (seasonEpTag) seasonEpTag.textContent = `Season ${currentSeason} · E${currentEp}`;
      if (playerEpTitle) playerEpTitle.textContent = epObj.name || `Episode ${currentEp}`;

      // Sync Dub audio pill availability for this episode
      const epHasDub = epObj?.hasDub !== undefined ? epObj.hasDub : (epData?.dubCount ? currentEp <= epData.dubCount : false);
      const dubBtn = $('#dubAudioBtn', view);
      if (dubBtn) {
        dubBtn.classList.toggle('disabled', !epHasDub);
        dubBtn.title = epHasDub ? 'English Dub Available' : `Episode ${currentEp} is Japanese audio (Sub) only`;
      }

      const isWatched = watched.has(currentEp);
      if (markWatchedBtn) {
        markWatchedBtn.classList.toggle('watched', isWatched);
        markWatchedBtn.textContent = isWatched ? '✓ Watched' : 'Mark Watched';
      }

      // Re-mark playing card in grid and sync active season tab
      if (seasonSelector) {
        $$('.season-btn', seasonSelector).forEach((b) => b.classList.toggle('active', Number(b.dataset.seasonNum) === currentSeason));
      }
      if (episodesCountBadge) {
        episodesCountBadge.textContent = `${episodes.length} Episodes`;
      }
      if (episodesGrid) {
        episodesGrid.innerHTML = renderEpisodeCardsHtml(episodes, currentEp, true, currentSeason);
        attachCardListeners(episodes, currentSeason);
      }

      // Update URL silently without disrupting scroll or fullscreen
      window.history.replaceState({}, '', `/watch/${encodeURIComponent(a.id)}?season=${currentSeason}&ep=${currentEp}`);
      document.title = `Watch E${currentEp}: ${a.title} — AnimeVerse`;

      loadStream();
    }

    function attachCardListeners(cardList = episodes, cardSeason = viewingSeason) {
      if (!episodesGrid) return;

      $$('[data-ep-card]', episodesGrid).forEach((card) => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.episode-desc-toggle')) return;
          const epNum = Number(card.dataset.epCard);
          if (epNum !== currentEp || cardSeason !== currentSeason) {
            currentSeason = cardSeason;
            episodes = cardList;
            switchEpisode(epNum);
          }
        });
      });

      // Episode description MORE / LESS toggles
      $$('.episode-desc-toggle', episodesGrid).forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const epNum = btn.dataset.descToggle;
          const descEl = $(`#epDesc_${epNum}`, episodesGrid);
          if (descEl) {
            const isClamped = descEl.classList.toggle('clamped');
            btn.textContent = isClamped ? 'MORE' : 'LESS';
          }
        });
      });
    }

    attachCardListeners(episodes, currentSeason);

    // Season selector tabs
    if (seasonSelector) {
      $$('.season-btn', seasonSelector).forEach((btn) => {
        btn.addEventListener('click', async () => {
          const sNum = Number(btn.dataset.seasonNum);
          if (sNum === viewingSeason) return;

          viewingSeason = sNum;

          $$('.season-btn', seasonSelector).forEach((b) => b.classList.toggle('active', Number(b.dataset.seasonNum) === viewingSeason));

          if (episodesGrid) {
            episodesGrid.innerHTML = Array.from({ length: 6 }, () => '<div class="sk" style="height:110px;border-radius:8px;"></div>').join('');
          }

          const newEpData = await api(`/anime/${encodeURIComponent(a.id)}/episodes?season=${viewingSeason}`, 60 * 60 * 1000).catch(() => null);
          let seasonEpisodes = (newEpData && newEpData.episodes && newEpData.episodes.length > 0) ? newEpData.episodes : [];

          // Only filter available episodes for the detected airing season
          if (viewingSeason === detectedSeason && a.airing && availableEp < seasonEpisodes.length) {
            seasonEpisodes = seasonEpisodes.filter((e) => e.episode_number <= availableEp);
          }

          if (episodesCountBadge) {
            episodesCountBadge.textContent = `${seasonEpisodes.length} Episodes`;
          }

          if (episodesGrid) {
            const isPlayingThisSeason = viewingSeason === currentSeason;
            episodesGrid.innerHTML = renderEpisodeCardsHtml(seasonEpisodes, isPlayingThisSeason ? currentEp : -1, isPlayingThisSeason, viewingSeason);
            attachCardListeners(seasonEpisodes, viewingSeason);
          }
        });
      });
    }

    // Initialize playback immediately
    loadStream();
  }


  function relationsHtml(a) {
    // Seasons, movies and specials already appear in their own rows above.
    const inSeries = new Set([...(a.series?.seasons || []), ...(a.series?.extras || [])].map((x) => x.id));
    const rel = (a.relations || []).filter((r) => r.title && !(r.id && inSeries.has(r.id)));
    if (!rel.length) return '';
    const order = ['Prequel', 'Sequel', 'Parent story', 'Side story', 'Spin-off', 'Alternative version', 'Summary', 'Adaptation', 'Source'];
    const rank = (r) => (order.includes(r.relation) ? order.indexOf(r.relation) : order.length) + (r.id ? 0 : 50);
    rel.sort((x, y) => rank(x) - rank(y));
    return `
      <section class="row reveal related">
        <div class="row-head"><div><h2>Related</h2><p>Spin-offs, alternate versions and the original source</p></div></div>
        <div class="track-wrap">
          <button class="track-btn prev" aria-label="Scroll left" disabled>${icon.left}</button>
          <div class="track">${rel.map((r, i) => {
            const inner = `
              <div class="card-poster${r.image ? '' : ' no-img'}" data-title="${esc(r.title)}">
                <span class="pill card-tag rel-tag">${esc(r.relation)}</span>
                ${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : ''}
              </div>
              <h3 class="card-title">${esc(r.title)}</h3>
              <p class="card-sub">${esc([r.kind === 'manga' ? 'Manga' : r.format, r.year].filter(Boolean).join(' · ') || cap(r.kind || ''))}</p>`;
            return r.id
              ? `<a class="card" href="/anime/${esc(r.id)}" data-link style="--i:${i}">${inner}</a>`
              : `<div class="card is-static" style="--i:${i}">${inner}</div>`;
          }).join('')}</div>
          <button class="track-btn next" aria-label="Scroll right">${icon.right}</button>
        </div>
      </section>`;
  }

  function statsHtml(a) {
    const dist = (a.scoreDistribution || []).filter((d) => d.amount);
    const status = a.statusDistribution || [];
    if (!dist.length && !status.length) return '';
    const max = Math.max(...dist.map((d) => d.amount), 1);
    const totalRatings = dist.reduce((sum, d) => sum + d.amount, 0);
    const high = dist.filter((d) => d.score >= 80).reduce((sum, d) => sum + d.amount, 0);
    const totalStatus = status.reduce((sum, d) => sum + d.amount, 0) || 1;
    const cls = (d) => `st-${esc(d.status.replace(/\s/g, '').toLowerCase())}`;
    return `
      <section class="section reveal">
        <div class="panel fans">
          ${dist.length ? `
          <div class="fans-chart">
            <div class="fans-head">
              <h3>How fans rated it</h3>
              <p><b>${totalRatings ? Math.round((high / totalRatings) * 100) : 0}%</b> rated it 8 or higher · ${fmtNum(totalRatings)} ratings</p>
            </div>
            <div class="dist">${dist.map((d, i) => `
              <div class="dist-col" style="--h:${Math.max(4, Math.round((d.amount / max) * 100))}%;--i:${i}" title="${d.amount.toLocaleString()} ratings of ${d.score / 10}">
                <span class="dist-bar" style="--hue:${Math.round((d.score / 100) * 120)}"></span><small>${d.score / 10}</small>
              </div>`).join('')}
            </div>
          </div>` : ''}
          ${status.length ? `
          <div class="fans-status">
            <h3>What viewers are doing</h3>
            <div class="status-bar">${status.map((d) => `<span style="flex:${d.amount}" class="${cls(d)}" title="${esc(d.status)}: ${d.amount.toLocaleString()}"></span>`).join('')}</div>
            <ul class="status-list">${status.map((d, i) => `
              <li style="--i:${i}"><i class="${cls(d)}"></i><span>${esc(d.status)}</span><b>${fmtNum(d.amount)}</b><em>${Math.round((d.amount / totalStatus) * 100)}%</em></li>`).join('')}
            </ul>
          </div>` : ''}
        </div>
      </section>`;
  }

  function themesHtml(a) {
    if (!a.openings?.length && !a.endings?.length) return '';
    const list = (items) => items.slice(0, 6).map((t) => `<li>${esc(t.replace(/^\d+:\s*/, ''))}</li>`).join('');
    return `
      <section class="section reveal">
        <div class="info-layout">
          ${a.openings?.length ? `<div class="panel"><h3>Opening themes</h3><ol class="themes">${list(a.openings)}</ol></div>` : ''}
          ${a.endings?.length ? `<div class="panel"><h3>Ending themes</h3><ol class="themes">${list(a.endings)}</ol></div>` : ''}
        </div>
      </section>`;
  }

  async function detailPage(view, id) {
    view.innerHTML = `
      <div class="detail-hero"><div class="detail-grid">
        <div class="sk sk-poster"></div>
        <div><div class="sk" style="height:42px;width:60%"></div><div class="sk sk-line" style="width:40%"></div>
        <div class="sk" style="height:80px;width:100%;margin-top:28px"></div></div>
      </div></div>`;

    const a = await api(`/anime/${encodeURIComponent(id)}`, 30 * 60 * 1000);
    const meta = [a.type, a.year, a.episodes ? `${a.episodes} episodes` : null, a.duration, a.ageRating].filter(Boolean);
    const altTitles = [a.titleRomaji !== a.title ? a.titleRomaji : null, a.titleJapanese].filter(Boolean);
    const availableEp = getAvailableEpisodes(a);
    const lastEp = Math.min(Math.max(1, Number(localStorage.getItem(`animeverse_ep_${a.id}`) || 1)), availableEp || 1);
    const scorePct = a.score ? Math.round(a.score * 10) : 0;
    // Streambert-style header: what it is, then the series facts TMDB gives us.
    const kicker = a.type === 'Movie' ? 'Movie' : a.seasonCount ? 'Series' : a.type || 'Anime';
    // The server decides: a series' main entry gets TMDB's series poster (as on
    // the cards), a page for one particular season keeps that season's cover.
    const poster = a.tmdbPoster || a.image;
    const factLine = [
      ...factsOf(a, { long: true }),
      a.tmdbStatus || (a.status ? a.status.replace('Currently Airing', 'Airing').replace('Finished Airing', 'Ended') : null),
      a.duration,
    ].filter(Boolean);

    view.innerHTML = `
      <section class="detail-hero sb${a.backdrop ? ' has-art' : ''}">
        <div class="detail-bg${a.backdrop ? ' hd' : a.banner ? '' : ' blur'}" style="${artVars(a)}"></div>
        <div class="detail-grid">
          <div class="detail-poster"><img src="${esc(poster)}" alt="${esc(a.title)} poster" onerror="this.onerror=null;this.src='${esc(a.image)}'"></div>
          <div class="detail-main">
            <p class="sb-kicker">${esc(kicker)}${a.airing ? '<span class="sb-live">Airing</span>' : ''}</p>
            ${titleHtml(a)}
            ${altTitles.length ? `<p class="detail-alt">${altTitles.map(esc).join(' · ')}</p>` : '<span></span>'}
            <div class="sb-genres">${(a.genres || []).map((g) => `<a class="sb-chip" href="/browse?genre=${encodeURIComponent(g)}" data-link>${esc(g)}</a>`).join('')}</div>
            <div class="sb-meta">
              ${a.score ? `<span class="sb-score">${icon.star}<b data-count="${a.score}">${a.score.toFixed(1)}</b></span>` : ''}
              ${factLine.map((m) => `<span>${esc(m)}</span>`).join('')}
              ${langHtml(a)}
            </div>
            ${a.contentRating ? `<span class="sb-age">${icon.shield}${esc(a.contentRating)}</span>` : '<span></span>'}
            ${a.nextEpisode ? `<div class="countdown">${icon.clock}Episode ${a.nextEpisode.episode} airs in <b data-countdown="${a.nextEpisode.airingAt}">${formatCountdown(a.nextEpisode.airingAt - Date.now() / 1000)}</b></div>` : '<span></span>'}
            <div>
              <p class="synopsis clamped" id="synopsis">${esc(a.synopsis || 'No synopsis available yet.')}</p>
              <button class="link-btn" id="synMore" hidden>Read more</button>
              <div class="hero-actions">
                ${availableEp > 0 ? `
                  <a class="btn btn-primary btn-watch" href="/watch/${esc(a.id)}?season=${detectSeasonNumber(a.title, a.titleRomaji)}&ep=${lastEp}" data-link>
                    ${icon.play}${lastEp > 1 ? `Continue Ep ${lastEp}` : (a.type === 'Movie' ? 'Watch Movie' : 'Watch Episode 1')}
                  </a>` : `
                  <button class="btn btn-ghost" disabled style="opacity:0.6;cursor:not-allowed;">Not Yet Aired</button>`}
                ${a.trailer ? `<button class="btn btn-glass" data-trailer="${esc(a.trailer)}">${icon.spark}Trailer</button>` : ''}
                ${primaryStream(a) ? `<a class="btn btn-glass" href="${esc(primaryStream(a).url)}" target="_blank" rel="noopener">${icon.ext}Official: ${esc(primaryStream(a).name)}</a>` : ''}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="section sb-stats reveal">
        <div class="ratings">
          <div class="rating-box">
            <div class="label">${scoreLabel(a)} score</div>
            <div class="value">${a.score ? `${icon.star}<span>${a.score.toFixed(1)}</span><small>/10</small>` : '<small>Not rated yet</small>'}</div>
            ${a.score ? `<div class="rating-bar"><i style="width:${scorePct}%"></i></div>` : ''}
            ${a.scoredBy ? `<div class="foot">${fmtNum(a.scoredBy)} votes</div>` : ''}
          </div>
          ${a.imdb ? `
          <a class="rating-box imdb" href="https://www.imdb.com/title/${esc(a.imdb.id)}/" target="_blank" rel="noopener">
            <div class="label">IMDb</div>
            <div class="value">${icon.star}<span>${a.imdb.rating.toFixed(1)}</span><small>/10</small></div>
            <div class="rating-bar"><i style="width:${a.imdb.rating * 10}%"></i></div>
            ${a.imdb.votes ? `<div class="foot">${esc(a.imdb.votes)} votes</div>` : ''}
          </a>` : ''}
          ${a.rank ? `<div class="rating-box"><div class="label">Ranked</div><div class="value">#${a.rank.toLocaleString()}</div><div class="foot">all time</div></div>` : ''}
          ${a.members ? `<div class="rating-box"><div class="label">${a.source === 'jikan' ? 'Members' : 'Fans'}</div><div class="value">${fmtNum(a.members)}</div><div class="foot">${a.popularity ? `#${a.popularity} most popular` : 'tracking this'}</div></div>` : ''}
          ${a.seasonCount ? `<div class="rating-box"><div class="label">Series</div><div class="value">${a.seasonCount}<small>${a.seasonCount === 1 ? 'season' : 'seasons'}</small></div><div class="foot">${a.episodeCount ? `${a.episodeCount} episodes in total` : ''}</div></div>` : ''}
        </div>
      </section>


      ${languagesHtml(a)}
      ${relationsHtml(a)}
      ${statsHtml(a)}
      ${themesHtml(a)}



      <div id="extras"><div class="loader-row"><div class="spinner"></div></div></div>`;

    enhance(view);
    const syn = $('#synopsis', view);
    const more = $('#synMore', view);
    if (syn.scrollHeight > syn.clientHeight + 4) {
      more.hidden = false;
      more.addEventListener('click', () => {
        const open = syn.classList.toggle('clamped');
        more.textContent = open ? 'Read more' : 'Show less';
      });
    }
    countUp(view);
    loadExtras(view, id);
    return `${a.title} — AnimeVerse`;
  }

  async function loadExtras(view, id) {
    const box = $('#extras', view);
    try {
      const { characters, recommendations } = await api(`/anime/${encodeURIComponent(id)}/extras`, 30 * 60 * 1000);
      if (!box.isConnected) return;
      box.innerHTML = `
        ${characters.length ? `
        <section class="section reveal">
          <h2>Characters &amp; Voice Cast</h2>
          <div class="char-grid">${characters.map((c) => `
            <div class="char"><img src="${esc(c.image)}" alt="" loading="lazy"><div><strong>${esc(c.name)}</strong><span>${esc(c.role)}${c.voiceActor ? ` · ${esc(c.voiceActor)}` : ''}</span></div></div>`).join('')}
          </div>
        </section>` : ''}
        ${rowHtml({ title: 'You might also like', items: recommendations })}`;
      enhance(box);
    } catch {
      box.innerHTML = '';
    }
  }

  // Animate score numbers counting up.
  function countUp(root) {
    if (reduceMotion) return;
    $$('[data-count]', root).forEach((el) => {
      const target = Number(el.dataset.count);
      const t0 = performance.now();
      const dur = 1100;
      const tick = (t) => {
        const p = Math.min(1, (t - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = (target * eased).toFixed(1);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  let genresCache = null;
  async function browsePage(view, params) {
    const state = {
      q: params.get('q') || '',
      genre: params.get('genre') || '',
      type: params.get('type') || '',
      status: params.get('status') || '',
      order: params.get('order') || '',
      dub: params.get('dub') === '1' ? '1' : '',
    };
    const opt = (value, label, current) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;
    const titleFor = () =>
      state.q ? `Results for “${state.q}”` : state.dub ? 'English Dubbed Anime' : state.genre ? `${state.genre} Anime` : 'Browse Anime';

    view.innerHTML = `
      <div class="container page-top">
        <div class="browse-head">
          <div><h1 id="browseTitle">${esc(titleFor())}</h1><p id="browseSub">Filters update instantly. More titles load as you scroll.</p></div>
        </div>
        <form class="filters" id="filters" role="search" autocomplete="off">
          <div class="filter-q-wrap">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.2-4.2"/></svg>
            <input class="filter-q" name="q" type="search" placeholder="Search any anime title…" value="${esc(state.q)}" aria-label="Title">
            <span class="filter-q-spin" aria-hidden="true"></span>
          </div>
          <div class="select"><select name="genre" aria-label="Genre"><option value="">All genres</option>${state.genre ? opt(state.genre, state.genre, state.genre) : ''}</select></div>
          <div class="select"><select name="type" aria-label="Format">
            ${opt('', 'All formats', state.type)}${opt('tv', 'TV series', state.type)}${opt('movie', 'Movie', state.type)}${opt('ova', 'OVA', state.type)}${opt('ona', 'ONA', state.type)}${opt('special', 'Special', state.type)}
          </select></div>
          <div class="select"><select name="status" aria-label="Status">
            ${opt('', 'Any status', state.status)}${opt('airing', 'Airing', state.status)}${opt('finished', 'Finished', state.status)}${opt('upcoming', 'Upcoming', state.status)}
          </select></div>
          <div class="select"><select name="order" aria-label="Sort by">
            ${opt('', 'Best match / popular', state.order)}${opt('score', 'Highest rated', state.order)}${opt('popularity', 'Most popular', state.order)}${opt('newest', 'Newest', state.order)}${opt('title', 'A–Z', state.order)}
          </select></div>
          <button type="button" class="toggle${state.dub ? ' on' : ''}" id="dubToggle" aria-pressed="${Boolean(state.dub)}"><span class="box">${icon.check}</span>English dub only</button>
          <button type="button" class="reset-btn" id="resetFilters" hidden>Reset</button>
        </form>
        <div class="active-filters" id="activeFilters"></div>
        <div class="grid" id="grid">${skeletonCards(18)}</div>
        <div class="loader-row" id="sentinel"></div>
      </div>`;

    const form = $('#filters', view);
    const grid = $('#grid', view);
    const sentinel = $('#sentinel', view);
    const qInput = form.elements.q;
    const qWrap = $('.filter-q-wrap', view);
    $$('select', form).forEach(customSelect);

    (async () => {
      try {
        genresCache = genresCache || (await api('/genres', 24 * 3600 * 1000));
        const sel = form.elements.genre;
        sel.innerHTML = '<option value="">All genres</option>' + genresCache.map((g) => opt(g, g, state.genre)).join('');
        sel._cs?.refresh();
      } catch { /* genre list is optional */ }
    })();

    let page = 1;
    let loading = false;
    let done = false;
    let count = 0;
    const shown = new Set(); // a series can turn up on more than one page
    let generation = 0;
    let relaxed = false;

    const filterLabels = () => [
      state.genre && ['genre', state.genre],
      state.type && ['type', form.elements.type.selectedOptions[0]?.textContent || state.type],
      state.status && ['status', cap(state.status)],
      state.dub && ['dub', 'English dub'],
    ].filter(Boolean);

    // Update the URL, heading and chips in place, so the search box keeps focus while typing.
    const syncUi = () => {
      const qs = new URLSearchParams(Object.entries(state).filter(([, v]) => v));
      history.replaceState({}, '', `/browse${qs.toString() ? `?${qs}` : ''}`);
      $('#browseTitle', view).textContent = titleFor();
      document.title = `${titleFor()} — AnimeVerse`;
      $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (state.dub ? 'dubbed' : 'browse')));
      const chips = filterLabels();
      $('#activeFilters', view).innerHTML = chips
        .map(([k, label]) => `<button type="button" class="chip chip-x" data-clear="${k}">${esc(label)}${icon.x}</button>`)
        .join('');
      $('#resetFilters', view).hidden = !chips.length && !state.q && !state.order;
    };

    const restart = () => {
      generation += 1;
      page = 1;
      done = false;
      count = 0;
      shown.clear();
      relaxed = false;
      loading = false;
      grid.classList.add('refreshing');
      sentinel.innerHTML = '';
      // New filters start from the first result. Otherwise the shorter page leaves the
      // "load more" marker on screen and infinite scroll refetches pages back down to
      // where the user had scrolled.
      const stickyOffset = nav.offsetHeight + form.offsetHeight + 16;
      const resultsTop = Math.max(0, grid.getBoundingClientRect().top + window.scrollY - stickyOffset);
      if (window.scrollY > resultsTop) window.scrollTo({ top: resultsTop, behavior: 'instant' });
      syncUi();
      load();
    };

    const set = (patch) => {
      Object.assign(state, patch);
      restart();
    };

    form.addEventListener('change', (e) => {
      if (e.target.name && e.target.name !== 'q') set({ [e.target.name]: e.target.value });
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      clearTimeout(qTimer);
      if (qInput.value.trim() !== state.q) set({ q: qInput.value.trim() });
    });
    let qTimer;
    qInput.addEventListener('input', () => {
      clearTimeout(qTimer);
      const value = qInput.value.trim();
      qTimer = setTimeout(() => { if (value !== state.q) set({ q: value }); }, 450);
    });
    $('#dubToggle', view).addEventListener('click', (e) => {
      const on = !state.dub;
      e.currentTarget.classList.toggle('on', on);
      e.currentTarget.setAttribute('aria-pressed', String(on));
      set({ dub: on ? '1' : '' });
    });
    $('#activeFilters', view).addEventListener('click', (e) => {
      const btn = e.target.closest('[data-clear]');
      if (!btn) return;
      const key = btn.dataset.clear;
      if (key === 'dub') { $('#dubToggle', view).classList.remove('on'); }
      else { form.elements[key].value = ''; form.elements[key]._cs?.refresh(); }
      set({ [key]: '' });
    });
    $('#resetFilters', view).addEventListener('click', () => {
      form.reset();
      qInput.value = '';
      [...form.querySelectorAll('select')].forEach((s) => { s.value = ''; s._cs?.refresh(); });
      $('#dubToggle', view).classList.remove('on');
      set({ q: '', genre: '', type: '', status: '', order: '', dub: '' });
    });

    const fetchPage = (s, p) => {
      const qs = new URLSearchParams(Object.entries({ ...s, page: p }).filter(([, v]) => v));
      return api(`/search?${qs}`);
    };

    const load = async () => {
      if (loading || done) return;
      const gen = generation;
      loading = true;
      qWrap.classList.add('busy');
      if (page > 1) sentinel.innerHTML = '<div class="spinner"></div>';
      try {
        let res = await fetchPage(relaxed ? { ...state, genre: '', type: '', status: '' } : state, page);
        if (gen !== generation || !grid.isConnected) return;

        // A title search that finds nothing inside the filters retries across all of them.
        if (page === 1 && !res.items.length && state.q && (state.genre || state.type || state.status)) {
          relaxed = true;
          res = await fetchPage({ ...state, genre: '', type: '', status: '' }, 1);
          if (gen !== generation) return;
        }

        if (page === 1) {
          grid.innerHTML = '';
          grid.classList.remove('refreshing');
          $('#browseSub', view).innerHTML = relaxed && res.items.length
            ? `Nothing matched “${esc(state.q)}” with your filters, so these results cover <b>all genres and formats</b>.`
            : 'Filters update instantly. More titles load as you scroll.';
        }
        const fresh = res.items.filter((a) => !shown.has(a.group || a.id) && shown.add(a.group || a.id));
        grid.insertAdjacentHTML('beforeend', fresh.map((a, i) => cardHtml(a, i)).join(''));
        enhance(grid);
        count += fresh.length;
        done = !res.hasNext;
        page += 1;
        if (done) {
          sentinel.innerHTML = count
            ? '<span class="end-note">You’ve reached the end.</span>'
            : `<div class="state empty-state"><div class="empty-art" aria-hidden="true">(・_・;)</div><h2>No anime found</h2><p>${state.q ? `Nothing matches “${esc(state.q)}”. Check the spelling or try the English or Japanese title.` : 'Try loosening the filters.'}</p></div>`;
        } else {
          sentinel.innerHTML = '';
          if (sentinel.getBoundingClientRect().top < window.innerHeight + 1600) setTimeout(load, 50);
        }
      } catch (err) {
        if (gen !== generation) return;
        if (page === 1) { grid.innerHTML = ''; grid.classList.remove('refreshing'); }
        sentinel.innerHTML = `<div class="state empty-state"><h2>Couldn’t load anime</h2><p>${esc(err.message)}</p><button class="btn btn-plain" id="retry">Try again</button></div>`;
        $('#retry', sentinel)?.addEventListener('click', load);
      } finally {
        if (gen === generation) {
          loading = false;
          qWrap.classList.remove('busy');
        }
      }
    };

    const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) load(); }, { rootMargin: '1600px 0px' });
    io.observe(sentinel);
    cleanup.push(() => io.disconnect());
    syncUi();
    load();
    if (state.q === '' && params.get('focus') === '1') qInput.focus();
    return `${titleFor()} — AnimeVerse`;
  }

  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  async function schedulePage(view, params) {
    const today = DAYS[new Date().getDay()];
    let day = DAYS.includes(params.get('day')) ? params.get('day') : today;
    const dates = DAYS.map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return d;
    });
    view.innerHTML = `
      <div class="container page-top">
        <div class="browse-head"><div><h1>Release Schedule</h1><p>New episodes this week, shown in your local time.</p></div></div>
        <div class="days" role="tablist" aria-label="Day">
          <span class="day-pill" aria-hidden="true"></span>
          ${dates.map((d) => {
            const name = DAYS[d.getDay()];
            return `<button class="day" role="tab" aria-selected="${name === day}" data-day="${name}">
              <small>${name === today ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' })}</small>
              <strong>${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</strong>
              <em class="day-count" data-count-for="${name}"></em></button>`;
          }).join('')}
        </div>
        <div class="timeline" id="timeline" role="tabpanel"></div>
      </div>`;

    const tabs = $('.days', view);
    const pill = $('.day-pill', view);
    const timeline = $('#timeline', view);
    let seq = 0;

    // The orange pill glides between days instead of the whole page re-rendering.
    const movePill = (instant) => {
      const btn = $(`.day[data-day="${day}"]`, tabs);
      $$('.day', tabs).forEach((b) => {
        const on = b === btn;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
      });
      pill.style.transition = instant ? 'none' : '';
      pill.style.width = `${btn.offsetWidth}px`;
      pill.style.height = `${btn.offsetHeight}px`;
      pill.style.transform = `translate(${btn.offsetLeft}px, ${btn.offsetTop}px)`;
      btn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: instant || reduceMotion ? 'auto' : 'smooth' });
    };

    const skeleton = () => Array.from({ length: 5 }, (_, i) =>
      `<div class="slot slot-sk" style="--i:${i}"><span class="sk" style="height:20px;width:60px"></span><span class="sk" style="width:64px;height:88px"></span><div><span class="sk" style="height:16px;width:55%;display:block"></span><span class="sk" style="height:12px;width:30%;display:block;margin-top:10px"></span></div></div>`).join('');

    const slotsHtml = (list) => {
      const now = Date.now() / 1000;
      const sorted = [...list].sort((x, y) => (x.nextEpisode?.airingAt || 9e9) - (y.nextEpisode?.airingAt || 9e9));
      if (!sorted.length) return '<div class="state empty-state"><div class="empty-art" aria-hidden="true">(￣o￣) zzZ</div><h2>Nothing scheduled</h2><p>No episodes are listed for this day yet.</p></div>';
      let nowMarked = false;
      return sorted.map((a, i) => {
        const at = a.nextEpisode?.airingAt;
        const time = at ? new Date(at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
        const past = at && at < now;
        let marker = '';
        if (!past && !nowMarked && day === today && i > 0) {
          nowMarked = true;
          marker = `<div class="now-line" style="--i:${i}"><span>Now · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>`;
        }
        return `${marker}
          <a class="slot${past ? ' past' : ''}" href="/anime/${esc(a.id)}" data-link style="--i:${i}">
            <time>${time}</time>
            <span class="slot-img${a.image ? '' : ' no-img'}">${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy">` : ''}</span>
            <div><h3>${esc(a.title)}</h3><div class="meta">${scoreHtml(a)}${langHtml(a)}${a.type ? `<span>${esc(a.type)}</span>` : ''}${a.broadcast ? `<span>${esc(a.broadcast)}</span>` : ''}</div></div>
            ${a.nextEpisode ? `<div class="ep">EP ${a.nextEpisode.episode}<small>${past ? `${icon.check} Released` : `<span data-countdown="${at}">${formatCountdown(at - now)}</span>`}</small></div>` : '<span></span>'}
          </a>`;
      }).join('');
    };

    const show = async (dir = 0) => {
      const mine = ++seq;
      movePill(dir === 0);
      const key = `/schedule/${day}`;
      const cached = memo.get(key);
      if (!cached) {
        timeline.classList.add('swap');
        timeline.innerHTML = skeleton();
      }
      try {
        const list = await api(key, 30 * 60 * 1000);
        if (mine !== seq || !timeline.isConnected) return;
        timeline.style.setProperty('--dir', dir < 0 ? '-1' : '1');
        timeline.classList.remove('swap');
        void timeline.offsetWidth;
        timeline.classList.add('swap');
        timeline.innerHTML = slotsHtml(list);
        const badge = $(`[data-count-for="${day}"]`, tabs);
        if (badge) badge.textContent = list.length;
        enhance(timeline);
      } catch (err) {
        if (mine !== seq) return;
        timeline.innerHTML = `<div class="state empty-state"><h2>Couldn’t load the schedule</h2><p>${esc(err.message)}</p><button class="btn btn-plain" id="retrySched">Try again</button></div>`;
        $('#retrySched', timeline).addEventListener('click', () => show());
      }
    };

    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.day');
      if (!btn || btn.dataset.day === day) return;
      const order = $$('.day', tabs).map((b) => b.dataset.day);
      const dir = order.indexOf(btn.dataset.day) > order.indexOf(day) ? 1 : -1;
      day = btn.dataset.day;
      history.replaceState({}, '', `/schedule?day=${day}`);
      show(dir);
    });
    tabs.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const btns = $$('.day', tabs);
      const i = btns.findIndex((b) => b.dataset.day === day) + (e.key === 'ArrowRight' ? 1 : -1);
      if (btns[i]) { btns[i].click(); btns[i].focus(); }
    });
    const onResize = () => movePill(true);
    window.addEventListener('resize', onResize);
    cleanup.push(() => window.removeEventListener('resize', onResize));

    requestAnimationFrame(() => movePill(true));
    await show();
    // Warm the other days in the background so switching is instant.
    (async () => {
      for (const d of DAYS) {
        if (d === day || !view.isConnected) continue;
        try {
          const list = await api(`/schedule/${d}`, 30 * 60 * 1000);
          const badge = $(`[data-count-for="${d}"]`, tabs);
          if (badge) badge.textContent = list.length;
        } catch { /* background warm-up only */ }
      }
    })();
    return `Schedule — AnimeVerse`;
  }

  // Thin loading bar at the top of the window during page changes.
  const progress = (() => {
    const bar = document.getElementById('routeProgress');
    let timer = null;
    return {
      start() {
        clearTimeout(timer);
        bar.className = 'route-progress';
        void bar.offsetWidth;
        bar.classList.add('run');
      },
      done() {
        bar.classList.add('done');
        timer = setTimeout(() => { bar.className = 'route-progress'; }, 500);
      },
    };
  })();

  // ---------- Router ----------
  const cleanup = [];
  let renderToken = 0;

  const routes = [
    { re: /^\/$/, nav: 'home', run: (v) => homePage(v) },
    { re: /^\/watch\/((?:al)?\d+)\/?$/, nav: null, run: (v, m, p) => watchPage(v, m[1], p) },
    { re: /^\/anime\/((?:al)?\d+)\/?$/, nav: null, run: (v, m) => detailPage(v, m[1]) },
    { re: /^\/browse\/?$/, nav: 'browse', run: (v, m, p) => browsePage(v, p) },
    { re: /^\/schedule\/?$/, nav: 'schedule', run: (v, m, p) => schedulePage(v, p) },
    // Player for licensed streams (public/player.js).
    { re: /^\/player\/([\w-]{1,40})\/?$/, nav: null, run: (v, m, p) => window.AVPlayer.mount(v, m[1], p, (fn) => cleanup.push(fn)) },
  ];

  // Going back restores where you were on the previous page.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  async function render({ keepScroll = false, restoreY = null } = {}) {
    const token = ++renderToken;
    cleanup.splice(0).forEach((fn) => fn());
    heroCtl?.destroy();
    heroCtl = null;

    const path = location.pathname;
    const params = new URLSearchParams(location.search);
    const route = routes.find((r) => r.re.test(path));
    const navKey = route?.nav === 'browse' && params.get('dub') === '1' ? 'dubbed' : route?.nav;
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === navKey));
    $('.nav-links').classList.remove('open');
    $('#menuBtn').setAttribute('aria-expanded', 'false');

    progress.start();
    const old = $('.page', app);
    if (old && !keepScroll && !reduceMotion) {
      old.classList.add('leaving');
      await new Promise((r) => setTimeout(r, 160));
      if (token !== renderToken) return;
    }

    const view = document.createElement('div');
    view.className = 'page';
    app.replaceChildren(view);
    if (!keepScroll) window.scrollTo({ top: 0, behavior: 'instant' });
    updateNav();

    if (!route) {
      view.innerHTML = `<div class="state"><h2>Page not found</h2><p>That page doesn’t exist.</p><a class="btn btn-primary" href="/" data-link>Go home</a></div>`;
      document.title = 'Not found — AnimeVerse';
      return;
    }
    try {
      const title = await route.run(view, path.match(route.re), params);
      if (token === renderToken && title) document.title = title;
      if (token === renderToken) {
        progress.done();
        if (restoreY != null) requestAnimationFrame(() => window.scrollTo({ top: restoreY, behavior: 'instant' }));
      }
    } catch (err) {
      if (token === renderToken) progress.done();
      if (token !== renderToken) return;
      console.error(err);
      view.innerHTML = `<div class="state"><h2>Something went wrong</h2><p>${esc(err.message)}</p><button class="btn btn-primary" id="retryPage">Try again</button></div>`;
      $('#retryPage', view).addEventListener('click', () => { memo.clear(); render(); });
    }
  }

  function navigate(url, { replace = false, keepScroll = false } = {}) {
    window.__isAppNavigation = true;
    const target = new URL(url, location.origin);
    if (target.pathname + target.search === location.pathname + location.search && !replace) {
      window.__isAppNavigation = false;
      return;
    }
    if (!replace) history.replaceState({ ...(history.state || {}), scroll: window.scrollY }, '');
    history[replace ? 'replaceState' : 'pushState'](replace ? history.state : {}, '', target.pathname + target.search);
    render({ keepScroll });
    setTimeout(() => { window.__isAppNavigation = false; }, 200);
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    closeSearch();
    navigate(a.getAttribute('href'));
  });
  window.addEventListener('popstate', (e) => render({ restoreY: e.state?.scroll ?? null }));

  // Solid nav once the page scrolls.
  const toTop = document.getElementById('toTop');
  function updateNav() {
    nav.classList.toggle('solid', window.scrollY > 40 || !$('.hero, .detail-hero', app));
    toTop.classList.toggle('show', window.scrollY > 900);
  }
  toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));
  window.addEventListener('scroll', updateNav, { passive: true });

  $('#menuBtn').addEventListener('click', (e) => {
    const open = $('.nav-links').classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });

  // ---------- Search overlay ----------
  const overlay = document.getElementById('searchOverlay');
  const input = document.getElementById('searchInput');
  const results = document.getElementById('searchResults');
  const searchBar = $('.search-bar', overlay);
  const RECENT_KEY = 'av-recent-searches';
  let searchTimer;
  let searchSeq = 0;
  let selIndex = -1;
  let lastQuery = '';

  const readRecent = () => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
  };
  const saveRecent = (q) => {
    try {
      const list = [q, ...readRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 6);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch { /* storage may be blocked */ }
  };

  // Wraps the matched part of a title in <mark> for a highlight sweep.
  function highlight(text, q) {
    const safe = esc(text);
    if (!q) return safe;
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return safe;
    return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
  }

  async function renderSearchHome() {
    const recent = readRecent();
    let trending = [];
    try { trending = (await api('/home', 10 * 60 * 1000)).trending.slice(0, 6); } catch { /* optional */ }
    if (input.value.trim()) return;
    results.innerHTML = `
      ${recent.length ? `
        <div class="search-group"><div class="search-group-head"><span>Recent searches</span><button class="link-mini" id="clearRecent">Clear</button></div>
        <div class="search-chips">${recent.map((q, i) => `<button class="chip" data-q="${esc(q)}" style="--i:${i}">${icon.clock}${esc(q)}</button>`).join('')}</div></div>` : ''}
      ${trending.length ? `
        <div class="search-group"><div class="search-group-head"><span>Trending now</span></div>
        ${trending.map((a, i) => resultHtml(a, i, '')).join('')}</div>` : '<p class="search-empty">Start typing to search every anime on MyAnimeList and AniList.</p>'}`;
    enhance(results);
    selIndex = -1;
    $('#clearRecent', results)?.addEventListener('click', () => {
      try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
      renderSearchHome();
    });
  }

  function resultHtml(a, i, q) {
    return `
      <a class="result" href="/anime/${esc(a.id)}" data-link style="--i:${i}">
        <span class="result-img${a.image ? '' : ' no-img'}">${a.image ? `<img src="${esc(a.image)}" alt="" loading="eager" decoding="async" onload="this.classList.add('loaded')" onerror="this.parentElement.classList.add('no-img');this.remove();">` : ''}</span>
        <div><strong>${highlight(a.title, q)}</strong>
          <div class="meta">${scoreHtml(a)}${langHtml(a)}${factsOf(a).map((m) => `<span>${esc(m)}</span>`).join('<i class="sep"></i>')}</div>
          ${a.titleRomaji && a.titleRomaji !== a.title ? `<div class="alt">${highlight(a.titleRomaji, q)}</div>` : ''}
        </div>
        <span class="result-go">${icon.right}</span>
      </a>`;
  }

  function openSearch() {
    overlay.hidden = false;
    overlay.classList.remove('closing');
    document.body.style.overflow = 'hidden';
    selIndex = -1;
    if (!input.value.trim()) renderSearchHome();
    requestAnimationFrame(() => { input.focus(); input.select(); });
    heroCtl?.pause();
  }
  function closeSearch() {
    if (overlay.hidden || overlay.classList.contains('closing')) return;
    overlay.classList.add('closing');
    setTimeout(() => {
      overlay.hidden = true;
      overlay.classList.remove('closing');
    }, reduceMotion ? 0 : 200);
    document.body.style.overflow = '';
    heroCtl?.resume();
  }

  async function runSearch(q) {
    const seq = ++searchSeq;
    if (!q) { searchBar.classList.remove('busy'); renderSearchHome(); return; }
    if (q.length < 2) return;
    searchBar.classList.add('busy');
    // Keep the previous results on screen (dimmed) instead of flashing a spinner.
    if ($('.result', results) && lastQuery) results.classList.add('stale');
    else results.innerHTML = Array.from({ length: 5 }, () => '<div class="result-sk"><span class="sk"></span><div><span class="sk"></span><span class="sk"></span></div></div>').join('');
    try {
      const res = await api(`/search?q=${encodeURIComponent(q)}`);
      if (seq !== searchSeq) return;
      lastQuery = q;
      const items = res.items.slice(0, 10);
      selIndex = -1;
      results.innerHTML = items.length
        ? `<div class="search-group-head"><span>Top matches</span></div>${items.map((a, i) => resultHtml(a, i, q)).join('')}
           <a class="search-all" href="/browse?q=${encodeURIComponent(q)}" data-link>See all results for “${esc(q)}” ${icon.right}</a>`
        : `<div class="search-empty"><div class="empty-art" aria-hidden="true">(・_・;)</div><strong>No anime found for “${esc(q)}”</strong><p>Try the English or Japanese title, or fewer words.</p></div>`;
      enhance(results);
    } catch (err) {
      if (seq === searchSeq) results.innerHTML = `<p class="search-empty">${esc(err.message)}</p>`;
    } finally {
      if (seq === searchSeq) {
        searchBar.classList.remove('busy');
        results.classList.remove('stale');
      }
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(input.value.trim()), 300);
  });
  input.addEventListener('keydown', (e) => {
    const items = $$('.result', results);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      selIndex = (selIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((el, i) => el.classList.toggle('sel', i === selIndex));
      items[selIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      if (q) saveRecent(q);
      if (items[selIndex]) items[selIndex].click();
      else if (q) { closeSearch(); navigate(`/browse?q=${encodeURIComponent(q)}`); }
    }
  });
  results.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-q]');
    if (chip) {
      input.value = chip.dataset.q;
      input.focus();
      runSearch(chip.dataset.q);
      return;
    }
    if (e.target.closest('.result, .search-all') && input.value.trim()) saveRecent(input.value.trim());
  });
  $('#searchClear', overlay).addEventListener('click', () => {
    input.value = '';
    input.focus();
    runSearch('');
  });
  document.getElementById('searchOpen').addEventListener('click', openSearch);
  document.getElementById('searchClose').addEventListener('click', closeSearch);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSearch(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!modal.hidden) closeTrailer();
      else closeSearch();
      return;
    }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (e.key === '/' && !typing && overlay.hidden) {
      e.preventDefault();
      openSearch();
    }
  });

  // ---------- Scroll Hover Glitch Fix: disables pointer-events during active scrolling ----------
  let isScrollingTimer = null;
  window.addEventListener('scroll', () => {
    if (!document.body.classList.contains('is-scrolling')) {
      document.body.classList.add('is-scrolling');
    }
    clearTimeout(isScrollingTimer);
    isScrollingTimer = setTimeout(() => {
      document.body.classList.remove('is-scrolling');
    }, 120);
  }, { passive: true });

  // ---------- Nav search hint: cycles through trending titles without wasting network calls ----------
  (async () => {
    try {
      const defaultHints = ['Jujutsu Kaisen', 'Demon Slayer', 'Solo Leveling', 'Attack on Titan', 'One Piece', 'Chainsaw Man'];
      let names = defaultHints;
      // Only fetch /home if on home page or already cached in memory to save backend requests
      const cachedHome = memo.get('/home');
      if (cachedHome && cachedHome.trending && cachedHome.trending.length > 0) {
        names = cachedHome.trending.slice(0, 8).map((a) => a.title);
      } else if (location.pathname === '/') {
        const homeData = await api('/home', 10 * 60 * 1000);
        if (homeData && homeData.trending && homeData.trending.length > 0) {
          names = homeData.trending.slice(0, 8).map((a) => a.title);
        }
      }
      const el = document.getElementById('searchHint');
      if (!el || !names.length || reduceMotion) return;
      let i = 0;
      setInterval(() => {
        if (document.hidden || !overlay.hidden) return;
        el.classList.add('out');
        setTimeout(() => {
          el.textContent = `Try “${names[i++ % names.length]}”`;
          el.classList.remove('out');
        }, 260);
      }, 4200);
    } catch { /* hint stays static */ }
  })();

  // ---------- Footer status (cached in sessionStorage to eliminate redundant network hits) ----------
  (() => {
    const renderStatus = (s) => {
      const el = $('#footerStatus');
      if (!el || !s || !s.provider) return;
      const prov = s.provider.active === 'jikan' ? 'MyAnimeList (backup source)' : 'AniList';
      el.textContent = `Live data: ${prov} · artwork: TMDB · ${(s.dubs?.dubbed || 0).toLocaleString()} dubbed titles tracked${s.imdb === 'enabled' ? ' · IMDb ratings on' : ''}`;
    };
    try {
      const cached = sessionStorage.getItem('animeverse_status_cache');
      if (cached) {
        renderStatus(JSON.parse(cached));
        return;
      }
    } catch {}
    fetch(`${API_BASE}/api/status`)
      .then((r) => r.json())
      .then((s) => {
        try { sessionStorage.setItem('animeverse_status_cache', JSON.stringify(s)); } catch {}
        renderStatus(s);
      })
      .catch(() => {});
  })();

  // Home data refreshes on its own: re-render quietly every 30 minutes if the user is on the home page.
  setInterval(() => {
    if (location.pathname === '/' && !document.hidden && window.scrollY < 50) {
      memo.delete('/home');
      render({ keepScroll: true });
    }
  }, 30 * 60 * 1000);

  render();
})();
