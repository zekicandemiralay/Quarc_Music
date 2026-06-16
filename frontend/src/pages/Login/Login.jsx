import { useState } from 'react';
import { Music2 } from 'lucide-react';
import useAuthStore from '../../store/authStore';
import useUserDataStore from '../../store/userDataStore';

export default function Login() {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const loadUserData = useUserDataStore((s) => s.load);

  function switchMode(m) {
    setMode(m);
    setError('');
    setUsername('');
    setPassword('');
    setConfirm('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (mode === 'signup') {
      if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
      if (password !== confirm) { setError('Passwords do not match'); return; }
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
          credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed');
        // Sync auth store with the newly created session
        await useAuthStore.getState().checkSession();
      }
      await loadUserData();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const isLogin = mode === 'login';

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center mb-4">
            <Music2 size={32} className="text-white" />
          </div>
          <h1 className="text-white text-2xl font-bold">Quarc Music</h1>
          <p className="text-zinc-500 text-sm mt-1">
            {isLogin ? 'Sign in to your account' : 'Create your account'}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 bg-zinc-900 rounded-xl p-1 mb-4">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              isLogin ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              !isLogin ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Create account
          </button>
        </div>

        {/* Card */}
        <form onSubmit={handleSubmit} className="bg-zinc-900 rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-zinc-400 text-sm mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="w-full bg-zinc-800 text-white rounded-lg px-4 py-2.5 text-sm border border-zinc-700 focus:outline-none focus:border-white/40 placeholder-zinc-600"
              placeholder="Enter your username"
            />
          </div>

          <div>
            <label className="block text-zinc-400 text-sm mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              required
              className="w-full bg-zinc-800 text-white rounded-lg px-4 py-2.5 text-sm border border-zinc-700 focus:outline-none focus:border-white/40 placeholder-zinc-600"
              placeholder={isLogin ? 'Enter your password' : 'At least 8 characters'}
            />
          </div>

          {!isLogin && (
            <div>
              <label className="block text-zinc-400 text-sm mb-1.5">Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                className="w-full bg-zinc-800 text-white rounded-lg px-4 py-2.5 text-sm border border-zinc-700 focus:outline-none focus:border-white/40 placeholder-zinc-600"
                placeholder="Repeat your password"
              />
            </div>
          )}

          {error && (
            <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-black font-semibold rounded-lg py-2.5 text-sm hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (isLogin ? 'Signing in…' : 'Creating account…') : (isLogin ? 'Sign in' : 'Create account')}
          </button>
        </form>

        <p className="text-center text-zinc-600 text-xs mt-6">
          Your playlists and liked songs are private to your account.
        </p>
      </div>
    </div>
  );
}
