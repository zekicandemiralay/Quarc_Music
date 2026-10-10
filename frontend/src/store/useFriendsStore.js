import { create } from 'zustand';

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

const useFriendsStore = create((set, get) => ({
  friends: [],            // [{id, username}]
  incomingRequests: [],   // [{id, userId, username, created_at}]
  outgoingRequests: [],   // [{id, userId, username, created_at}]
  activity: [],           // [{userId, username, nowPlaying, recentlyPlayed}]
  searchResults: [],      // [{id, username, status}]
  searching: false,
  loaded: false,

  load: async () => {
    try {
      const [friends, requests] = await Promise.all([
        getJson('/api/friends'),
        getJson('/api/friends/requests'),
      ]);
      set({
        friends,
        incomingRequests: requests.incoming,
        outgoingRequests: requests.outgoing,
        loaded: true,
      });
    } catch { /* keep whatever was already loaded */ }
    get().loadActivity();
  },

  // Called on an interval from the Friends page while it's open — kept
  // separate from load() so refreshing the feed doesn't also re-fetch
  // friends/requests every time.
  loadActivity: async () => {
    try {
      const activity = await getJson('/api/friends/activity');
      set({ activity });
    } catch { /* leave stale activity showing rather than clearing it */ }
  },

  reset: () => set({
    friends: [], incomingRequests: [], outgoingRequests: [], activity: [],
    searchResults: [], searching: false, loaded: false,
  }),

  search: async (q) => {
    const query = (q || '').trim();
    if (query.length < 2) { set({ searchResults: [] }); return; }
    set({ searching: true });
    try {
      const results = await getJson(`/api/friends/search?q=${encodeURIComponent(query)}`);
      set({ searchResults: results });
    } catch {
      set({ searchResults: [] });
    } finally {
      set({ searching: false });
    }
  },

  sendRequest: async (toUserId, toUsername) => {
    await getJson('/api/friends/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toUserId, toUsername }),
    });
    // Reflect it immediately in the search results dropdown without a refetch
    set((s) => ({
      searchResults: s.searchResults.map((u) => u.id === toUserId ? { ...u, status: 'pending_outgoing' } : u),
    }));
    get().load();
  },

  acceptRequest: async (requestId) => {
    await getJson(`/api/friends/requests/${requestId}/accept`, { method: 'POST' });
    get().load();
  },

  declineRequest: async (requestId) => {
    await getJson(`/api/friends/requests/${requestId}`, { method: 'DELETE' });
    get().load();
  },

  removeFriend: async (friendId) => {
    await getJson(`/api/friends/${friendId}`, { method: 'DELETE' });
    get().load();
  },
}));

export default useFriendsStore;
