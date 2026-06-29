# Quarc Music — User Guide

You need two things from the server admin:
- The **server address:** `https://quarcnet0.tail84500c.ts.net:4000`
- Your **username and password**

The app uses a trusted Tailscale HTTPS certificate — no certificate installation needed on any device.

> **Requirement:** You must have [Tailscale](https://tailscale.com) installed and connected to access the app.

---

## Android (native app — recommended)

The Android app gives you the best experience: music keeps playing when your screen is locked, and you get lock screen controls (like Spotify) to skip tracks and pause without unlocking.

**[→ Download Quarc-Music-Android.apk from GitHub Releases](https://github.com/zekicandemiralay/Quarc_Music/releases/latest)**

### First install

1. On your Android phone, open the APK file you downloaded
2. If prompted, tap **Settings** and enable **"Install from unknown sources"** for your file manager or browser, then go back and tap **Install**
3. Open **Quarc Music**, make sure Tailscale is connected, and log in

### Updates

From **v1.0.17** onwards, the app checks for updates automatically. When a new version is available, a green banner appears at the top — tap **Install now** and the app downloads and installs the update without losing any of your offline songs.

---

## iPhone / iPad

1. Make sure Tailscale is connected on your phone
2. Open **Safari** and go to: `https://quarcnet0.tail84500c.ts.net:4000`
3. Log in with your username and password
4. Browse around for a moment — the app caches itself in the background

### Add to Home Screen (recommended)

Adding to your home screen gives you a full-screen experience with no browser UI.

5. Tap the **Share** button (square with arrow, bottom of Safari)
6. Scroll down and tap **Add to Home Screen**
7. Edit the name if you like, then tap **Add**
8. Tap the icon on your home screen and log in once — this is normal, the home screen app has its own session

After this, the app works fully offline from the home screen icon for any content you've saved offline.

---

## Desktop — Windows, macOS, Linux

**[→ Download from GitHub Releases](https://github.com/zekicandemiralay/Quarc_Music/releases/latest)**

| Platform | File to download |
|----------|-----------------|
| Windows | `*_x64-setup.exe` |
| macOS (Apple Silicon M1/M2/M3) | `*_aarch64.dmg` |
| macOS (Intel) | `*_x64.dmg` |
| Linux | `*_amd64.deb` or `*_amd64.AppImage` |

> **macOS:** Right-click the app → Open the first time to bypass the unsigned app warning.

1. Install the desktop app
2. Make sure Tailscale is connected
3. Launch **Quarc Music** and log in

When a new version is released, a banner appears inside the app — click **Install now** to download and run the installer. The installer updates in place, so your offline songs are not affected.

---

## Browser (any device)

If you prefer not to install anything:

1. Make sure Tailscale is connected
2. Open `https://quarcnet0.tail84500c.ts.net:4000` in any browser
3. Log in with your username and password

---

## Offline listening

Once logged in:

1. Open any playlist, collection, or **Liked Songs**
2. Tap the **Save offline** button (next to the Shuffle button)
3. Wait for the download to finish — the button turns green when done
4. You can now listen without a connection

Any song you add to an already-offline playlist is downloaded automatically. Removing a song from an offline playlist removes its local copy. To remove all offline copies, tap the green **Offline** button and confirm.

---

## Importing playlists

Open **Import** in the sidebar and choose the source tab.

**From Spotify:**
1. Go to [exportify.net](https://exportify.net) and log in with Spotify
2. Click **"Export All"** to download all playlists as a ZIP (or individual CSVs)
3. Upload the file(s) in the Import page and tap **Start Import**

**From YouTube Music:**
1. Go to [takeout.google.com](https://takeout.google.com) and sign in
2. Click "Deselect all", then check **YouTube and YouTube Music**
3. Click **"All YouTube data included"** → select **playlists only**
4. Click "Next step" → "Create export" and wait for the download email
5. Upload the ZIP in the Import page and tap **Start Import**

Tracks that can't be found are skipped and listed at the end. You can navigate away while the import runs. Expect roughly 1 minute per song for large imports.

---

## Troubleshooting

**Can't reach the app**
Make sure Tailscale is running and shows as connected. The app is only accessible over the Tailscale network.

**Android APK won't install**
Go to your phone's Settings → Apps → Special app access → Install unknown apps, and allow your file manager or browser.

**Music stops when screen locks (Android)**
Make sure you're using the APK (not the browser). The APK keeps music playing through the lock screen. Also check that battery optimisation is not set to "Restricted" for Quarc Music in Android settings.

**Lock screen controls not showing (Android)**
They appear a moment after music starts playing. If they never show, try restarting the app.

**Home screen app shows a login screen (iPhone)**
Normal on first launch — the home screen app has its own separate session from Safari. Log in once and it remembers you.

**Offline doesn't work after adding to home screen (iPhone)**
Browse around in Safari first (step 3 above) before adding to home screen. The app needs to cache itself before going offline.

**"Server not reachable" flashes briefly on screen unlock**
This is normal — Tailscale takes a second or two to reconnect after the screen wakes up. The banner disappears automatically once the connection is restored.

**Daily Mixes are empty**
Mixes are generated from your listening history. Play some songs first — after a few listens they will start to populate.
