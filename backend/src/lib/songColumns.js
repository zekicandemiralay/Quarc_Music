// What a song looks like when the API hands a LIST of them to a client.
//
// `SELECT s.*` was shipping every column, and two of them are enormous:
// lyrics_plain and lyrics_synced hold the full text of a song, several
// kilobytes each. Across a library of a few thousand tracks that is the
// entire lyrics corpus on the wire every single time the library loads —
// and the frontend never reads either field, because lyrics come from
// GET /api/music/:id/lyrics when the panel is actually opened.
//
// It isn't only waste. The library response is cached in localStorage so
// the app works offline, localStorage caps out around 5MB per origin, and
// the write is wrapped in a silent try/catch — so once the lyrics pushed
// the payload past the quota, the cache stopped being written at all, with
// no error anywhere. Offline then had nothing to show.
//
// filepath is excluded for a different reason: it is a server-side path
// that no client has any use for, and there's no reason to describe the
// server's filesystem layout to every logged-in device.
//
// Single-song lookups (WHERE id = ?) deliberately still use SELECT * —
// one row is cheap and some callers want the whole record.
const SONG_LIST_COLUMNS = [
  's.id', 's.filename', 's.title', 's.artist', 's.album',
  's.duration', 's.track', 's.year', 's.has_cover', 's.added_at',
  's.genre', 's.lyrics_status', 's.video_id',
].join(', ');

module.exports = { SONG_LIST_COLUMNS };
