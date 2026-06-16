import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import useAuthStore from './store/authStore';
import useUserDataStore from './store/userDataStore';
import Layout from './components/Layout/Layout';
import Login from './pages/Login/Login';
import Library from './pages/Library/Library';
import YouTube from './pages/YouTube/YouTube';
import Admin from './pages/Admin/Admin';
import Stats from './pages/Stats/Stats';
import Home from './pages/Home/Home';
import Import from './pages/Import/Import';
import useOfflineStore from './store/useOfflineStore';
import useMixStore from './store/useMixStore';
import useFeaturedStore from './store/useFeaturedStore';
import usePlayerStore from './store/playerStore';

function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuthStore();
  if (loading) return <div className="min-h-screen bg-zinc-950 flex items-center justify-center"><div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, loading, checkSession } = useAuthStore();
  const loadUserData = useUserDataStore((s) => s.load);
  const resetUserData = useUserDataStore((s) => s.reset);
  const initOffline = useOfflineStore((s) => s.init);
  const loadMixes = useMixStore((s) => s.loadMixes);
  const resetMixes = useMixStore((s) => s.reset);
  const loadFeatured = useFeaturedStore((s) => s.load);
  const resetFeatured = useFeaturedStore((s) => s.reset);

  useEffect(() => {
    checkSession();
    initOffline();
    // Stash ?share=ID before the router strips it, so it survives a login redirect
    const shareId = new URLSearchParams(window.location.search).get('share');
    if (shareId) {
      sessionStorage.setItem('quarc_pending_share', shareId);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (user) { loadUserData(); loadMixes(); loadFeatured(); }
    else { resetUserData(); resetMixes(); resetFeatured(); }
  }, [user?.id]);

  // Play a shared song once the user is authenticated
  useEffect(() => {
    if (!user) return;
    const shareId = sessionStorage.getItem('quarc_pending_share');
    if (!shareId) return;
    sessionStorage.removeItem('quarc_pending_share');
    fetch('/api/music')
      .then((r) => r.json())
      .then((songs) => {
        const song = songs.find((s) => String(s.id) === String(shareId));
        if (song) usePlayerStore.getState().playSong(song, [song], 0, 'single', 'Shared');
      })
      .catch(() => {});
  }, [user?.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/library" element={<Library />} />
                <Route path="/liked" element={<Library view="liked" />} />
                <Route path="/playlist/:playlistId" element={<Library view="playlist" />} />
                <Route path="/mix/:mixId" element={<Library view="mix" />} />
                <Route path="/featured/:featuredId" element={<Library view="featured" />} />
                <Route path="/youtube" element={<YouTube />} />
                <Route path="/import" element={<Import />} />
                <Route path="/stats" element={<Stats />} />
                <Route path="/admin" element={
                  <ProtectedRoute adminOnly>
                    <Admin />
                  </ProtectedRoute>
                } />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
