import { useCallback, useEffect, useRef } from 'react';

// Swipe-to-change-song for the player: swipe LEFT for the next song, RIGHT for
// the previous one (the Spotify gesture).
//
//   const { zoneRef, moverRef } = useSwipeNav({ enabled, onNext, onPrev });
//   <div ref={zoneRef}>          ← where touches are listened for
//     <div ref={moverRef}>…</div> ← what follows the finger and slides away/in
//   </div>
//
// onNext / onPrev perform the skip and return true if the song actually changed.
// When it did, the old content has already slid out and the new one slides in
// from the opposite side; when it didn't (end of the queue, nothing to go back
// to) the content just bounces back — the gesture was understood but there is
// nowhere to go.
//
// Only a mostly-horizontal drag is ours. After ~8px the gesture is locked to one
// axis, and a vertical one is left completely alone — the expanded player's
// swipe-down-to-close uses it, and so does scrolling.
//
// The mover is styled directly on the DOM node instead of through React state:
// dragging re-rendering the whole player 60 times a second would stutter.
// (Which also means the element must not have its own `style` transform/opacity
// in JSX — React would fight over it.)

const SLOP_PX = 8;            // movement before the gesture picks an axis
const COMMIT_PX = 64;         // far enough to count as "change song"…
const COMMIT_FRACTION = 0.18; // …or this share of the zone's width, whichever is larger
const FLICK_MIN_PX = 28;      // a quick flick counts even if short…
const FLICK_PX_PER_MS = 0.45; // …as long as it is this fast
const OUT_MS = 140;
const IN_MS = 200;
const BACK_MS = 200;
const CLICK_GUARD_MS = 350;   // swallow the click a browser may still fire after a swipe

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export default function useSwipeNav({ enabled = true, onNext, onPrev }) {
  const moverRef = useRef(null);
  const live = useRef({ enabled, onNext, onPrev });
  live.current = { enabled, onNext, onPrev };
  const s = useRef({ cleanup: null, g: null, busy: false, timers: [], lastSwipe: -Infinity }).current;

  const setMover = (x, opacity, transition) => {
    const m = moverRef.current;
    if (!m) return;
    m.style.transition = transition;
    m.style.transform = x ? `translateX(${x}px)` : '';
    m.style.opacity = opacity === 1 ? '' : String(opacity);
  };
  const later = (fn, ms) => {
    const id = setTimeout(() => { s.timers = s.timers.filter((t) => t !== id); fn(); }, ms);
    s.timers.push(id);
  };
  const reset = () => {
    s.timers.forEach(clearTimeout); s.timers = [];
    s.g = null; s.busy = false;
    setMover(0, 1, 'none');
  };

  const attach = (el) => {
    const finish = () => { setMover(0, 1, 'none'); s.busy = false; };
    const settle = () => {
      s.busy = true;
      setMover(0, 1, `transform ${BACK_MS}ms ease-out, opacity ${BACK_MS}ms ease-out`);
      later(finish, BACK_MS + 30);
    };
    const commit = (kind) => {
      s.busy = true;
      const dir = kind === 'next' ? -1 : 1; // next slides out to the left
      const slide = Math.max(80, (el.clientWidth || 0) * 0.3);
      setMover(dir * slide, 0, `transform ${OUT_MS}ms ease-out, opacity ${OUT_MS}ms ease-out`);
      later(() => {
        let changed = false;
        try { changed = !!(kind === 'next' ? live.current.onNext?.() : live.current.onPrev?.()); } catch { changed = false; }
        if (changed) {
          // New song: park the content on the far side, flush, then slide it in.
          setMover(-dir * slide, 0, 'none');
          if (moverRef.current) void moverRef.current.offsetWidth;
          setMover(0, 1, `transform ${IN_MS}ms ease-out, opacity ${IN_MS}ms ease-out`);
          later(finish, IN_MS + 30);
        } else {
          setMover(0, 1, `transform ${BACK_MS}ms ease-out, opacity ${BACK_MS}ms ease-out`);
          later(finish, BACK_MS + 30);
        }
      }, OUT_MS);
    };

    const onStart = (e) => {
      if (!live.current.enabled || s.busy || e.touches.length !== 1) { s.g = null; return; }
      // Sliders and anything opted out keep their own horizontal drag.
      if (e.target.closest && e.target.closest('input, textarea, select, [data-no-swipe]')) { s.g = null; return; }
      const t = e.touches[0];
      s.g = { x0: t.clientX, y0: t.clientY, t0: now(), axis: null, dx: 0 };
    };
    const onMove = (e) => {
      const g = s.g;
      if (!g) return;
      if (e.touches.length !== 1) { s.g = null; if (g.axis === 'x') settle(); return; }
      const t = e.touches[0];
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (g.axis === null) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP_PX) return;
        g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (g.axis !== 'x') return; // vertical: not ours
      if (e.cancelable) e.preventDefault(); // no page scroll / click while we're dragging
      g.dx = dx;
      const w = el.clientWidth || 300;
      setMover(dx, Math.max(0.35, 1 - Math.abs(dx) / (w * 0.8)), 'none');
    };
    const onEnd = () => {
      const g = s.g;
      s.g = null;
      if (!g || g.axis !== 'x') return;
      s.lastSwipe = now();
      const dist = Math.abs(g.dx);
      const speed = dist / Math.max(1, now() - g.t0);
      const far = dist >= Math.max(COMMIT_PX, (el.clientWidth || 0) * COMMIT_FRACTION);
      const flick = dist >= FLICK_MIN_PX && speed >= FLICK_PX_PER_MS;
      if (far || flick) commit(g.dx < 0 ? 'next' : 'prev'); else settle();
    };
    const onCancel = () => {
      const g = s.g;
      s.g = null;
      if (g && g.axis === 'x') settle();
    };
    // A browser can still fire a click after a drag that ended on an element; the
    // bar's own click opens the expanded player, which a swipe must never do.
    const onClickCapture = (e) => {
      if (now() - s.lastSwipe < CLICK_GUARD_MS) { e.stopPropagation(); e.preventDefault(); }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false }); // non-passive so preventDefault works
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onCancel);
    el.addEventListener('click', onClickCapture, true);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
      el.removeEventListener('click', onClickCapture, true);
    };
  };

  // A callback ref, not an object ref: the bar swaps between its song row and
  // its radio-station row, so the zone element comes and goes.
  const zoneRef = useCallback((el) => {
    if (s.cleanup) { s.cleanup(); s.cleanup = null; reset(); }
    if (el) s.cleanup = attach(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { if (s.cleanup) { s.cleanup(); s.cleanup = null; } reset(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { zoneRef, moverRef };
}
