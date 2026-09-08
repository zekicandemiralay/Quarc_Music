import { API_BASE } from './apiUrl';

// A share link has to point at the SERVER, not at wherever the app happens
// to be running from. In the Android app the frontend is bundled locally, so
// window.location.origin is capacitor://localhost — a link nobody else can
// open. API_BASE is the real server origin there, and empty on the web
// (where window.location.origin is already correct).
export function songShareUrl(songId) {
  const origin = API_BASE || window.location.origin;
  return `${origin}/?share=${songId}`;
}

// Copy that still works inside the Android WebView: navigator.clipboard needs
// a secure context and can simply reject there, and with no @capacitor/share
// plugin installed navigator.share is undefined — so previously the whole
// thing failed silently and nothing was ever put on the clipboard.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through to the legacy path
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    el.setSelectionRange(0, text.length); // iOS needs an explicit range
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

// Returns 'shared' | 'copied' | null so callers can give the right feedback.
export async function shareSong(song) {
  if (!song) return null;
  const url = songShareUrl(song.id);
  const title = song.artist ? `${song.title} — ${song.artist}` : song.title;

  if (navigator.share) {
    try {
      await navigator.share({ title: 'Quarc Music', text: title, url });
      return 'shared';
    } catch {
      return null; // user dismissed the sheet — don't also copy behind their back
    }
  }
  return (await copyText(url)) ? 'copied' : null;
}
