import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useAuthStore from '../../store/authStore';
import useUserDataStore from '../../store/userDataStore';

export default function Login() {
  const { t } = useTranslation();
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
      if (password.length < 8) { setError(t('auth.passwordMinLength')); return; }
      if (password !== confirm) { setError(t('auth.passwordsNoMatch')); return; }
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
          <img src="/logo.png" alt="Quarc Music" className="w-20 h-20 object-contain mb-4" />
          <h1 className="text-white text-2xl font-bold">Quarc Music</h1>
          <p className="text-zinc-500 text-sm mt-1">
            {isLogin ? t('auth.signInToAccount') : t('auth.createYourAccount')}
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
            {t('auth.signIn')}
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              !isLogin ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {t('auth.createAccount')}
          </button>
        </div>

        {/* Card */}
        <form onSubmit={handleSubmit} className="bg-zinc-900 rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-zinc-400 text-sm mb-1.5">{t('auth.username')}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="w-full bg-zinc-800 text-white rounded-lg px-4 py-2.5 text-sm border border-zinc-700 focus:outline-none focus:border-white/40 placeholder-zinc-600"
              placeholder={t('auth.enterUsername')}
            />
          </div>

          <div>
            <label className="block text-zinc-400 text-sm mb-1.5">{t('auth.password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              required
              className="w-full bg-zinc-800 text-white rounded-lg px-4 py-2.5 text-sm border border-zinc-700 focus:outline-none focus:border-white/40 placeholder-zinc-600"
              placeholder={isLogin ? t('auth.enterPassword') : t('auth.passwordHint')}
            />
          </div>

          {!isLogin && (
            <div>
              <label className="block text-zinc-400 text-sm mb-1.5">{t('auth.confirmPassword')}</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                className="w-full bg-zinc-800 text-white rounded-lg px-4 py-2.5 text-sm border border-zinc-700 focus:outline-none focus:border-white/40 placeholder-zinc-600"
                placeholder={t('auth.repeatPassword')}
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
            {loading ? (isLogin ? t('auth.signingIn') : t('auth.creatingAccount')) : (isLogin ? t('auth.signIn') : t('auth.createAccount'))}
          </button>
        </form>

        <p className="text-center text-zinc-600 text-xs mt-6">
          {t('auth.privacyNote')}
        </p>
      </div>
    </div>
  );
}
