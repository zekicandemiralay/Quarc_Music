// YouTube Music's own "radio" queue — the endless mix its player builds when
// you start a song. This is Google's recommender, trained on vastly more
// listening data than Last.fm's scrobble base, and its coverage of non-Anglo
// catalogues is in a different league: for "Elbet Birgün Buluşacağız" (Zeki
// Müren), where track.getSimilar returns literally nothing, this returns
// Nilüfer, Emel Sayın, Müzeyyen Senar, Ferdi Özbeğen — the actual Turkish
// sanat müziği canon. See routes/radio.js, which falls back to Last.fm when
// this comes up empty.
//
// It talks to InnerTube, the private API music.youtube.com's own web player
// uses. No API key, no OAuth, no account: the client identifies itself purely
// through the context block below. Being private, it can change without
// notice — which is why Last.fm is kept underneath rather than deleted, and
// why every parse here is defensive rather than assuming a shape.
//
// Deliberately NOT routed through the VPN, matching searchYoutube() in
// ytdlp.js: this is a metadata lookup, not extraction — no bandwidth, no
// video data, and nothing yt-dlp's proxy exists to protect. Routing it
// through gluetun would make radio suggestions break whenever the tunnel is
// down (they currently don't), and shared VPN exit IPs are *more* likely to
// be bot-flagged than the server's own, not less. Every user search already
// reaches YouTube from this IP, so this adds no exposure that isn't there.
const { cleanTitle, primaryArtist, normalizeWords, wordOverlap } = require('./textClean');

const BASE = 'https://music.youtube.com/youtubei/v1';

// Client version is what InnerTube checks; it's the web player's own build
// string. It doesn't need to be current to the day, but a wildly stale one
// can start getting rejected — if this file ever stops returning results,
// this is the first thing to bump.
const CLIENT = {
  clientName: 'WEB_REMIX',
  clientVersion: '1.20240101.01.00',
  hl: 'en',
  gl: 'US',
};

const HEADERS = {
  'Content-Type': 'application/json',
  Referer: 'https://music.youtube.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'X-Goog-Api-Format-Version': '1',
  'X-YouTube-Client-Name': '67', // WEB_REMIX
  'X-YouTube-Client-Version': CLIENT.clientVersion,
};

// Radio is filling a queue in the background — it must never be the thing
// that makes a request hang. Better to give up and let Last.fm answer.
const TIMEOUT_MS = 10000;

// Restricts search to actual songs, excluding albums, artists, playlists and
// user-uploaded videos. Opaque protobuf, taken as-is; it is sent in this
// percent-encoded form (which is what the web client itself sends).
const SONGS_FILTER = 'EgWKAQIIAWoKEAoQAxAEEAkQBQ%3D%3D';

async function innertube(endpoint, body) {
  const res = await fetch(`${BASE}/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ context: { client: CLIENT }, ...body }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`InnerTube ${endpoint} ${res.status}`);
  return res.json();
}

// InnerTube responses are deeply nested renderer trees whose exact shape
// varies by result type and changes over time. Walking for the renderer we
// want is far more durable than indexing a fixed path.
function collect(node, key, out = []) {
  if (Array.isArray(node)) {
    for (const v of node) collect(v, key, out);
  } else if (node && typeof node === 'object') {
    if (node[key]) out.push(node[key]);
    for (const v of Object.values(node)) collect(v, key, out);
  }
  return out;
}

function runsText(container) {
  return (container?.runs || []).map((r) => r.text).join('');
}

// The byline is "Artist • Album • 3:45" flattened into runs; the first entry
// is the artist. Separator runs are literal " • " strings.
function bylineArtist(renderer) {
  const byline = renderer.longBylineText || renderer.shortBylineText;
  const parts = (byline?.runs || [])
    .map((r) => r.text)
    .filter((t) => t && t.trim() && t.trim() !== '•');
  return parts[0] || null;
}

// A search hit has to actually be the song we asked for. YouTube Music never
// returns "no results" — ask it for gibberish and it will hand back ocean-wave
// recordings with total confidence, and a radio built on that seed is 49
// unrelated tracks that look perfectly valid on the way out. Anything below
// the bar is treated as "not found" so the caller falls back to Last.fm
// instead of streaming nonsense.
const MIN_MATCH = 0.5;
const MIN_TITLE_MATCH = 0.5; // the title alone must be plausible — a shared
                             // artist can't carry an unrelated song

function matchScore(wantArtist, wantTitle, gotArtist, gotTitle) {
  const titleScore = wordOverlap(normalizeWords(wantTitle), normalizeWords(gotTitle));
  if (titleScore < MIN_TITLE_MATCH) return 0;
  const artistScore = wordOverlap(normalizeWords(wantArtist), normalizeWords(gotArtist));
  // Title carries most of the weight: our artist tag is the field most often
  // wrong on a downloaded file (a channel name, every credited writer), so
  // failing a good title match on it would reject real songs.
  return titleScore * 0.75 + artistScore * 0.25;
}

// The first flex column is the track title; the second is the byline.
function itemTitle(item) {
  const col = item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer;
  return runsText(col?.text);
}

// Find the videoId for a song we only know by name. Radio needs a seed video,
// and our library songs carry tags, not YouTube ids.
async function findVideoId(artist, title) {
  // Search on the cleaned tags: upload noise ("(Official Video)") and a
  // comma-joined writer credit both drag the query off the real song.
  const wantTitle = cleanTitle(title);
  const wantArtist = primaryArtist(artist);
  const query = wantArtist ? `${wantArtist} ${wantTitle}` : wantTitle;

  const data = await innertube('search', { query, params: SONGS_FILTER });

  let best = null;
  for (const item of collect(data, 'musicResponsiveListItemRenderer').slice(0, 5)) {
    const [id] = collect(item, 'videoId');
    if (!id) continue;
    const score = matchScore(wantArtist, wantTitle, bylineArtist(item), itemTitle(item));
    if (!best || score > best.score) best = { id, score };
  }
  return best && best.score >= MIN_MATCH ? best.id : null;
}

// The radio queue for a seed video. RDAMVM<id> is YouTube Music's own naming
// for "radio based on this track".
async function radioQueue(videoId) {
  const data = await innertube('next', {
    videoId,
    playlistId: `RDAMVM${videoId}`,
    isAudioOnly: true,
  });

  const tracks = [];
  for (const r of collect(data, 'playlistPanelVideoRenderer')) {
    const title = runsText(r.title);
    const artist = bylineArtist(r);
    if (!r.videoId || !title) continue;
    tracks.push({ videoId: r.videoId, title, artist });
  }
  return tracks;
}

// Suggestions similar to one song. Returns [] rather than throwing so the
// caller can simply fall through to Last.fm.
//
// videoId, when the caller already has one, skips the search hop entirely —
// and every track returned carries its own, so downloading a suggestion never
// has to guess which YouTube upload was meant. That removes the whole class
// of artist/title matching problems from the download path.
async function relatedTracks(artist, title, videoId = null) {
  try {
    const seed = videoId || (await findVideoId(artist, title));
    if (!seed) return [];
    const tracks = await radioQueue(seed);
    // The queue always opens with the seed itself.
    return tracks.filter((t) => t.videoId !== seed);
  } catch {
    return [];
  }
}

module.exports = { relatedTracks, findVideoId, radioQueue };
