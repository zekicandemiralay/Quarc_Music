import { useState, useEffect } from 'react';
import { UserPlus, Trash2, ShieldCheck, User, KeyRound, X } from 'lucide-react';

function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-800 rounded-2xl p-6 w-full max-w-sm space-y-4">
        <p className="text-white">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordDialog({ user, onClose }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleReset() {
    setError('');
    if (password.length < 8) { setError('At least 8 characters'); return; }
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
          <h3 className="text-white font-semibold">Reset password — {user.username}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><X size={18} /></button>
        </div>
        {done ? (
          <p className="text-green-400 text-sm">Password reset successfully. Their playlists and liked songs are kept.</p>
        ) : (
          <>
            <p className="text-zinc-400 text-xs">Their playlists and liked songs will be kept after the reset.</p>
            <input
              type="password"
              placeholder="New password (min 8 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-zinc-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              onClick={handleReset}
              className="w-full bg-amber-600 hover:bg-amber-500 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              Reset Password
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function Admin() {
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
    if (res.ok) {
      setNewUsername(''); setNewPassword(''); setShowCreate(false);
      loadUsers();
    } else {
      setCreateError((await res.json()).error || 'Failed');
    }
  }

  async function deleteUser(id) {
    await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    setDeleteTarget(null);
    loadUsers();
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">User Management</h1>
          <p className="text-zinc-500 text-sm mt-0.5">{users.length} account{users.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-full text-sm font-semibold hover:bg-zinc-200 transition-colors"
        >
          <UserPlus size={15} />
          New User
        </button>
      </div>

      {/* Create user form */}
      {showCreate && (
        <div className="bg-zinc-800 rounded-xl p-4 mb-6 space-y-3">
          <h3 className="text-white font-medium text-sm">Create account</h3>
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              className="flex-1 bg-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20 placeholder-zinc-500"
            />
            <input
              type="password"
              placeholder="Password (min 8)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="flex-1 bg-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20 placeholder-zinc-500"
            />
            <button
              onClick={createUser}
              className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors"
            >
              Create
            </button>
          </div>
          {createError && <p className="text-red-400 text-xs">{createError}</p>}
        </div>
      )}

      {/* User list */}
      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 bg-zinc-800/60 rounded-xl px-4 py-3">
            <div className="w-8 h-8 bg-zinc-700 rounded-full flex items-center justify-center shrink-0">
              {u.role === 'admin'
                ? <ShieldCheck size={16} className="text-amber-400" />
                : <User size={16} className="text-zinc-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium">{u.username}</p>
              <p className="text-zinc-500 text-xs capitalize">{u.role} · joined {new Date(u.created_at).toLocaleDateString()}</p>
            </div>
            {u.role !== 'admin' && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setResetTarget(u)}
                  className="p-2 text-zinc-500 hover:text-amber-400 transition-colors"
                  title="Reset password"
                >
                  <KeyRound size={15} />
                </button>
                <button
                  onClick={() => setDeleteTarget(u)}
                  className="p-2 text-zinc-500 hover:text-red-400 transition-colors"
                  title="Delete user"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          message={`Delete "${deleteTarget.username}"? Their account and all personal data will be permanently removed.`}
          onConfirm={() => deleteUser(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {resetTarget && (
        <ResetPasswordDialog user={resetTarget} onClose={() => { setResetTarget(null); }} />
      )}
    </div>
  );
}
