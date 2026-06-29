package com.quarc.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media.session.MediaButtonReceiver;

public class MusicForegroundService extends Service {

    static final String CHANNEL_ID    = "quarc_music_playback";
    static final String ACTION_START  = "com.quarc.music.START";
    static final String ACTION_UPDATE = "com.quarc.music.UPDATE";
    static final String ACTION_STOP   = "com.quarc.music.STOP";
    static final String EXTRA_TITLE   = "title";
    static final String EXTRA_ARTIST  = "artist";
    static final String EXTRA_PLAYING = "isPlaying";
    static final int    NOTIF_ID      = 1;

    private PowerManager.WakeLock wakeLock;
    private MediaSessionCompat mediaSession;
    private boolean isPlaying    = true;
    private String currentTitle  = "Quarc Music";
    private String currentArtist = "";

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        setupMediaSession();
    }

    private void setupMediaSession() {
        mediaSession = new MediaSessionCompat(this, "QuarcMusic");
        mediaSession.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS |
            MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay()           { dispatchControl("play");     }
            @Override public void onPause()          { dispatchControl("pause");    }
            @Override public void onSkipToNext()     { dispatchControl("next");     }
            @Override public void onSkipToPrevious() { dispatchControl("previous"); }
            @Override public void onStop()           { dispatchControl("stop");     }
        });
        mediaSession.setActive(true);
    }

    private void dispatchControl(String action) {
        MusicServicePlugin plugin = MusicServicePlugin.instance;
        if (plugin == null) return;
        // notifyListeners must run on the main thread
        new Handler(Looper.getMainLooper()).post(() -> plugin.notifyMediaControl(action));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_STICKY;
        String action = intent.getAction();

        if (ACTION_STOP.equals(action)) {
            releaseWakeLock();
            if (mediaSession != null) {
                mediaSession.setActive(false);
                mediaSession.release();
                mediaSession = null;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
            stopSelf();
            return START_NOT_STICKY;
        }

        // ACTION_START or ACTION_UPDATE: update metadata and play state
        String title  = intent.getStringExtra(EXTRA_TITLE);
        String artist = intent.getStringExtra(EXTRA_ARTIST);
        if (title  != null) currentTitle  = title;
        if (artist != null) currentArtist = artist;

        if (ACTION_START.equals(action)) {
            isPlaying = true;
        } else if (ACTION_UPDATE.equals(action)) {
            isPlaying = intent.getBooleanExtra(EXTRA_PLAYING, isPlaying);
        }

        // Acquire wake lock while playing, release while paused to save battery
        if (isPlaying) {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "QuarcMusic::Playback");
                wakeLock.acquire();
            }
        } else {
            releaseWakeLock();
        }

        updateMediaSession();
        Notification notification = buildNotification();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF_ID, notification);
        }

        return START_STICKY;
    }

    private void updateMediaSession() {
        if (mediaSession == null) return;
        mediaSession.setMetadata(new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE,  currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
            .build());

        long actions = PlaybackStateCompat.ACTION_PLAY_PAUSE
            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
            | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
            | PlaybackStateCompat.ACTION_STOP
            | (isPlaying ? PlaybackStateCompat.ACTION_PAUSE : PlaybackStateCompat.ACTION_PLAY);

        mediaSession.setPlaybackState(new PlaybackStateCompat.Builder()
            .setState(
                isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN,
                isPlaying ? 1f : 0f)
            .setActions(actions)
            .build());
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        if (mediaSession != null) { mediaSession.release(); mediaSession = null; }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Music Playback", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Keeps music streaming in the background");
        channel.setShowBadge(false);
        channel.setSound(null, null);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent launchPi = PendingIntent.getActivity(
            this, 0, launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        PendingIntent prevPi = MediaButtonReceiver.buildMediaButtonPendingIntent(
            this, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS);
        PendingIntent playPausePi = MediaButtonReceiver.buildMediaButtonPendingIntent(
            this, PlaybackStateCompat.ACTION_PLAY_PAUSE);
        PendingIntent nextPi = MediaButtonReceiver.buildMediaButtonPendingIntent(
            this, PlaybackStateCompat.ACTION_SKIP_TO_NEXT);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist.isEmpty() ? "Now Playing" : currentArtist)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(launchPi)
            .setOngoing(isPlaying)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(android.R.drawable.ic_media_previous, "Previous", prevPi)
            .addAction(
                isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                isPlaying ? "Pause" : "Play",
                playPausePi)
            .addAction(android.R.drawable.ic_media_next, "Next", nextPi)
            .setStyle(new MediaStyle()
                .setMediaSession(mediaSession != null ? mediaSession.getSessionToken() : null)
                .setShowActionsInCompactView(0, 1, 2))
            .build();
    }
}
