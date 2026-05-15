
### User Setup

For people who have been given an account on the server.

You need two things from the server admin:
- The **server address** (`https://100.115.252.65:4000/`)
- Your **username and password**

The app runs over HTTPS using a self-signed certificate (not from a public authority). You need to install and trust this certificate once on each device. After that, the app works like any normal website and can be added to your home screen like a native app.

---

### Windows — Desktop App (recommended)

The easiest way on Windows is to use the **Skynet Music desktop app** — ask the admin for the installer (`.exe` file), run it, and Skynet Music will appear in your Start menu like any other app.

You still need to install the certificate first:

#### Step 1 — Download the certificate

1. Go to: `http://100.115.252.65:8888/cert`
2. The file `cert.crt` downloads automatically

#### Step 2 — Install the certificate

3. Double-click `cert.crt`
4. Click **Install Certificate**
5. Select **Local Machine** → click **Next**
   *(If asked for administrator permission, click Yes)*
6. Select **"Place all certificates in the following store"** → click **Browse**
7. Select **Trusted Root Certification Authorities** → click **OK**
8. Click **Next** → click **Finish**
9. Click **OK** on the success message

#### Step 3 — Open the app

10. Launch **Skynet Music** from your Start menu
11. Log in with your username and password

> **Using the browser instead?** After installing the certificate, go to `https://100.115.252.65:4000` in Chrome or Edge.

---

### iPhone / iPad

#### Step 1 — Download the certificate

1. Open **Safari** (must be Safari, not Chrome)
2. Go to: `http://100.115.252.65:8888/cert`  
   *(use http, not https, and port 8888)*
3. A prompt appears asking if you want to allow the download — tap **Allow**

#### Step 2 — Install the profile

4. Open the **Settings** app
5. You will see a banner at the top: **"Profile Downloaded"** — tap it
6. Tap **Install** in the top-right corner
7. Enter your iPhone passcode if asked
8. Tap **Install** again on the warning screen
9. Tap **Done**

#### Step 3 — Enable full trust

10. Go to **Settings → General → About**
11. Scroll to the very bottom and tap **Certificate Trust Settings**
12. Find **Skynet Music** and toggle it **ON**
13. Tap **Continue** on the warning

#### Step 4 — Open the app in Safari and log in

14. Open **Safari** and go to: `https://100.115.252.65:4000`
15. Log in with your username and password
16. Browse around for a moment — the app caches itself in the background

> This step (logging in via Safari first) is required before adding to home screen.

#### Step 5 — Add to Home Screen (optional but recommended)

Adding the app to your home screen gives you a full-screen experience with no browser UI, similar to a native app.

17. While on `https://100.115.252.65:4000` in Safari, tap the **Share** button (the square with an arrow pointing up, at the bottom of the screen)
18. Scroll down in the share sheet and tap **Add to Home Screen**
19. Edit the name if you like, then tap **Add** in the top-right corner
20. The Skynet Music icon now appears on your home screen

#### Step 6 — First launch from home screen

21. **Make sure you are connected to the server's network**
22. Tap the Skynet Music icon on your home screen
23. You will see a login screen — **log in again** (the home screen app has its own separate session from Safari, this is normal iOS behavior)
24. Browse around for a moment so the app finishes caching

After this, the app works fully offline from the home screen icon.

---

### Android

#### Step 1 — Download the certificate

1. Open **Chrome**
2. Go to: `http://100.115.252.65:8888/cert`  
   *(use http, not https, and port 8888)*
3. The file downloads automatically (check your notification bar)

#### Step 2 — Install the certificate

4. Open the **Settings** app
5. Go to **Security** (may be under **Biometrics and Security** on Samsung)
6. Tap **More security settings** or **Advanced**
7. Tap **Install a certificate**
8. Tap **CA certificate**
9. Tap **Install anyway** on the warning
10. Find and select the downloaded `cert.crt` file
11. The certificate is installed

#### Step 3 — Open the app and log in

12. Open **Chrome** and go to: `https://100.115.252.65:4000`
13. Log in with your username and password
14. Browse around for a moment — the app caches itself in the background

#### Step 4 — Add to Home Screen (optional but recommended)

15. In Chrome, tap the **three-dot menu** (top-right)
16. Tap **Add to Home screen**
17. Tap **Add**
18. The icon appears on your home screen — tap it to open

> On Android, the home screen app shares its session with Chrome, so you will already be logged in.

> **Note:** On some Android versions the certificate path is different:  
> Settings → Security & privacy → More security settings → Install a certificate

---

### Mac (Safari or Chrome)

#### Step 1 — Download the certificate

1. Go to: `http://100.115.252.65:8888/cert`
2. The file `cert.crt` downloads automatically

#### Step 2 — Install and trust

3. Double-click `cert.crt` — **Keychain Access** opens
4. The certificate appears in the list — double-click it to open
5. Expand the **Trust** section at the top
6. Set **"When using this certificate"** to **Always Trust**
7. Close the window
8. Enter your Mac password to confirm

#### Step 3 — Open the app

9. Go to: `https://100.115.252.65:4000`
10. Log in with your username and password

---

### PC browser — quick bypass (no install)

If you just want to access the app without installing the certificate permanently:

- **Chrome / Edge:** Click anywhere on the warning page and type `thisisunsafe` (no input field — just type it). The page loads immediately.
- **Firefox:** Click **Advanced** → **Accept the Risk and Continue**

> This only bypasses the warning for the current session. The warning reappears after restarting the browser. Offline listening will not work with this method.

---

### Setting up offline listening

Once you are logged in and have browsed around at least once while connected:

1. Open any playlist, collection, or **Liked Songs**
2. Tap the **Save offline** button next to the Shuffle button
3. Wait for the download to complete — the button turns green when done
4. You can now listen to those songs without an internet connection

Any song you add to an already-offline playlist is downloaded automatically.

To remove offline copies, tap the green **Offline** button and confirm.

---

### Importing from Spotify

If you have playlists on Spotify you want to bring over:

1. Go to **exportify.net** and log in with your Spotify account
2. Click **"Export All"** to download all your playlists as a ZIP — or export individual playlists as separate CSV files
3. In Skynet Music, open **Import Spotify** in the sidebar
4. Drop the ZIP file (or select one or more CSV files) and tap **Start Import**
5. Songs are downloaded from YouTube Music in the background — you can navigate away and come back to check progress

Each playlist is created in your account automatically. Tracks that can't be found are skipped and listed at the end.

> Importing a large playlist can take a while — expect roughly 1–2 minutes per song.

---

### Troubleshooting

**"Your connection is not private" / certificate warning**  
You haven't installed and trusted the certificate yet. Follow the steps above for your device.

**Certificate Trust Settings doesn't appear on iPhone**  
Make sure you installed the profile through Settings (steps 4–9 above), not just downloaded the file. The toggle only appears after the profile is properly installed.

**App loads but offline doesn't work on iPhone**  
Make sure you completed Step 3 (Certificate Trust Settings → toggle ON). Without this step, Safari won't allow the service worker to run.

**Home screen app shows a login screen / black screen on iPhone**  
This is normal on first launch — the home screen app has its own separate session from Safari. Make sure you are connected to the server's network, log in, and browse around once. After that it works offline too.

**Can't find the cert download page**  
Make sure you're using `http://` (not `https://`) and port `8888` (not `4000`).

**Daily Mixes are empty**  
Mixes are generated from your listening history. Play some songs first — after a few listens they will start to populate.
