import { useCallback, useState } from 'react';

// Right-click menu state for a list of rows — one instance per page, reused
// across every row via the `data` payload instead of one state slice per row.
export default function useContextMenu() {
  const [menu, setMenu] = useState(null); // { x, y, data } | null

  const open = useCallback((e, data) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, data });
  }, []);

  const close = useCallback(() => setMenu(null), []);

  return { menu, open, close };
}
