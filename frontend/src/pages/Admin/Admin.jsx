import { useState, useEffect, useRef, useCallback } from 'react';
import { UserPlus, Trash2, ShieldCheck, User, KeyRound, X, Plus, Check, Search, Download, CheckCircle, AlertCircle, ChevronDown, ChevronUp, Edit2, FolderSync, RefreshCw, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useFeaturedStore from '../../store/useFeaturedStore';

// ── Shared dialogs ────────────────────────────────────────────────────────────

function ConfirmDialog({ message, onConfirm, onCancel }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-800 rounded-2xl p-6 w-full max-w-sm space-y-4">
        <p className="text-white">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">{t('common.cancel')}</button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors">{t('common.confirm')}</button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordDialog({ user, onClose }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleReset() {
    setError('');
    if (password.length < 8) { setError(t('admin.users.atLeast8')); return; }
    const res = await fetch(`/api/admin/users/${user.id}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: password }),
    });
    if (res.ok) setDone(true);
    else setError((await res.json()).error || 'Failed');
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-800 rounded-2xl p-6 w-full max-w-sm space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-white font-semibold">{t('admin.users.resetPasswordTitle', { username: user.username })}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><X size={18} /></button>
        </div>
        {done ? (
          <p className="text-green-400 text-sm">{t('admin.users.resetSuccess')}</p>
        ) : (
          <>
            <p className="text-zinc-400 text-xs">{t('admin.users.playlistsKept')}</p>
            <input type="password" placeholder={t('admin.users.newPasswordHint')} value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-zinc-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-white/20" />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button onClick={handleReset} className="w-full bg-amber-600 hover:bg-amber-500 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
              {t('admin.users.resetPasswordBtn')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Users tab ─────────────────────────────────────────────────────────────────

function UsersTab() {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [createError, setCreateError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    const res = await fetch('/api/admin/users');
    if (res.ok) setUsers(await res.json());
  }

  async function createUser() {
    setCreateError('');
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: newUsername, password: newPassword }),
    });
    if (res.ok) { setNewUsername(''); setNewPassword(''); setShowCreate(false); loadUsers(); }
    else setCreateError((await res.json()).error || 'Failed');
  }

  async function deleteUser(id) {
    await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    setDeleteTarget(null);
    loadUsers();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <p className="text-zinc-500 text-sm">{t('admin.users.accounts', { n: users.length, count: users.length })}</p>
        <button onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-full text-sm font-semibold hover:bg-zinc-200 transition-colors">
          <UserPlus size={15} />{t('admin.users.newUser')}
        </button>
      </div>

      {showCreate && (
        <div className="bg-zinc-800 rounded-xl p-4 mb-5 space-y-3">
          <h3 className="text-white font-medium text-sm">{t('admin.users.createAccount')}</h3>
          <div className="flex gap-3 flex-wrap">
            <input type="text" placeholder={t('admin.users.username')} value={newUsername} onChange={(e) => setNewUsername(e.target.value)}
              className="flex-1 bg-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20 placeholder-zinc-500 min-w-0" />
            <input type="password" placeholder={t('admin.users.password')} value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              className="flex-1 bg-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20 placeholder-zinc-500 min-w-0" />
            <button onClick={createUser} className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors">{t('admin.users.create')}</button>
          </div>
          {createError && <p className="text-red-400 text-xs">{createError}</p>}
        </div>
      )}

      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 bg-zinc-800/60 rounded-xl px-4 py-3">
            <div className="w-8 h-8 bg-zinc-700 rounded-full flex items-center justify-center shrink-0">
              {u.role === 'admin' ? <ShieldCheck size={16} className="text-amber-400" /> : <User size={16} className="text-zinc-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium">{u.username}</p>
              <p className="text-zinc-500 text-xs capitalize">{u.role} · {new Date(u.created_at).toLocaleDateString()}</p>
            </div>
            {u.role !== 'admin' && (
              <div className="flex items-center gap-1">
                <button onClick={() => setResetTarget(u)} className="p-2 text-zinc-500 hover:text-amber-400 transition-colors" title={t('admin.users.resetPassword')}>
                  <KeyRound size={15} />
                </button>
                <button onClick={() => setDeleteTarget(u)} className="p-2 text-zinc-500 hover:text-red-400 transition-colors" title={t('admin.users.delete')}>
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          message={t('admin.users.deleteConfirm', { username: deleteTarget.username })}
          onConfirm={() => deleteUser(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {resetTarget && <ResetPasswordDialog user={resetTarget} onClose={() => setResetTarget(null)} />}
    </div>
  );
}

// ── Collections tab ───────────────────────────────────────────────────────────

const COLOR_OPTIONS = [
  '#7c3aed', '#1d4ed8', '#0891b2', '#0f766e', '#15803d',
  '#65a30d', '#b45309', '#c2410c', '#b91c1c', '#be185d',
  '#4338ca', '#475569',
];

function fmtDur(s) {
  if (!s) return '';
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function CollectionDownloadBtn({ videoId, title, featuredPlaylistId, onDone }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState(null);

  useEffect(() => {
    if (!jobId || status === 'done' || status === 'error') return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/youtube/download/status/${jobId}`);
        const d = await r.json();
        setProgress(d.progress);
        setStatus(d.status);
        if (d.status === 'done') { clearInterval(t); onDone?.(); }
        if (d.status === 'error') clearInterval(t);
      } catch {}
    }, 1500);
    return () => clearInterval(t);
  }, [jobId, status]);

  async function start() {
    setStatus('pending');
    try {
      const r = await fetch('/api/youtube/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, title, featuredPlaylistId }),
      });
      const d = await r.json();
      setJobId(d.jobId);
      setStatus('downloading');
    } catch { setStatus('error'); }
  }

  if (status === 'done') return <span className="flex items-center gap-1 text-green-400 text-xs"><CheckCircle size={12} />{t('admin.collections.added')}</span>;
  if (status === 'error') return <span className="text-red-400 text-xs">{t('admin.collections.downloadFailed')}</span>;
  if (status === 'downloading' || status === 'pending')
    return (
      <div className="flex items-center gap-1.5 text-zinc-400 text-xs">
        <div className="w-16 h-1 bg-zinc-700 rounded-full overflow-hidden">
          <div className="h-full bg-violet-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
        {Math.round(progress)}%
      </div>
    );

  return (
    <button onClick={start} className="flex items-center gap-1 px-2.5 py-1 bg-violet-700 hover:bg-violet-600 text-white rounded-full text-xs font-medium transition-colors">
      <Download size={11} />{t('admin.collections.add')}
    </button>
  );
}

function YoutubeSearchPanel({ playlistId, onSongAdded }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  async function doSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const r = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}`);
      if (r.ok) setResults(await r.json());
    } finally { setSearching(false); }
  }

  return (
    <div className="bg-zinc-800/80 rounded-xl p-3 space-y-3">
      <form onSubmit={doSearch} className="flex gap-2">
        <input
          type="text"
          placeholder={t('admin.collections.searchYoutube')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-zinc-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none placeholder-zinc-500"
        />
        <button type="submit" disabled={searching}
          className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
          {searching ? '…' : t('common.search')}
        </button>
      </form>
      {results.length > 0 && (
        <div className="space-y-1.5 max-h-52 overflow-y-auto">
          {results.map((v) => (
            <div key={v.id} className="flex items-center gap-2 py-1">
              <img src={v.thumbnail} alt="" className="w-10 h-7 object-cover rounded shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs truncate">{v.title}</p>
                <p className="text-zinc-500 text-xs">{fmtDur(v.duration)}</p>
              </div>
              <CollectionDownloadBtn
                videoId={v.id}
                title={v.title}
                featuredPlaylistId={playlistId}
                onDone={onSongAdded}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LibrarySearchPanel({ playlistId, currentSongIds, onSongAdded }) {
  const { t } = useTranslation();
  const [allSongs, setAllSongs] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/music').then((r) => r.ok ? r.json() : []).then((d) => { if (Array.isArray(d)) setAllSongs(d); }).catch(() => {});
  }, []);

  const filtered = allSongs
    .filter((s) => !currentSongIds.has(s.id))
    .filter((s) => !search || [s.title, s.artist, s.album].some((f) => f?.toLowerCase().includes(search.toLowerCase())))
    .slice(0, 20);

  async function addSong(songId) {
    await fetch(`/api/admin/featured/${playlistId}/songs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId }),
    });
    onSongAdded();
  }

  return (
    <div className="bg-zinc-800/80 rounded-xl p-3 space-y-2">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          placeholder={t('admin.collections.searchLibrary')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-zinc-700 text-white text-xs rounded-lg pl-8 pr-3 py-2 focus:outline-none placeholder-zinc-500"
        />
      </div>
      {filtered.length > 0 ? (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {filtered.map((s) => (
            <div key={s.id} className="flex items-center gap-2 py-1">
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs truncate">{s.title}</p>
                <p className="text-zinc-500 text-xs truncate">{s.artist}</p>
              </div>
              <button
                onClick={() => addSong(s.id)}
                className="flex items-center gap-1 px-2.5 py-1 bg-zinc-600 hover:bg-zinc-500 text-white rounded-full text-xs transition-colors shrink-0"
              >
                <Plus size={11} />{t('admin.collections.add')}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-zinc-600 text-xs px-1">{search ? t('admin.collections.noMatches') : t('admin.collections.typeToSearch')}</p>
      )}
    </div>
  );
}

function CollectionItem({ playlist, onUpdate }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [songs, setSongs] = useState([]);
  const [addMode, setAddMode] = useState(null); // 'library' | 'youtube' | null
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(playlist.name);
  const [editDesc, setEditDesc] = useState(playlist.description || '');
  const [editColor, setEditColor] = useState(playlist.color || '#7c3aed');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  async function loadSongs() {
    const r = await fetch(`/api/admin/featured/${playlist.id}/songs`);
    if (r.ok) setSongs(await r.json());
  }

  function toggle() {
    if (!expanded) loadSongs();
    setExpanded(!expanded);
    setAddMode(null);
  }

  async function removeSong(songId) {
    await fetch(`/api/admin/featured/${playlist.id}/songs/${songId}`, { method: 'DELETE' });
    loadSongs();
  }

  async function saveEdit() {
    await fetch(`/api/admin/featured/${playlist.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, description: editDesc, color: editColor }),
    });
    setEditing(false);
    onUpdate();
  }

  async function deletePlaylist() {
    await fetch(`/api/admin/featured/${playlist.id}`, { method: 'DELETE' });
    onUpdate();
  }

  return (
    <div className="bg-zinc-800/60 rounded-xl overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={toggle}>
        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: playlist.color }} />
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium truncate">{playlist.name}</p>
          {playlist.description && <p className="text-zinc-500 text-xs truncate">{playlist.description}</p>}
        </div>
        <span className="text-zinc-500 text-xs shrink-0">{t('admin.collections.songs', { n: playlist.song_count })}</span>
        <button onClick={(e) => { e.stopPropagation(); setEditing(true); setExpanded(true); if (!expanded) loadSongs(); }}
          className="p-1.5 text-zinc-500 hover:text-white transition-colors" title={t('common.edit')}>
          <Edit2 size={13} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(true); }}
          className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors" title={t('common.delete')}>
          <Trash2 size={13} />
        </button>
        {expanded ? <ChevronUp size={15} className="text-zinc-500 shrink-0" /> : <ChevronDown size={15} className="text-zinc-500 shrink-0" />}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-zinc-700/50 px-4 py-3 space-y-3">
          {/* Edit form */}
          {editing && (
            <div className="bg-zinc-700/50 rounded-lg p-3 space-y-2">
              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t('admin.collections.namePlaceholder')}
                className="w-full bg-zinc-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none placeholder-zinc-500" />
              <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder={t('admin.collections.descPlaceholder')}
                className="w-full bg-zinc-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none placeholder-zinc-500" />
              <div className="flex gap-2 flex-wrap">
                {COLOR_OPTIONS.map((c) => (
                  <button key={c} onClick={() => setEditColor(c)}
                    className={`w-6 h-6 rounded-full transition-transform ${editColor === c ? 'scale-125 ring-2 ring-white ring-offset-1 ring-offset-zinc-800' : 'hover:scale-110'}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={saveEdit} className="px-3 py-1.5 bg-white text-black rounded-lg text-xs font-medium hover:bg-zinc-200 transition-colors">{t('admin.collections.save')}</button>
                <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-zinc-400 hover:text-white text-xs transition-colors">{t('admin.collections.cancel')}</button>
              </div>
            </div>
          )}

          {/* Song list */}
          {songs.length > 0 ? (
            <div className="space-y-1">
              {songs.map((s) => (
                <div key={s.id} className="flex items-center gap-2 py-1 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs truncate">{s.title}</p>
                    <p className="text-zinc-500 text-xs truncate">{s.artist}</p>
                  </div>
                  <button onClick={() => removeSong(s.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-zinc-600 hover:text-red-400 transition-colors">
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-600 text-xs">{t('admin.collections.noSongs')}</p>
          )}

          {/* Add buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => setAddMode(addMode === 'library' ? null : 'library')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${addMode === 'library' ? 'bg-zinc-600 text-white' : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'}`}
            >
              <Plus size={12} />{t('admin.collections.addFromLibrary')}
            </button>
            <button
              onClick={() => setAddMode(addMode === 'youtube' ? null : 'youtube')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${addMode === 'youtube' ? 'bg-red-700 text-white' : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'}`}
            >
              <Download size={12} />{t('admin.collections.addFromYoutube')}
            </button>
          </div>

          {addMode === 'library' && (
            <LibrarySearchPanel
              playlistId={playlist.id}
              currentSongIds={new Set(songs.map((s) => s.id))}
              onSongAdded={() => { loadSongs(); onUpdate(); }}
            />
          )}
          {addMode === 'youtube' && (
            <YoutubeSearchPanel
              playlistId={playlist.id}
              onSongAdded={() => { setTimeout(loadSongs, 2000); onUpdate(); }}
            />
          )}
        </div>
      )}

      {deleteConfirm && (
        <ConfirmDialog
          message={t('admin.collections.deleteConfirm', { name: playlist.name })}
          onConfirm={deletePlaylist}
          onCancel={() => setDeleteConfirm(false)}
        />
      )}
    </div>
  );
}

function CollectionsTab() {
  const { t } = useTranslation();
  const [playlists, setPlaylists] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newColor, setNewColor] = useState('#7c3aed');
  const loadFeatured = useFeaturedStore((s) => s.load);

  useEffect(() => { loadCollections(); }, []);

  async function loadCollections() {
    const r = await fetch('/api/admin/featured');
    if (r.ok) setPlaylists(await r.json());
    loadFeatured(); // sync global store so sidebar/home update
  }

  async function createCollection() {
    if (!newName.trim()) return;
    const r = await fetch('/api/admin/featured', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), description: newDesc, color: newColor }),
    });
    if (r.ok) {
      setNewName(''); setNewDesc(''); setNewColor('#7c3aed'); setCreating(false);
      loadCollections();
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <p className="text-zinc-500 text-sm">{t('admin.collections.count', { n: playlists.length, count: playlists.length })}</p>
        <button onClick={() => setCreating(!creating)}
          className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-full text-sm font-semibold hover:bg-zinc-200 transition-colors">
          <Plus size={15} />{t('admin.collections.newCollection')}
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <div className="bg-zinc-800 rounded-xl p-4 mb-5 space-y-3">
          <h3 className="text-white font-medium text-sm">{t('admin.collections.newCollectionTitle')}</h3>
          <input type="text" placeholder={t('admin.collections.namePlaceholder')} value={newName} onChange={(e) => setNewName(e.target.value)}
            className="w-full bg-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none placeholder-zinc-500" />
          <input type="text" placeholder={t('admin.collections.descPlaceholder')} value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
            className="w-full bg-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none placeholder-zinc-500" />
          <div>
            <p className="text-zinc-500 text-xs mb-2">{t('admin.collections.colour')}</p>
            <div className="flex gap-2 flex-wrap">
              {COLOR_OPTIONS.map((c) => (
                <button key={c} onClick={() => setNewColor(c)}
                  className={`w-7 h-7 rounded-full transition-transform ${newColor === c ? 'scale-125 ring-2 ring-white ring-offset-2 ring-offset-zinc-800' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={createCollection} className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors">{t('admin.collections.create')}</button>
            <button onClick={() => setCreating(false)} className="px-4 py-2 text-zinc-400 hover:text-white text-sm transition-colors">{t('admin.collections.cancel')}</button>
          </div>
        </div>
      )}

      {playlists.length === 0 && !creating ? (
        <p className="text-zinc-500 text-sm text-center py-10">{t('admin.collections.noCollections')}</p>
      ) : (
        <div className="space-y-2">
          {playlists.map((pl) => (
            <CollectionItem key={pl.id} playlist={pl} onUpdate={loadCollections} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Updates tab ──────────────────────────────────────────────────────────────

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

function UpdatesTab() {
  const { t } = useTranslation();
  const [currentVersion, setCurrentVersion] = useState(null);
  const [platform, setPlatform] = useState(null); // 'android' | 'desktop' | 'web'
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [installing, setInstalling] = useState(null);

  const fetchReleases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases`);
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      setReleases(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function init() {
      if (window?.Capacitor?.isNativePlatform?.()) {
        setPlatform('android');
        try {
          const info = await window.Capacitor.Plugins.App.getInfo();
          setCurrentVersion(info.version);
        } catch {}
      } else if (window?.__TAURI__) {
        setPlatform('desktop');
        try { setCurrentVersion(await window.__TAURI__.app.getVersion()); } catch {}
      } else {
        setPlatform('web');
      }
      fetchReleases();
    }
    init();
  }, [fetchReleases]);

  function getDownloadUrl(release) {
    if (platform === 'android') {
      return release.assets?.find(a => a.name.endsWith('.apk'))?.browser_download_url;
    }
    if (platform === 'desktop') {
      return release.assets?.find(a => a.name.includes('x64-setup.exe'))?.browser_download_url
        ?? release.html_url;
    }
    return release.html_url;
  }

  function install(release) {
    const url = getDownloadUrl(release);
    const version = release.tag_name?.replace(/^v/, '');
    if (!url) return;
    if (platform === 'android') {
      window?.Capacitor?.Plugins?.MusicService?.downloadUpdate({ url, version });
    } else if (platform === 'desktop') {
      window.__TAURI__.shell.open(url);
    }
    setInstalling(version);
  }

  const latestVersion = releases[0]?.tag_name?.replace(/^v/, '');
  const hasUpdate = currentVersion && latestVersion && semverGt(latestVersion, currentVersion);

  return (
    <div className="space-y-5">
      {/* Current version + status */}
      <div className="bg-zinc-800/50 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-zinc-400 text-xs mb-0.5">{platform === 'web' ? 'Web app' : (
            currentVersion
              ? t('admin.updates.installedVersion', { version: currentVersion })
              : t('admin.updates.unknownVersion')
          )}</p>
          {platform === 'web' ? (
            <p className="text-zinc-500 text-sm">{t('admin.updates.webNote')}</p>
          ) : hasUpdate ? (
            <p className="text-amber-400 text-sm font-medium">{t('admin.updates.updateAvailable')} — v{latestVersion}</p>
          ) : !loading && (
            <p className="text-green-400 text-sm font-medium">{t('admin.updates.upToDate')}</p>
          )}
        </div>
        <button
          onClick={fetchReleases}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-full text-xs font-medium transition-colors disabled:opacity-40"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {t('admin.updates.refresh')}
        </button>
      </div>

      {/* Release list */}
      {loading && !releases.length && (
        <p className="text-zinc-500 text-sm text-center py-6">{t('admin.updates.loading')}</p>
      )}
      {error && (
        <p className="text-red-400 text-sm text-center py-4">{t('admin.updates.error')}: {error}</p>
      )}

      {releases.length > 0 && (
        <div className="space-y-2">
          {releases.map((release) => {
            const ver = release.tag_name?.replace(/^v/, '');
            const isCurrent = ver === currentVersion;
            const isNewer = currentVersion ? semverGt(ver, currentVersion) : false;
            const downloadUrl = getDownloadUrl(release);
            const date = release.published_at
              ? new Date(release.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
              : '';

            return (
              <div key={release.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl ${isCurrent ? 'bg-zinc-700/60 ring-1 ring-white/10' : 'bg-zinc-800/40'}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white text-sm font-semibold">{release.tag_name}</span>
                    {isCurrent && (
                      <span className="flex items-center gap-1 text-green-400 text-xs font-medium">
                        <CheckCircle size={11} />{t('admin.updates.installedBadge')}
                      </span>
                    )}
                    {isNewer && (
                      <span className="text-amber-400 text-xs font-medium">↑ {t('admin.updates.updateAvailable')}</span>
                    )}
                  </div>
                  {date && <p className="text-zinc-500 text-xs mt-0.5">{date}</p>}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {platform !== 'web' && (isNewer || !currentVersion) && downloadUrl && (
                    <button
                      onClick={() => install(release)}
                      disabled={installing === ver}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-full text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      <Download size={12} />
                      {installing === ver ? '…' : t('admin.updates.installBtn')}
                    </button>
                  )}
                  <a
                    href={release.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 text-zinc-600 hover:text-zinc-400 transition-colors"
                    title={t('admin.updates.viewGithub')}
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Admin page ───────────────────────────────────────────────────────────

function LibraryTab() {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [running, setRunning] = useState(false);

  async function reorganize() {
    setRunning(true);
    setStatus(null);
    try {
      const res = await fetch('/api/admin/reorganize', { method: 'POST' });
      setStatus(await res.json());
    } catch {
      setStatus({ error: 'Request failed' });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-zinc-800/50 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <FolderSync size={18} className="text-zinc-400" />
          <h3 className="text-white font-semibold">{t('admin.library.reorganizeTitle')}</h3>
        </div>
        <p className="text-zinc-400 text-sm">{t('admin.library.reorganizeDesc')}</p>
        <button
          onClick={reorganize}
          disabled={running}
          className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-full text-sm font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50"
        >
          <FolderSync size={15} className={running ? 'animate-spin' : ''} />
          {running ? t('admin.library.reorganizing') : t('admin.library.reorganizeBtn')}
        </button>
        {status && !status.error && (
          <p className="text-sm text-zinc-300">
            {t('admin.library.reorganizeDone', { moved: status.moved, skipped: status.skipped })}
            {status.errors > 0 && <span className="text-red-400">{t('admin.library.errors', { n: status.errors })}</span>}
          </p>
        )}
        {status?.error && <p className="text-sm text-red-400">{status.error}</p>}
      </div>
    </div>
  );
}

export default function Admin() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('users');

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-white mb-5">{t('admin.title')}</h1>

      {/* Tab bar */}
      <div className="flex gap-1 bg-zinc-800/60 rounded-xl p-1 mb-6 w-fit flex-wrap">
        {[['users', t('admin.tabs.users')], ['collections', t('admin.tabs.collections')], ['library', t('admin.tabs.library')], ['updates', t('admin.tabs.updates')]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === key ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'users' && <UsersTab />}
      {tab === 'collections' && <CollectionsTab />}
      {tab === 'library' && <LibraryTab />}
      {tab === 'updates' && <UpdatesTab />}
    </div>
  );
}
