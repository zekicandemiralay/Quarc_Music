import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import useDownloadsStore from '../../store/useDownloadsStore';

// "Playing X" / "Added X to queue" / "Added X to <playlist>" — what a "Download
// & play", "Download & add to queue" or "Download & add to playlist" announces
// when it finishes, which can be while you're on a different page entirely (the
// point is not having to wait around). Same look as the other toasts in the app.
const MESSAGE = {
  playing: 'youtube.noticePlaying',
  queued: 'youtube.noticeQueued',
  playlist: 'youtube.noticePlaylist',
  playlistGone: 'youtube.noticePlaylistGone', // the chosen playlist was deleted mid-download
};

export default function DownloadNotice() {
  const { t } = useTranslation();
  const notice = useDownloadsStore((s) => s.notice);
  if (!notice) return null;
  return createPortal(
    <div
      key={notice.id}
      className="fixed bottom-24 left-1/2 -translate-x-1/2 max-w-[90vw] truncate bg-white text-black text-sm font-medium px-4 py-2 rounded-full shadow-xl z-[500] pointer-events-none queue-toast"
    >
      {t(MESSAGE[notice.kind] || MESSAGE.queued, { title: notice.title, playlist: notice.playlist })}
    </div>,
    document.body
  );
}
