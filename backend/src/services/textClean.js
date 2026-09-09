// Cleaning song tags before handing them to an outside music service
// (lrclib for lyrics, Last.fm for similar-track suggestions).
//
// Tags on downloaded songs come from the YouTube video they were pulled
// from, so they carry things no music database has: "(Official Video)",
// "[Lyrics]", "(Remastered 2011)", channel names like "QueenVEVO" or
// "Radiohead - Topic", and artist fields listing every credited writer
// rather than the performer. Left as-is those lookups simply miss.
//
// Everything here is for MATCHING ONLY — the song's stored tags are never
// modified, so the library keeps showing exactly what it always showed.

const NOISE_WORD = /^(official|officiel|video|videoclip|audio|music|lyric|lyrics|visualizer|mv|hd|hq|4k|8k|remaster|remastered|clip|explicit|sub|subtitulado|legendado|\d{4})$/i;

// Drops (...) / [...] groups whose contents are ENTIRELY noise, so
// "(Official Video)" goes but "(feat. Dre)" or "(Acoustic)" stay.
function stripNoiseGroups(text) {
  return text.replace(/[([{][^)\]}]*[)\]}]/g, (group) => {
    const inner = group.slice(1, -1).split(/[\s,\-|/]+/).filter(Boolean);
    if (!inner.length) return '';
    return inner.every((w) => NOISE_WORD.test(w.replace(/[^\w]/g, ''))) ? '' : group;
  });
}

function cleanTitle(title) {
  const cleaned = stripNoiseGroups(title || '')
    // trailing "| Official Video" / "- Lyrics" style tails
    .replace(/\s*[|·–—-]\s*(official\s*)?(music\s*)?(video|audio|lyrics?|visualizer|mv)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    // trailing bare noise not inside brackets: "Song HD", "Song Official"
    .replace(/(\s+(official|video|audio|lyrics?|hd|hq|4k|8k|mv|remastered))+$/i, '')
    .trim();
  return cleaned || (title || ''); // never clean a title away entirely
}

function cleanArtist(artist) {
  const cleaned = (artist || '')
    .replace(/(official|vevo)\s*$/i, '') // glued-on channel suffix: "QueenVEVO"
    .replace(/\b(official|vevo)\b/ig, '') // separate word: "Queen Official"
    .replace(/\s*-\s*topic\s*$/i, '') // YouTube's auto-generated artist channels
    .replace(/\s*[-–|]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || (artist || '');
}

// The first credited name only. Artist tags routinely list several people —
// performer plus composer/lyricist ("Zeki Müren, M. Seyran"), or featured
// guests — but a similar-track lookup wants ONE artist. Given the whole
// joined string, Last.fm matches no artist at all and returns nothing.
function primaryArtist(artist) {
  return cleanArtist(
    (artist || '')
      .split(/\s*(?:,|;|\/|&|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bx\b)\s*/i)[0]
      .trim()
  );
}

// Word-overlap scoring, shared by every "did this outside service actually
// find the song we asked for?" check. Deliberately crude — it compares words,
// not order or spelling — because the failure it guards against is not a near
// miss, it's a service confidently returning something unrelated.
function normalizeWords(s) {
  return (s || '')
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function wordOverlap(wordsA, wordsB) {
  if (!wordsA.length) return 0;
  const setB = new Set(wordsB);
  return wordsA.filter((w) => setB.has(w)).length / wordsA.length;
}

module.exports = { cleanTitle, cleanArtist, primaryArtist, normalizeWords, wordOverlap };
