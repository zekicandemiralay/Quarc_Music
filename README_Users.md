
### User Setup

For people who have been given an account on the server.

You need two things from the server admin:
- The **server address:** `https://skynet.tail5fe1a9.ts.net:4000`
- Your **username and password**

The app uses a trusted Tailscale HTTPS certificate — no certificate installation needed. Just open the URL and log in.

> **Requirement:** You must be connected to the Tailscale network to access the app.

---

### Desktop App — Windows, macOS, Linux (recommended)

The easiest way on a computer is the **Skynet Music desktop app**. Download the installer for your platform:

**[→ Download from GitHub Releases](https://github.com/zekicandemiralay/Skynet_Music/releases/latest)**

| Platform | File to download |
|----------|-----------------|
| Windows | `*_x64-setup.exe` |
| macOS (Apple Silicon M1/M2/M3) | `*_aarch64.dmg` |
| macOS (Intel) | `*_x64.dmg` |
| Linux | `*_amd64.deb` or `*_amd64.AppImage` |

> **macOS:** Right-click the app → Open the first time to bypass the unsigned app warning.

1. Install the desktop app
2. Make sure Tailscale is connected
3. Launch **Skynet Music** and log in

---

### iPhone / iPad

1. Make sure Tailscale is connected on your phone
2. Open **Safari** and go to: `https://skynet.tail5fe1a9.ts.net:4000`
3. Log in with your username and password
4. Browse around for a moment — the app caches itself in the background

#### Add to Home Screen (recommended)

Adding the app to your home screen gives you a full-screen experience with no browser UI, similar to a native app.

5. While on the app in Safari, tap the **Share** button (square with an arrow, at the bottom of the screen)
6. Scroll down and tap **Add to Home Screen**
7. Edit the name if you like, then tap **Add**
8. Tap the icon on your home screen and log in once (the home screen app has its own session — this is normal iOS behaviour)

After this, the app works fully offline from the home screen icon for any playlists you've saved offline.

---

### Android

1. Make sure Tailscale is connected on your phone
2. Open **Chrome** and go to: `https://skynet.tail5fe1a9.ts.net:4000`
3. Log in with your username and password

#### Add to Home Screen (recommended)

4. Tap the **three-dot menu** (top-right) → **Add to Home screen** → **Add**
5. The icon appears on your home screen — tap it to open

> On Android, the home screen app shares its session with Chrome, so you will already be logged in.

---

### Mac (browser)

1. Make sure Tailscale is connected
2. Go to `https://skynet.tail5fe1a9.ts.net:4000` in any browser
3. Log in with your username and password

---

### Windows (browser)

1. Make sure Tailscale is connected
2. Go to `https://skynet.tail5fe1a9.ts.net:4000` in Chrome or Edge
3. Log in with your username and password

---

### Setting up offline listening

Once you are logged in and connected:

1. Open any playlist, collection, or **Liked Songs**
2. Tap the **Save offline** button next to the Shuffle button
3. Wait for the download to complete — the button turns green when done
4. You can now listen to those songs without an internet connection

Any song you add to an already-offline playlist is downloaded automatically. Removing a song from an offline playlist removes it from your device.

To remove offline copies, tap the green **Offline** button and confirm.

---

### Importing playlists (Spotify / YouTube Music)

Open **Import** in the sidebar and choose the source tab.

**From Spotify:**
1. Go to **exportify.net** and log in with Spotify
2. Click **"Export All"** to get all playlists as a ZIP — or export individual playlists as CSVs
3. Upload the file(s) and tap **Start Import**

**From YouTube Music:**
1. Go to **takeout.google.com** and sign in with your Google account
2. Click "Deselect all", then check **"YouTube and YouTube Music"**
3. Click **"All YouTube data included"** and select **playlists only**
4. Click "Next step" → "Create export" and wait for the download email
5. Upload the ZIP and tap **Start Import**

Each playlist is created in your account automatically. Tracks that can't be found are skipped and listed at the end. You can navigate away while the import runs and come back to check progress.

> Expect roughly 1 minute per song for large imports.

---

### Troubleshooting

**Can't reach the app**
Make sure Tailscale is running and connected on your device. The app is only accessible over the Tailscale network.

**Home screen app shows a login screen on iPhone**
This is normal on first launch — the home screen app has its own separate session from Safari. Log in once and it will remember you.

**Offline doesn't work after adding to home screen on iPhone**
Make sure you browsed around in Safari first (step 3 above) before adding to home screen. The app needs to cache itself before going offline.

**Daily Mixes are empty**
Mixes are generated from your listening history. Play some songs first — after a few listens they will start to populate.
