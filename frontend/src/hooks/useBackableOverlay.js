import { useEffect, useRef } from 'react';

// Makes a group of full-screen overlays (Now Playing, Queue, Lyrics —
// anything rendered via createPortal on top of the routed page) respond to
// the back gesture/button instead of the page underneath them.
//
// These overlays are plain component state (booleans), not routes — so as
// far as the browser/WebView is concerned, the "current page" while one is
// open is still whatever page is underneath. Android's back gesture (and the
// hardware back button) triggers the WebView's default history.back(), which
// happens to the underlying router with zero awareness the overlay exists —
// so swiping back navigates the page *behind* the overlay while the overlay
// stays visually open on top of it. Not actually Android-specific in cause;
// any platform that maps a back action to history.back() has the same
// latent bug (desktop browser back button, iOS Safari edge-swipe).
//
// Takes the WHOLE group at once (not one hook per overlay) and reacts to
// "is ANY of them open" as a single aggregate signal — this matters because
// switching directly from one overlay to another (e.g. tapping Lyrics from
// inside the expanded player, which does onClose() then onOpenLyrics() in
// the same instant) must NOT pop then push a history entry: history.back()'s
// effects aren't synchronous, so a push landing before the pop actually
// resolves makes the pop consume the WRONG (newly pushed) entry, firing a
// spurious popstate that immediately closes whatever had just opened.
// Confirmed reproducing on iPhone from exactly that transition. Tracking
// "any open" instead means switching between overlays changes nothing about
// that aggregate (still true throughout), so no history operation happens
// at all mid-transition — only a genuine none-open <-> something-open edge
// pushes or pops.
export default function useBackableOverlay(overlays) {
  const pushedRef = useRef(false);
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;

  const anyOpen = overlays.some((o) => o.isOpen);

  useEffect(() => {
    if (anyOpen && !pushedRef.current) {
      window.history.pushState({ quarcOverlay: true }, '');
      pushedRef.current = true;
    } else if (!anyOpen && pushedRef.current) {
      pushedRef.current = false;
      window.history.back();
    }
  }, [anyOpen]);

  useEffect(() => {
    const onPopState = () => {
      if (!pushedRef.current) return; // this popstate wasn't ours to handle
      pushedRef.current = false;
      for (const o of overlaysRef.current) {
        if (o.isOpen) o.onClose();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
}
