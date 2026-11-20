// lrclib.net client — free, keyless, community-sourced lyrics DB (both plain
// and LRC-format synced text). No official rate limit is published, but a
// descriptive User-Agent is requested courtesy, and the backfill script
// throttles itself so a whole-library run doesn't hammer a free service.
const LRCLIB_BASE = 'https://lrclib.net/api';
const USER_AGENT = 'QuarcMusic/1.0 (+https://github.com/zekicandemiralay/Quarc_Music)';

// Shared with the Last.fm suggestions lookup — see services/textClean.js
// for why downloaded songs' tags need cleaning before any outside lookup.
const { cleanTitle, matchTitle, cleanArtist, primaryArtist } = require('./textClean');

// A free community service: if it hasn't answered in this long it is not going
// to, and the person who opened the lyrics panel is watching a spinner.
const REQUEST_TIMEOUT_MS = 6000;

// How far a candidate's length may be from our file's before we stop believing
// it is the same recording.
//   SYNC_TOLERANCE_S — synced (time-stamped) lines are only worth showing if
//     they were timed against a recording this close to ours; a longer intro
//     or a different edit shifts every line, and wrongly-timed karaoke
//     highlighting is worse than none. Plain text has no such problem.
//   same artist + same title but a very different length is a different cut
//     (a medley, a live version) — the words may differ too, so skip it.
//   a DIFFERENT artist (cover, remix, mislabelled upload) must be much closer
//     in length, because it has less else going for it.
const SYNC_TOLERANCE_S = 5;
const sameArtistTolerance = (dur) => Math.max(30, dur * 0.25);
const otherArtistTolerance = (dur) => Math.max(15, dur * 0.12);

// "Couldn't ask" is not "there are no lyrics". lrclib being down, rate-limiting
// us or timing out used to be indistinguishable from a 404 and got saved as
// not_found forever. Callers must NOT cache this.
class LyricsUnavailableError extends Error {
  constructor(message) { super(message); this.name = 'LyricsUnavailableError'; }
}

async function getJson(path, params) {
  const url = `${LRCLIB_BASE}${path}?${new URLSearchParams(params)}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    throw new LyricsUnavailableError(`${path}: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`);
  }
  // 404 is lrclib's definitive "no such track"; 400 means it rejected our query
  // outright (e.g. a blank artist) — retrying the same query can't help either.
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new LyricsUnavailableError(`${path}: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new LyricsUnavailableError(`${path}: unreadable response`);
  }
}

// --- comparing titles and artists -------------------------------------------
// textClean.normalizeWords is shared with other services and strips every
// non-ASCII letter, so a Cyrillic/Greek/CJK title normalises to NOTHING — and
// "nothing" equals "nothing", which would make any two such titles match. These
// keep Unicode letters, and are for equality checks only.
function key(s) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ARTIST_STOPWORDS = new Set(['the', 'and', 'feat', 'ft', 'with', 'x']);
const artistTokens = (s) => new Set(key(s).split(' ').filter((w) => w && !ARTIST_STOPWORDS.has(w)));

const GENERIC_ARTIST = /^(various( artists?)?|unknown( artist)?|va|n\/?a|none|artist)$/i;

// Share of the smaller name's words that the other contains: "Queen" vs
// "Queen & David Bowie" is a match, "The Xx" vs "The Beatles" is not.
function artistOverlap(a, b) {
  const A = artistTokens(a); const B = artistTokens(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size);
}

// A title as comparable keys. YouTube uploads often read "Artist - Title" (or
// "Title - Artist"), so when one side of a dash is the artist, the other side
// is ALSO a valid reading of the title.
function titleKeys(rawTitle, artistName) {
  const keys = new Set();
  const whole = key(matchTitle(rawTitle));
  if (whole) keys.add(whole);
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(cleanTitle(rawTitle));
  if (m && artistName) {
    const [, left, right] = m;
    if (artistOverlap(left, artistName) >= 0.5) { const k = key(matchTitle(right)); if (k) keys.add(k); }
    if (artistOverlap(right, artistName) >= 0.5) { const k = key(matchTitle(left)); if (k) keys.add(k); }
  }
  return keys;
}

// Enough of a title to be believable ON ITS OWN. "Home", "Love", "Intro" and
// "Hallelujah" name hundreds of unrelated songs; with no artist to go on, a
// title like that proves nothing.
const isDistinctive = (titleKey) => !!titleKey && titleKey.split(' ').length >= 2 && titleKey.length >= 12;

function plainFromSynced(synced) {
  return (synced || '').split('\n').map((l) => l.replace(/\[[^\]]*\]/g, '').trim()).filter(Boolean).join('\n') || null;
}

// Decides whether one lrclib record is acceptable for OUR song, and in what
// form. Returns null (reject) or
//   { level: 2, status: 'found', plain, synced, delta }        — this recording
//   { level: 1, status: 'approximate', plain, synced: null }   — same-named song,
//     different recording; plain text only, since another recording's timing
//     won't line up with this audio
//   { level: 0, status: 'instrumental' }                       — held aside
// `trusted` records came back from /get, which already matched title+artist on
// lrclib's side.
function classify(c, q, trusted) {
  const aOk = trusted || (q.artistKnown && artistOverlap(q.artist, c.artistName) >= 0.5);
  const aPartial = q.artistKnown && artistOverlap(q.artist, c.artistName) > 0;

  let titleKey = null;
  if (!trusted) {
    const candKeys = titleKeys(c.trackName, q.artistKnown ? q.artist : c.artistName);
    titleKey = [...q.titleKeys].find((k) => candKeys.has(k));
    if (!titleKey) return null;
  }

  const dKnown = q.duration > 0 && c.duration > 0;
  const delta = dKnown ? Math.abs(c.duration - q.duration) : null;

  if (c.instrumental) return aOk ? { level: 0, status: 'instrumental', plain: null, synced: null } : null;

  const syncedOk = c.syncedLyrics && (!dKnown || delta <= SYNC_TOLERANCE_S);
  const synced = syncedOk ? c.syncedLyrics : null;
  // A record whose only text is time-stamped still gives plain lyrics when its
  // timing is out of range for our file.
  const plain = c.plainLyrics || plainFromSynced(c.syncedLyrics);
  if (!plain && !synced) return null;

  if (aOk) {
    if (dKnown && delta > sameArtistTolerance(q.duration)) return null;
    return { level: 2, status: 'found', plain, synced, delta };
  }

  // The artist didn't match. Either we have none to compare (a "Various
  // Artists" tag), in which case a distinctive title AND a near-identical
  // length is good evidence of the same recording...
  if (!q.artistKnown && dKnown && delta <= SYNC_TOLERANCE_S && isDistinctive(titleKey)) {
    return { level: 2, status: 'found', plain, synced, delta };
  }
  // ...or it's a cover/remix/mislabelled upload: same title, similar length,
  // plain text only, and the title must be distinctive (or the artist at least
  // partly agree) — otherwise it is just some other song with that name.
  if ((aPartial || isDistinctive(titleKey)) && (!dKnown || delta <= otherArtistTolerance(q.duration))) {
    return { level: 1, status: 'approximate', plain, synced: null, delta };
  }
  return null;
}

// Higher level wins; then a usable synced version; then the closest length.
function better(a, b) {
  if (a.level !== b.level) return a.level > b.level;
  if (!!a.synced !== !!b.synced) return !!a.synced;
  return (a.delta ?? 0) < (b.delta ?? 0);
}

// artist/title/album come from the song's own tags; durationSecs (if known)
// lets us tell the same recording from a different cut of the same song.
//
// Resolves to { status, plain, synced }, or null when lrclib definitively has
// nothing usable. Throws LyricsUnavailableError when lrclib could not be asked
// and nothing good enough was found without it — a "no lyrics" answer is only
// returned when every lookup that could have found some actually completed.
async function fetchLyrics(artist, title, album, durationSecs) {
  if (!title) return null;
  const cleanT = cleanTitle(title);
  const cleanA = cleanArtist(artist);
  const primary = primaryArtist(artist);
  const artistKnown = !!primary && !GENERIC_ARTIST.test(primary.trim());

  const q = {
    artist: primary,
    artistKnown,
    duration: Number(durationSecs) || 0,
    titleKeys: titleKeys(title, artistKnown ? primary : ''),
  };
  // "Queen - Bohemian Rhapsody" is searched as "Bohemian Rhapsody".
  const searchTitle = (() => {
    const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(cleanT);
    if (m && artistKnown) {
      if (artistOverlap(m[1], primary) >= 0.5) return m[2].trim();
      if (artistOverlap(m[2], primary) >= 0.5) return m[1].trim();
    }
    return cleanT;
  })();

  let transient = false;
  let best = null;
  let instrumental = null;
  const attempt = async (fn) => {
    try { return await fn(); } catch (err) {
      if (err instanceof LyricsUnavailableError) { transient = true; return null; }
      throw err;
    }
  };
  const consider = (records, trusted) => {
    for (const c of (Array.isArray(records) ? records : [records])) {
      if (!c) continue;
      const r = classify(c, q, trusted);
      if (!r) continue;
      if (r.level === 0) { instrumental = instrumental || r; continue; }
      if (!best || better(r, best)) best = r;
    }
  };
  const result = (r) => ({ status: r.status, plain: r.plain, synced: r.synced });

  // 1. Exact signature match (lrclib also checks the length to within ±2s).
  const params = { track_name: searchTitle, artist_name: cleanA || '' };
  if (album) params.album_name = album;
  if (q.duration) params.duration = Math.round(q.duration);
  consider(await attempt(() => getJson('/get', params)), true);
  if (best && best.level === 2) return result(best);

  // 2. Search by title + artist — our tags are sometimes messier than a
  //    curated lyrics DB expects (feat. credits, "(Official Audio)"...). Every
  //    hit is checked (title, artist, length) instead of trusting the first.
  if (artistKnown) {
    consider(await attempt(() => getJson('/search', { track_name: searchTitle, artist_name: primary })), false);
    if (best && best.level === 2) return result(best);
  }

  // 3. Title-only search: a cover, remix or mislabelled upload isn't in lrclib
  //    under its own attribution, but the song's words may be.
  consider(await attempt(() => getJson('/search', { track_name: searchTitle })), false);
  if (best && best.level === 2) return result(best);

  // Only same-title look-alikes (or nothing) so far. If any lookup could not
  // complete, that verdict is not final — don't let it be stored as one.
  if (transient) throw new LyricsUnavailableError('lrclib could not be reached');
  if (best) return result(best);
  return instrumental ? { status: 'instrumental', plain: null, synced: null } : null;
}

// --- cached lookup -----------------------------------------------------------
// Two people (or two taps) asking for the same uncached song at once share one
// trip to lrclib instead of making two.
const inflight = new Map();

// The lyrics for a song row: the cached verdict if there is one, otherwise ask
// lrclib and cache the answer — but ONLY a definitive one. LyricsUnavailableError
// propagates and nothing is written, so the next request tries again.
// `force` skips the cache (e.g. lyrics were added to lrclib since last time).
async function resolveSongLyrics(db, song, { force = false } = {}) {
  if (!force && song.lyrics_status) {
    return { status: song.lyrics_status, plain: song.lyrics_plain, synced: song.lyrics_synced };
  }
  let pending = inflight.get(song.id);
  if (!pending) {
    pending = (async () => {
      const result = await fetchLyrics(song.artist, song.title, song.album, song.duration);
      const out = { status: result?.status || 'not_found', plain: result?.plain || null, synced: result?.synced || null };
      db.prepare('UPDATE songs SET lyrics_status = ?, lyrics_plain = ?, lyrics_synced = ? WHERE id = ?')
        .run(out.status, out.plain, out.synced, song.id);
      return out;
    })().finally(() => inflight.delete(song.id));
    inflight.set(song.id, pending);
  }
  return pending;
}

module.exports = { fetchLyrics, resolveSongLyrics, LyricsUnavailableError };
