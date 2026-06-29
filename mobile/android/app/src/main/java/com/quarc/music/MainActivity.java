package com.quarc.music;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MusicServicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
