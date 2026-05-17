import { useState } from 'react';
import { Menu, WifiOff, ServerCrash } from 'lucide-react';
import Sidebar from '../Sidebar/Sidebar';
import Player from '../Player/Player';
import useNetworkStatus from '../../hooks/useNetworkStatus';

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { online, serverOk } = useNetworkStatus();
  const showBanner = !online || !serverOk;

  return (
    <div className="flex overflow-hidden bg-black h-full">

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setSidebarOpen(false)}>
          <div className="absolute inset-0 bg-black/70" />
        </div>
      )}

      {/* Sidebar — fixed overlay on mobile, static column on desktop */}
      <div className={`
        fixed md:static inset-y-0 left-0 z-50
        transform transition-transform duration-300 ease-in-out md:transform-none
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <Sidebar onNavigate={() => setSidebarOpen(false)} />
      </div>

      {/* Scrollable content area — padded so content never hides under fixed bars */}
      <main className={`flex-1 overflow-y-auto bg-gradient-to-b from-zinc-800 to-zinc-900 pb-[72px] md:pb-24 ${showBanner ? 'pt-[83px] md:pt-[30px]' : 'pt-[53px] md:pt-0'}`}>
        {children}
      </main>

      {/* Mobile top bar — fixed so it stays at top regardless of scroll position */}
      <div className="fixed top-0 left-0 right-0 z-30 flex md:hidden items-center gap-3 px-4 py-3 bg-zinc-900 border-b border-zinc-800">
        <button onClick={() => setSidebarOpen(true)} className="text-zinc-400 hover:text-white transition-colors">
          <Menu size={22} />
        </button>
        <span className="text-white font-bold text-base">Skynet Music</span>
      </div>

      {/* Network status banner */}
      {showBanner && (
        <div className={`fixed top-[53px] md:top-0 left-0 md:left-64 right-0 z-20 flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium ${
          !online ? 'bg-[#1DB954] text-black' : 'bg-amber-600 text-amber-50'
        }`}>
          {!online ? <WifiOff size={13} /> : <ServerCrash size={13} />}
          {!online ? "You're offline" : 'Server not reachable — some features may be unavailable'}
        </div>
      )}

      {/* Player — fixed so it stays at bottom regardless of scroll position */}
      <div className="fixed bottom-0 left-0 right-0 md:left-64 z-30">
        <Player />
      </div>

    </div>
  );
}
