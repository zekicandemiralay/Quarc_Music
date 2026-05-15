import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Music2, Youtube, Library, Heart, ListMusic, Plus, ShieldCheck, LogOut, Trash2, Check, KeyRound, X, BarChart2, Sparkles, Clock, Mic2, Music, Home, Download } from 'lucide-react';
import useAuthStore from '../../store/authStore';
import useUserDataStore from '../../store/userDataStore';
import useMixStore from '../../store/useMixStore';
import useFeaturedStore from '../../store/useFeaturedStore';

const MIX_ICONS = {
  your_mix: <Sparkles size={15} className="text-purple-400 shrink-0" />,
  rediscovery: <Clock size={15} className="text-amber-400 shrink-0" />,
  artist_focus: <Mic2 size={15} className="text-blue-400 shrink-0" />,
  genre: <Music size={15} className="text-green-400 shrink-0" />,
};

function ChangePasswordModal({ onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (next.length < 8) { setError('New password must be at least 8 characters'); return; }
    if (next !== confirm) { setError('Passwords do not match'); return; }
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
          <h3 className="text-white font-semibold">Change Password</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><X size={18} /></button>
        </div>
        {done ? (
          <p className="text-green-400 text-sm">Password changed successfully.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="password"
              placeholder="Current password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="w-full bg-zinc-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-white/20 placeholder-zinc-500"
            />
            <input
              type="password"
              placeholder="New password (min 8 chars)"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="w-full bg-zinc-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-white/20 placeholder-zinc-500"
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full bg-zinc-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-white/20 placeholder-zinc-500"
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              type="submit"
              className="w-full bg-white text-black rounded-lg py-2.5 text-sm font-medium hover:bg-zinc-200 transition-colors"
            >
              Change Password
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function PlaylistItem({ playlist, onNavigate }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(playlist.name);
  const { renamePlaylist, deletePlaylist } = useUserDataStore();

  async function commitRename() {
    if (name.trim() && name !== playlist.name) await renamePlaylist(playlist.id, name.trim());
    setRenaming(false);
  }

  return (
    <div className="group flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-zinc-800 transition-colors">
      <ListMusic size={15} className="text-zinc-500 shrink-0" />
      {renaming ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
          className="flex-1 bg-zinc-700 text-white text-sm rounded px-1.5 py-0.5 focus:outline-none min-w-0"
        />
      ) : (
        <NavLink
          to={`/playlist/${playlist.id}`}
          className={({ isActive }) =>
            `flex-1 text-sm truncate transition-colors ${isActive ? 'text-white' : 'text-zinc-400 hover:text-white'}`
          }
          onClick={onNavigate}
          onDoubleClick={() => setRenaming(true)}
        >
          {playlist.name}
        </NavLink>
      )}
      <button
        onClick={() => deletePlaylist(playlist.id)}
        className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-colors shrink-0"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

export default function Sidebar({ onNavigate }) {
  const { user, logout } = useAuthStore();
  const { playlists, likedSongs, createPlaylist } = useUserDataStore();
  const mixes = useMixStore((s) => s.mixes);
  const featured = useFeaturedStore((s) => s.playlists);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
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

  return (
    <div className="w-64 h-full bg-black flex flex-col gap-2 p-2 shrink-0 overflow-y-auto">
      {/* App header + nav */}
      <div className="bg-zinc-900 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-5">
          <Music2 size={24} className="text-white" />
          <span className="text-white font-bold text-base">Skynet Music</span>
        </div>
        <nav className="space-y-0.5">
          <NavLink to="/" end className={linkClass} onClick={onNavigate}>
            <Home size={18} />
            Home
          </NavLink>
          <NavLink to="/library" className={linkClass} onClick={onNavigate}>
            <Library size={18} />
            Library
          </NavLink>
          <NavLink to="/liked" className={linkClass} onClick={onNavigate}>
            <Heart size={18} className="text-red-400" />
            Liked Songs
            {likedSongs.length > 0 && (
              <span className="ml-auto text-xs text-zinc-500">{likedSongs.length}</span>
            )}
          </NavLink>
          <NavLink to="/youtube" className={linkClass} onClick={onNavigate}>
            <Youtube size={18} className="text-red-500" />
            YouTube
          </NavLink>
          <NavLink to="/stats" className={linkClass} onClick={onNavigate}>
            <BarChart2 size={18} className="text-blue-400" />
            Stats
          </NavLink>
          <NavLink to="/import" className={linkClass} onClick={onNavigate}>
            <Download size={18} className="text-green-400" />
            Import
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink to="/admin" className={linkClass} onClick={onNavigate}>
              <ShieldCheck size={18} className="text-amber-400" />
              Admin
            </NavLink>
          )}
        </nav>
      </div>

      {/* Playlists */}
      <div className="bg-zinc-900 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-zinc-500 text-xs font-semibold uppercase tracking-wider">Playlists</span>
          <button
            onClick={() => setCreating(!creating)}
            className="text-zinc-500 hover:text-white transition-colors"
            title="New playlist"
          >
            <Plus size={16} />
          </button>
        </div>

        {creating && (
          <div className="flex items-center gap-1 mb-2">
            <input
              autoFocus
              type="text"
              placeholder="Playlist name"
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
            <p className="text-zinc-600 text-xs px-3 py-1">No playlists yet</p>
          )}
          {playlists.map((p) => <PlaylistItem key={p.id} playlist={p} onNavigate={onNavigate} />)}
        </div>
      </div>

      {/* Mixes */}
      {mixes.length > 0 && (
        <div className="bg-zinc-900 rounded-lg p-3">
          <span className="text-zinc-500 text-xs font-semibold uppercase tracking-wider px-1">Mixes</span>
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
          <span className="text-zinc-500 text-xs font-semibold uppercase tracking-wider px-1">Collections</span>
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
        <button onClick={() => setChangingPassword(true)} className="text-zinc-500 hover:text-white transition-colors" title="Change password">
          <KeyRound size={15} />
        </button>
        <button onClick={handleLogout} className="text-zinc-500 hover:text-white transition-colors" title="Sign out">
          <LogOut size={15} />
        </button>
      </div>

      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </div>
  );
}
