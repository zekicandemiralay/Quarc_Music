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
import useOfflineStore from './store/useOfflineStore';

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

  useEffect(() => {
    checkSession();
    initOffline();
  }, []);

  useEffect(() => {
    if (user) loadUserData();
    else resetUserData();
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
                <Route path="/" element={<Library />} />
                <Route path="/liked" element={<Library view="liked" />} />
                <Route path="/playlist/:playlistId" element={<Library view="playlist" />} />
                <Route path="/youtube" element={<YouTube />} />
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
