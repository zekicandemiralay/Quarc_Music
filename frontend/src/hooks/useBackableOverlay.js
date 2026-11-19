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
// Pass the WHOLE group at once, in base-to-top order (e.g. [expanded,
// queue, lyrics] — Lyrics/Queue can be opened while Now Playing stays open
// underneath them, layering on top of it). Tracks the NUMBER of currently-
// open overlays (not just whether any are open) and keeps that many history
// entries pushed, so:
//  - opening a second overlay on top of an already-open one pushes one more
//    entry, and a single back-press only closes the topmost one, revealing
//    the one underneath — not both at once.
//  - switching directly between overlays (closing one, opening a different
//    one, in the same instant) leaves the open-count unchanged, so no
//    history operation happens for that transition at all. This matters:
//    history.back()'s effects aren't synchronous, so if that transition
//    *did* pop-then-push, a push landing before the pop resolves makes the
//    pop consume the wrong (newly-pushed) entry — a spurious popstate that
//    immediately closes whatever had just opened. Confirmed reproducing on
//    iPhone from exactly that transition; WebKit's timing apparently hits
//    this race where Chromium (Android) didn't.
//
// One more trap, the reason for `ownPopRef`: when an overlay is closed from
// the UI (its X / back arrow) rather than by a back gesture, we remove its
// history entry ourselves with history.go(-n) — and the browser answers that
// with a `popstate` exactly like it would for a real back press. The handler
// below can't tell them apart by looking at the stack, so with TWO overlays
// open (player + queue), closing the queue from its own button made our own
// history.back() look like a user back-press and closed the player underneath
// it as well. (With only one overlay the old `pushedCount <= 0` check happened
// to swallow it, which is why this only showed up when they were stacked.)
// So every pop WE trigger is recorded, and the matching popstate is ignored.
export default function useBackableOverlay(overlays) {
  const pushedCountRef = useRef(0);
  const ownPopRef = useRef({ n: 0, expires: 0 }); // popstates we caused and must ignore
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;

  const openCount = overlays.filter((o) => o.isOpen).length;

  useEffect(() => {
    while (pushedCountRef.current < openCount) {
      window.history.pushState({ quarcOverlay: true }, '');
      pushedCountRef.current++;
    }
    const excess = pushedCountRef.current - openCount;
    if (excess > 0) {
      pushedCountRef.current = openCount;
      // One traversal = one popstate, however many entries it removes — unlike
      // N back() calls in a row, whose event count differs between engines.
      // Expiry guards against a popstate that never arrives leaving a stale
      // "ignore" behind that would swallow a genuine back press later.
      const now = Date.now();
      const prev = ownPopRef.current;
      ownPopRef.current = { n: (prev.n > 0 && now < prev.expires ? prev.n : 0) + 1, expires: now + 1500 };
      window.history.go(-excess);
    }
  }, [openCount]);

  useEffect(() => {
    const onPopState = () => {
      const own = ownPopRef.current;
      if (own.n > 0 && Date.now() < own.expires) { own.n--; return; } // our own pop, not the user's
      own.n = 0;
      if (pushedCountRef.current <= 0) return; // not ours to handle
      pushedCountRef.current--;
      // Close only the topmost currently-open overlay — the LAST one in
      // the array that's open, since the array is given in base-to-top
      // order and only the top layer should close on one back-press.
      const list = overlaysRef.current;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].isOpen) { list[i].onClose(); break; }
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
}
