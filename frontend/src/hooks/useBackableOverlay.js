import { useEffect, useRef } from 'react';

// Makes a full-screen overlay (Now Playing, Queue, Lyrics — anything rendered
// via createPortal on top of the routed page) respond to the back gesture/
// button instead of the page underneath it.
//
// These overlays are plain component state (a boolean), not a route — so as
// far as the browser/WebView is concerned, the "current page" while one is
// open is still whatever page is underneath. Android's back gesture (and the
// hardware back button) triggers the WebView's default history.back(), which
// happens to the underlying router with zero awareness the overlay exists —
// so swiping back navigates the page *behind* the overlay while the overlay
// stays visually open on top of it, fully interactive and now showing stale
// content next to whatever the background page navigated to. Confirmed to
// reproduce on Android; the same bug is latent on any platform that maps a
// back action to history.back() (iOS Safari's edge-swipel, browser Back).
//
// Fix: push a no-op history entry while the overlay is open, and treat a
// 'popstate' (any back action) as "close the overlay", not "let the router
// navigate" — the URL never actually changes, so there's nothing for the
// router to navigate to. Closing the overlay through its own UI (the X
// button, swipe-to-dismiss) consumes that pushed entry via history.back()
// in cleanup, so the history stack stays exactly as if the overlay had
// never touched it.
export default function useBackableOverlay(isOpen, onClose) {
  const pushedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    window.history.pushState({ quarcOverlay: true }, '');
    pushedRef.current = true;

    const onPopState = () => {
      pushedRef.current = false; // already consumed by the browser/OS itself
      onCloseRef.current();
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      window.removeEventListener('popstate', onPopState);
      // Closed via the overlay's own UI, not the back gesture — pop the
      // entry we pushed so back-button behavior is correct for whatever
      // comes next, without leaving an extra no-op back-press behind.
      if (pushedRef.current) {
        pushedRef.current = false;
        window.history.back();
      }
    };
  }, [isOpen]);
}
