import { useNavigate } from 'react-router-dom';

// Spotify-style "click an artist name anywhere to see everything by them."
// Deliberately a <span>, not a real link — most call sites nest this inside
// a row that's already clickable (plays the song) or right-clickable (opens
// the song's context menu), so stopPropagation keeps an artist click from
// also triggering either of those. `onNavigate` lets a caller close its own
// overlay (lyrics panel, queue sheet, search dropdown) before the route
// changes underneath it.
export default function ArtistLink({ artist, className = '', fallback = null, onNavigate }) {
  const navigate = useNavigate();
  if (!artist) return fallback != null ? <span className={className}>{fallback}</span> : null;
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        onNavigate?.();
        navigate(`/artist/${encodeURIComponent(artist)}`);
      }}
      className={`hover:underline cursor-pointer transition-colors ${className}`}
    >
      {artist}
    </span>
  );
}
