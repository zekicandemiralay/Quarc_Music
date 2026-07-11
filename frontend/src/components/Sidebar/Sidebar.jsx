import { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Youtube, Library, Heart, ListMusic, Plus, ShieldCheck, LogOut, Trash2, Check, KeyRound, X, BarChart2, Sparkles, Clock, Mic2, Music, Home, Download, RefreshCw, CheckCircle, ExternalLink, Radio } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useAuthStore from '../../store/authStore';
import useUserDataStore from '../../store/userDataStore';
import useMixStore from '../../store/useMixStore';
import useFeaturedStore from '../../store/useFeaturedStore';

const REPO = 'zekicandemiralay/Quarc_Music';

function semverGt(a, b) {
  const pa = (a || '0').split('.').map(Number);
  const pb = (b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function UpdateCheckModal({ onClose }) {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState(null);
  const [currentVersion, setCurrentVersion] = useState(null);
  const [release, setRelease] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [installing, setInstalling] = useState(false);

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let p = 'web';
      let ver = null;
      if (window?.Capacitor?.isNativePlatform?.()) {
        p = 'android';
        try { ver = (await window.Capacitor.Plugins.App.getInfo()).version; } catch {}
      } else if (window?.__TAURI__) {
        p = 'desktop';
        try { ver = await window.__TAURI__.app.getVersion(); } catch {}
      }
      setPlatform(p);
      setCurrentVersion(ver);

      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      setRelease(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  function getDownloadUrl() {
    if (!release) return null;
    if (platform === 'android') return release.assets?.find(a => a.name.endsWith('.apk'))?.browser_download_url;
    if (platform === 'desktop') return release.assets?.find(a => a.name.includes('x64-setup.exe'))?.browser_download_url ?? release.html_url;
    return release.html_url;
  }

  function handleInstall() {
    const url = getDownloadUrl();
    const version = release?.tag_name?.replace(/^v/, '');
    if (!url) return;
    setInstalling(true);
    if (platform === 'android') {
      window?.Capacitor?.Plugins?.MusicService?.downloadUpdate({ url, version });
    } else if (platform === 'desktop') {
      window.__TAURI__.shell.open(url).catch(e => { setError(e.message); setInstalling(false); });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  const latestVersion = release?.tag_name?.replace(/^v/, '');
  const hasUpdate = currentVersion && latestVersion && semverGt(latestVersion, currentVersion);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-800 rounded-2xl p-5 w-full max-w-sm space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-white font-semibold">{t('updates.title', 'Check for Updates')}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><X size={18} /></button>
        </div>

        {loading && (
          <div className="flex items-center gap-3 py-2">
            <RefreshCw size={15} className="animate-spin text-zinc-400 shrink-0" />
            <span className="text-zinc-400 text-sm">{t('updates.checking', 'Checking…')}</span>
          </div>
        )}

        {error && !loading && (
          <p className="text-red-400 text-sm">{t('updates.error', 'Error')}: {error}</p>
        )}

        {!loading && !error && release && (
          <div className="space-y-3">
            {platform !== 'web' && currentVersion && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">{t('updates.installed', 'Installed')}</span>
                <span className="text-white font-medium">v{currentVersion}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">{t('updates.latest', 'Latest')}</span>
              <span className="text-white font-medium">{release.tag_name}</span>
            </div>

            <div className={`flex items-center gap-2 text-sm font-medium py-2 px-3 rounded-lg ${hasUpdate ? 'bg-amber-500/10 text-amber-400' : 'bg-green-500/10 text-green-400'}`}>
              {hasUpdate ? (
                <>{t('updates.updateAvailable', 'Update available')}</>
              ) : (
                <><CheckCircle size={14} /> {t('updates.upToDate', "You're up to date")}</>
              )}
            </div>

            {(hasUpdate || platform === 'web') && (
              <div className="flex gap-2">
                {platform !== 'web' ? (
                  <button
                    onClick={handleInstall}
                    disabled={installing}
                    className="flex-1 flex items-center justify-center gap-2 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    <Download size={14} />
                    {installing ? t('updates.downloading', 'Starting…') : t('updates.install', 'Install')}
                  </button>
                ) : (
                  <a
                    href={release.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-xl text-sm font-medium transition-colors"
                  >
                    <ExternalLink size={14} />
                    {t('updates.viewRelease', 'View on GitHub')}
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        <button
          onClick={check}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-2 text-zinc-500 hover:text-zinc-300 text-xs transition-colors disabled:opacity-40"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          {t('updates.refresh', 'Refresh')}
        </button>
      </div>
    </div>
  );
}

const MIX_ICONS = {
  your_mix: <Sparkles size={15} className="text-purple-400 shrink-0" />,
  rediscovery: <Clock size={15} className="text-amber-400 shrink-0" />,
  artist_focus: <Mic2 size={15} className="text-blue-400 shrink-0" />,
  genre: <Music size={15} className="text-green-400 shrink-0" />,
};

function ChangePasswordModal({ onClose }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (next.length < 8) { setError(t('sidebar.passwordMinLength')); return; }
    if (next !== confirm) { setError(t('sidebar.passwordsNoMatch')); return; }
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    if (res.ok) { setDone(true); }
    else { setError((await res.json()).error || 'Failed'); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-800 rounded-2xl p-6 w-full max-w-sm space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-white font-semibold">{t('sidebar.changePassword')}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><X size={18} /></button>
        </div>
        {done ? (
          <p className="text-green-400 text-sm">{t('sidebar.passwordSuccess')}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="password"
              placeholder={t('sidebar.currentPassword')}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="w-full bg-zinc-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-white/20 placeholder-zinc-500"
            />
            <input
              type="password"
              placeholder={t('sidebar.newPassword')}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="w-full bg-zinc-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-white/20 placeholder-zinc-500"
            />
            <input
              type="password"
              placeholder={t('sidebar.confirmPassword')}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full bg-zinc-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-white/20 placeholder-zinc-500"
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              type="submit"
              className="w-full bg-white text-black rounded-lg py-2.5 text-sm font-medium hover:bg-zinc-200 transition-colors"
            >
              {t('sidebar.changePasswordBtn')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function PlaylistItem({ playlist, onNavigate }) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(playlist.name);
  const { renamePlaylist, deletePlaylist } = useUserDataStore();

  async function commitRename() {
    if (name.trim() && name !== playlist.name) await renamePlaylist(playlist.id, name.trim());
    setRenaming(false);
  }

  return (
    <div className="group flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-zinc-800 transition-colors touch-manipulation">
      {renaming ? (
        <>
          <ListMusic size={15} className="text-zinc-500 shrink-0" />
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
            className="flex-1 bg-zinc-700 text-white text-sm rounded px-1.5 py-0.5 focus:outline-none min-w-0"
          />
        </>
      ) : (
        <NavLink
          to={`/playlist/${playlist.id}`}
          className={({ isActive }) =>
            `flex-1 flex items-center gap-2 min-w-0 text-sm transition-colors ${isActive ? 'text-white' : 'text-zinc-400 hover:text-white'}`
          }
          onClick={onNavigate}
          onDoubleClick={() => setRenaming(true)}
        >
          <ListMusic size={15} className="text-zinc-500 shrink-0" />
          <span className="truncate">{playlist.name}</span>
        </NavLink>
      )}
      {confirming ? (
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-red-400">{t('sidebar.deletePlaylist')}</span>
          <button
            onClick={() => deletePlaylist(playlist.id)}
            className="text-red-400 hover:text-red-300 transition-colors"
            title={t('sidebar.confirmDelete')}
          >
            <Check size={13} />
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="text-zinc-500 hover:text-white transition-colors"
            title={t('sidebar.cancelDelete')}
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-colors shrink-0"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

export default function Sidebar({ onNavigate }) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuthStore();
  const { playlists, likedSongs, createPlaylist } = useUserDataStore();
  const mixes = useMixStore((s) => s.mixes);
  const featured = useFeaturedStore((s) => s.playlists);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const navigate = useNavigate();

  const nav = (to) => { navigate(to); onNavigate?.(); };

  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      isActive ? 'text-white bg-zinc-700' : 'text-zinc-400 hover:text-white'
    }`;

  async function handleCreatePlaylist() {
    const name = newName.trim();
    if (!name) return;
    const playlist = await createPlaylist(name);
    setNewName('');
    setCreating(false);
    if (playlist) nav(`/playlist/${playlist.id}`);
  }

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  function toggleLanguage() {
    const next = i18n.language === 'tr' ? 'en' : 'tr';
    i18n.changeLanguage(next);
    localStorage.setItem('language', next);
  }

  return (
    <div className="w-64 h-full bg-black flex flex-col gap-2 p-2 shrink-0 overflow-y-auto">
      {/* App header + nav */}
      <div className="bg-zinc-900 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-5">
          <img src="/logo.png" alt="Quarc Music" className="w-7 h-7 object-contain" />
          <span className="text-white font-bold text-base">Quarc Music</span>
        </div>
        <nav className="space-y-0.5">
          <NavLink to="/" end className={linkClass} onClick={onNavigate}>
            <Home size={18} />
            {t('nav.home')}
          </NavLink>
          <NavLink to="/library" className={linkClass} onClick={onNavigate}>
            <Library size={18} />
            {t('nav.library')}
          </NavLink>
          <NavLink to="/liked" className={linkClass} onClick={onNavigate}>
            <Heart size={18} className="text-red-400" />
            {t('nav.likedSongs')}
            {likedSongs.length > 0 && (
              <span className="ml-auto text-xs text-zinc-500">{likedSongs.length}</span>
            )}
          </NavLink>
          <NavLink to="/youtube" className={linkClass} onClick={onNavigate}>
            <Youtube size={18} className="text-red-500" />
            {t('nav.youtube')}
          </NavLink>
          <NavLink to="/radio" className={linkClass} onClick={onNavigate}>
            <Radio size={18} className="text-pink-400" />
            {t('nav.radio')}
          </NavLink>
          <NavLink to="/stats" className={linkClass} onClick={onNavigate}>
            <BarChart2 size={18} className="text-blue-400" />
            {t('nav.stats')}
          </NavLink>
          <NavLink to="/import" className={linkClass} onClick={onNavigate}>
            <Download size={18} className="text-green-400" />
            {t('nav.import')}
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink to="/admin" className={linkClass} onClick={onNavigate}>
              <ShieldCheck size={18} className="text-amber-400" />
              {t('nav.admin')}
            </NavLink>
          )}
        </nav>
      </div>

      {/* Playlists */}
      <div className="bg-zinc-900 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-zinc-500 text-xs font-semibold uppercase tracking-wider">{t('nav.playlists')}</span>
          <button
            onClick={() => setCreating(!creating)}
            className="text-zinc-500 hover:text-white transition-colors"
            title={t('nav.newPlaylist')}
          >
            <Plus size={16} />
          </button>
        </div>

        {creating && (
          <div className="flex items-center gap-1 mb-2">
            <input
              autoFocus
              type="text"
              placeholder={t('nav.playlistName')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreatePlaylist(); if (e.key === 'Escape') setCreating(false); }}
              className="flex-1 bg-zinc-700 text-white text-xs rounded px-2 py-1.5 focus:outline-none placeholder-zinc-500"
            />
            <button onClick={handleCreatePlaylist} className="text-zinc-400 hover:text-white p-1">
              <Check size={14} />
            </button>
          </div>
        )}

        <div className="space-y-0.5">
          {playlists.length === 0 && !creating && (
            <p className="text-zinc-600 text-xs px-3 py-1">{t('nav.noPlaylists')}</p>
          )}
          {playlists.map((p) => <PlaylistItem key={p.id} playlist={p} onNavigate={onNavigate} />)}
        </div>
      </div>

      {/* Mixes */}
      {mixes.length > 0 && (
        <div className="bg-zinc-900 rounded-lg p-3">
          <span className="text-zinc-500 text-xs font-semibold uppercase tracking-wider px-1">{t('nav.mixes')}</span>
          <div className="space-y-0.5 mt-2">
            {mixes.map((mix) => (
              <NavLink
                key={mix.id}
                to={`/mix/${mix.id}`}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                    isActive ? 'text-white bg-zinc-800' : 'text-zinc-400 hover:text-white'
                  }`
                }
                onClick={onNavigate}
              >
                {MIX_ICONS[mix.type]}
                <span className="truncate">{mix.name}</span>
              </NavLink>
            ))}
          </div>
        </div>
      )}

      {/* Featured Collections */}
      {featured.length > 0 && (
        <div className="bg-zinc-900 rounded-lg p-3">
          <span className="text-zinc-500 text-xs font-semibold uppercase tracking-wider px-1">{t('nav.collections')}</span>
          <div className="space-y-0.5 mt-2">
            {featured.map((pl) => (
              <NavLink
                key={pl.id}
                to={`/featured/${pl.id}`}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                    isActive ? 'text-white bg-zinc-800' : 'text-zinc-400 hover:text-white'
                  }`
                }
                onClick={onNavigate}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: pl.color }} />
                <span className="truncate">{pl.name}</span>
              </NavLink>
            ))}
          </div>
        </div>
      )}

      {/* User footer */}
      <div className="bg-zinc-900 rounded-lg px-3 py-2.5 flex items-center gap-2">
        <div className="w-7 h-7 bg-zinc-700 rounded-full flex items-center justify-center shrink-0">
          <span className="text-xs text-white font-medium">{user?.username?.[0]?.toUpperCase()}</span>
        </div>
        <span className="text-white text-sm font-medium flex-1 truncate">{user?.username}</span>
        <button
          onClick={toggleLanguage}
          className="text-zinc-500 hover:text-white transition-colors text-xs font-semibold w-6 text-center"
          title={t('common.language')}
        >
          {i18n.language === 'tr' ? 'TR' : 'EN'}
        </button>
        <button onClick={() => setChangingPassword(true)} className="text-zinc-500 hover:text-white transition-colors" title={t('sidebar.changePassword')}>
          <KeyRound size={15} />
        </button>
        <button onClick={() => setCheckingUpdates(true)} className="text-zinc-500 hover:text-white transition-colors" title={t('updates.title', 'Check for Updates')}>
          <RefreshCw size={15} />
        </button>
        <button onClick={handleLogout} className="text-zinc-500 hover:text-white transition-colors" title={t('sidebar.signOut')}>
          <LogOut size={15} />
        </button>
      </div>

      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
      {checkingUpdates && <UpdateCheckModal onClose={() => setCheckingUpdates(false)} />}
    </div>
  );
}
