const webpush = require('web-push');
const { getDb } = require('../db');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
// Required by the Web Push protocol so a push service has a way to contact
// the sender if something's wrong (e.g. sending too aggressively) — not
// used for anything else here.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

// Sends `payload` ({title, body, url}) to every device this user has
// granted notification permission on. Best-effort by design — a push
// failing never blocks or fails whatever triggered it (a friend request is
// still created even if notifying about it doesn't work). A 404/410
// response means the browser's push service has permanently discarded that
// subscription (uninstalled, permission revoked, endpoint expired), so it's
// pruned rather than retried forever.
// Never rejects — callers fire this without awaiting it (see routes/friends.js),
// so a push failure must not become an unhandled rejection.
async function sendPushToUser(userId, payload) {
  try {
    if (!ensureConfigured()) return;
    const db = getDb();
    const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
    const body = JSON.stringify(payload);

    await Promise.all(subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        );
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
        } else {
          console.error(`Push to user ${userId} failed:`, err.message);
        }
      }
    }));
  } catch (err) {
    console.error(`sendPushToUser(${userId}) failed:`, err.message);
  }
}

module.exports = { sendPushToUser, ensureConfigured, VAPID_PUBLIC_KEY };
