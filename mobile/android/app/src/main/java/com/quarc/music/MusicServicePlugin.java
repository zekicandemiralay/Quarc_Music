package com.quarc.music;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MusicService")
public class MusicServicePlugin extends Plugin {

    private void sendIntent(String action, String title, String artist) {
        Intent intent = new Intent(getContext(), MusicForegroundService.class);
        intent.setAction(action);
        if (title  != null) intent.putExtra(MusicForegroundService.EXTRA_TITLE,  title);
        if (artist != null) intent.putExtra(MusicForegroundService.EXTRA_ARTIST, artist);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        String title  = call.getString("title",  "Quarc Music");
        String artist = call.getString("artist", "");
        sendIntent(MusicForegroundService.ACTION_START, title, artist);
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        String title  = call.getString("title",  "Quarc Music");
        String artist = call.getString("artist", "");
        // Sending ACTION_START again updates the notification
        sendIntent(MusicForegroundService.ACTION_START, title, artist);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        sendIntent(MusicForegroundService.ACTION_STOP, null, null);
        call.resolve();
    }
}
