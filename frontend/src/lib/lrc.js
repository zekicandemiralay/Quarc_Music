// Parses LRC-format synced lyrics ("[mm:ss.xx] text" per line, optionally
// several timestamp tags on one line) into a time-sorted [{ time, text }] array.
export function parseLrc(lrc) {
  if (!lrc) return [];
  const timeTag = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const out = [];
  for (const line of lrc.split('\n')) {
    const tags = [...line.matchAll(timeTag)];
    if (!tags.length) continue;
    const text = line.replace(timeTag, '').trim();
    for (const m of tags) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] ? parseFloat(`0.${m[3]}`) : 0;
      out.push({ time: min * 60 + sec + frac, text });
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

// Index of the line that should be highlighted at the given playback time —
// the last line whose timestamp has already passed. -1 before the first line.
export function activeLrcIndex(lines, currentTime) {
  let lo = 0, hi = lines.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= currentTime) { idx = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return idx;
}
