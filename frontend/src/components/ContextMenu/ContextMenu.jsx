import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Generic right-click popup: portal, clamped to the viewport so it never
// renders off-screen near an edge/corner, closes on outside click, Escape,
// or the page scrolling/resizing under it.
export default function ContextMenu({ x, y, onClose, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: y, left: x });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - 8;
    const maxTop = window.innerHeight - rect.height - 8;
    setPos({
      left: Math.min(x, Math.max(8, maxLeft)),
      top: Math.min(y, Math.max(8, maxTop)),
    });
  }, [x, y]);

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose(); }
    function handleScroll() { onClose(); }
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [onClose]);

  return createPortal(
    <>
      {/* Click-away layer. Also eats a second right-click so it closes
          this menu instead of the browser opening a native one underneath. */}
      <div
        className="fixed inset-0 z-[400]"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        ref={ref}
        className="fixed z-[401] bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl w-56 py-1.5 max-h-[80vh] overflow-y-auto"
        style={{ top: pos.top, left: pos.left }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {children}
      </div>
    </>,
    document.body
  );
}

export function MenuItem({ icon: Icon, label, onClick, danger, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3 text-left text-sm px-3 py-2 transition-colors disabled:opacity-40 disabled:cursor-default ${
        danger ? 'text-red-400 hover:bg-zinc-700' : 'text-zinc-200 hover:text-white hover:bg-zinc-700'
      }`}
    >
      {Icon && <Icon size={15} className={`shrink-0 ${danger ? 'text-red-400' : 'text-zinc-400'}`} />}
      <span className="truncate">{label}</span>
    </button>
  );
}

export function MenuDivider() {
  return <div className="border-t border-zinc-700/60 my-1.5" />;
}

export function MenuLabel({ children }) {
  return <p className="text-zinc-500 text-xs px-3 py-1.5 font-semibold uppercase tracking-wider">{children}</p>;
}
