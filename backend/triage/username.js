// backend/triage/username.js
// Sherlock-style public account-presence check for a username.
//
// AUTHORIZED USE ONLY. This checks whether a username exists on public sites
// by requesting public profile URLs -- the same thing a browser does. It is
// gated behind the caller's authorization assertion (see index.js) and is
// intended for abuse/fraud investigation and self/client exposure audits, not
// for tracking or profiling private individuals.

const TIMEOUT_MS = 12000;
const CONCURRENCY = 6;

// Each site: how to build the URL and how to read "exists".
// detect: 'status' -> HTTP 200 means present, 404 means absent.
//         'absence' -> present unless the response body contains `absent`.
const SITES = [
  { name: 'GitHub', url: (u) => `https://github.com/${u}`, detect: 'status' },
  { name: 'GitLab', url: (u) => `https://gitlab.com/${u}`, detect: 'status' },
  { name: 'Reddit', url: (u) => `https://www.reddit.com/user/${u}/about.json`, detect: 'status' },
  { name: 'Instagram', url: (u) => `https://www.instagram.com/${u}/`, detect: 'status' },
  { name: 'X/Twitter', url: (u) => `https://twitter.com/${u}`, detect: 'status' },
  { name: 'TikTok', url: (u) => `https://www.tiktok.com/@${u}`, detect: 'status' },
  { name: 'Pinterest', url: (u) => `https://www.pinterest.com/${u}/`, detect: 'status' },
  { name: 'Telegram', url: (u) => `https://t.me/${u}`, detect: 'absence', absent: "If you have Telegram" },
  { name: 'Steam', url: (u) => `https://steamcommunity.com/id/${u}`, detect: 'absence', absent: 'The specified profile could not be found' },
  { name: 'Twitch', url: (u) => `https://m.twitch.tv/${u}`, detect: 'status' },
  { name: 'Medium', url: (u) => `https://medium.com/@${u}`, detect: 'status' },
  { name: 'Patreon', url: (u) => `https://www.patreon.com/${u}`, detect: 'status' },
  { name: 'Vimeo', url: (u) => `https://vimeo.com/${u}`, detect: 'status' },
  { name: 'SoundCloud', url: (u) => `https://soundcloud.com/${u}`, detect: 'status' },
  { name: 'DeviantArt', url: (u) => `https://www.deviantart.com/${u}`, detect: 'status' },
  { name: 'Keybase', url: (u) => `https://keybase.io/${u}`, detect: 'status' },
  { name: 'Dev.to', url: (u) => `https://dev.to/${u}`, detect: 'status' },
  { name: 'Replit', url: (u) => `https://replit.com/@${u}`, detect: 'status' },
  { name: 'HackerNews', url: (u) => `https://news.ycombinator.com/user?id=${u}`, detect: 'absence', absent: 'No such user.' },
  { name: 'Gravatar', url: (u) => `https://gravatar.com/${u}`, detect: 'status' },
];

const USERNAME_RE = /^[A-Za-z0-9._-]{1,40}$/;

// Statuses that mean "the site blocked/limited us", not a real answer.
const BLOCKED_STATUS = new Set([401, 403, 405, 429, 500, 502, 503, 520, 521, 522]);

async function checkSite(site, username) {
  const url = site.url(username);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (compatible; ai-phone-system-triage/1.0; authorized-osint)',
      },
    });

    // A bot-wall / rate-limit / server error is never a reliable signal.
    if (BLOCKED_STATUS.has(resp.status)) {
      return { site: site.name, url, present: null, reason: 'blocked', http: resp.status };
    }

    if (site.detect === 'status') {
      if (resp.status === 200) return { site: site.name, url, present: true };
      if (resp.status === 404 || resp.status === 410) {
        return { site: site.name, url, present: false };
      }
      return { site: site.name, url, present: null, reason: 'inconclusive', http: resp.status };
    }

    // Absence detection: only trust a clean 200 with a real body. Without
    // resp.ok a missing marker string must NOT be read as "found".
    if (!resp.ok) {
      return { site: site.name, url, present: null, reason: 'inconclusive', http: resp.status };
    }
    const body = await resp.text();
    if (body.length < 200) {
      return { site: site.name, url, present: null, reason: 'empty_body', http: resp.status };
    }
    const present = !body.includes(site.absent);
    return { site: site.name, url, present };
  } catch (err) {
    return { site: site.name, url, present: null, reason: 'error', error: err.name || err.message };
  } finally {
    clearTimeout(t);
  }
}

// Simple concurrency-limited map.
async function pooledMap(items, worker, limit) {
  const results = new Array(items.length);
  let i = 0;
  async function next() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

async function check(username) {
  if (!USERNAME_RE.test(String(username || ''))) {
    return { status: 'error', reason: 'invalid username format' };
  }
  const results = await pooledMap(
    SITES,
    (s) => checkSite(s, username),
    CONCURRENCY
  );
  const found = results.filter((r) => r.present === true);
  const absent = results.filter((r) => r.present === false);
  const unknown = results.filter((r) => r.present === null);
  return {
    status: 'ok',
    username,
    checked: results.length,
    foundCount: found.length,
    absentCount: absent.length,
    unknownCount: unknown.length,
    found,
    all: results,
    note:
      'Presence means a public profile URL resolves for this handle. ' +
      '"unknown" means the site blocked us or was inconclusive (not absence). ' +
      'Same handle across sites does not prove the same person.',
  };
}

module.exports = { check, SITES };
