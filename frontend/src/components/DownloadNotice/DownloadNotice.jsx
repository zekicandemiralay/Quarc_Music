import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import useDownloadsStore from '../../store/useDownloadsStore';

// "Playing X" / "Added X to queue" — what a "Download & play" or "Download &
// add to queue" announces when it finishes, which can be while you're on a
// different page entirely (the point is not having to wait around). Same look
// as the other toasts in the app.
export default function DownloadNotice() {
  const { t } = useTranslation();
  const notice = useDownloadsStore((s) => s.notice);
  if (!notice) return null;
  return createPortal(
    <div
      key={notice.id}
      className="fixed bottom-24 left-1/2 -translate-x-1/2 max-w-[90vw] truncate bg-white text-black text-sm font-medium px-4 py-2 rounded-full shadow-xl z-[500] pointer-events-none queue-toast"
    >
      {t(notice.kind === 'playing' ? 'youtube.noticePlaying' : 'youtube.noticeQueued', { title: notice.title })}
    </div>,
    document.body
  );
}
