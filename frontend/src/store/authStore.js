import { create } from 'zustand';

const LS_KEY = 'skynet_user';

function saveUser(user) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(user)); } catch {}
}
function clearUser() {
  try { localStorage.removeItem(LS_KEY); } catch {}
}
function loadUser() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; }
}

const useAuthStore = create((set) => ({
  user: null,
  loading: true,

  login: async (username, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Login failed');
    }
    const data = await res.json();
    const user = { id: data.id, username: data.username, role: data.role };
    saveUser(user);
    set({ user });
  },

  logout: async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    clearUser();
    set({ user: null });
  },

  checkSession: async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('/api/auth/me', { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const user = { id: data.id, username: data.username, role: data.role };
        saveUser(user);
        set({ user, loading: false });
      } else {
        clearUser();
        set({ user: null, loading: false });
      }
    } catch {
      // Offline or timeout — restore the last known user so the app doesn't force a login
      set({ user: loadUser(), loading: false });
    }
  },
}));

export default useAuthStore;
