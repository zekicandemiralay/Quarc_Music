# Skynet Music

A self-hosted music player for your local network. Stream your music library, download from YouTube, manage users, and listen offline from any device.

**Features:**
- Personalized Home page with Daily Mixes, recently played songs, and listening stats
- Stream from your local music library or download any song from YouTube
- Smart Shuffle — weighted by play count, artist-interleaved so you never hear the same artist twice in a row
- Admin-curated Collections visible to all users
- Per-user Liked Songs and custom playlists — like or add to playlist directly from the player bar
- Listening stats: play counts, streaks, weekly listening time
- Full offline support — download playlists and collections; newly added songs auto-download
- Expanded player view — tap the player bar for a full-screen now-playing screen with swipe-to-close
- PWA — add to your home screen for a native-app experience on mobile
- Desktop app — native installers for Windows, macOS, and Linux built with Tauri — download from [Releases](https://github.com/zekicandemiralay/Skynet_Music/releases/latest)
- Spotify import — upload an Exportify ZIP/CSV and all your playlists are downloaded automatically
- YouTube Music import — upload a Google Takeout export and playlists are downloaded by exact video ID (no searching, perfect matches)

---

## Part 1 — Server Setup

For the person who owns and runs the server.

### Requirements

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose  
- A machine that stays on and is reachable on your local network

That's it. Node.js, nginx, ffmpeg, yt-dlp — everything else runs inside containers.

---

### Step 1 — Clone the repository

```bash
git clone https://github.com/zekicandemiralay/Skynet_Music.git
cd Skynet_Music
```

---

### Step 2 — Configure your environment

```bash
cp .env.example .env
```

Open `.env` and fill in these two values:

```env
# Your server's local IP address
# Windows → run: ipconfig        (look for "IPv4 Address")
# Linux   → run: ip addr show    (look for "inet" under your network interface)
SERVER_IP=192.168.1.x

# Where your music files are stored on the host machine
# Windows example: MUSIC_DIR=C:/Users/YourName/Music
# Linux example:   MUSIC_DIR=/home/yourname/music
MUSIC_DIR=/path/to/your/music
```

The rest of the values have working defaults. In production, change `JWT_SECRET` to a long random string.

---

### Step 3 — Start the server

```bash
docker compose up -d
```

On first start:
- A self-signed TLS certificate is generated automatically for your `SERVER_IP`
- If no `ADMIN_PASSWORD` is set, one is generated and printed once in the logs

To see the generated admin password:

```bash
docker compose logs backend
```

Look for a box like this:

```
╔══════════════════════════════════════════╗
║    Admin account created automatically    ║
║    Username : admin                       ║
║    Password : a3f9c1d8e2b7...            ║
║    Save this — it will not show again     ║
╚══════════════════════════════════════════╝
```

**Write this down** — it is only printed once.

---

### Step 4 — Access the app

```
https://YOUR_SERVER_IP:4000
```

Your browser will warn about an untrusted certificate — this is expected for a self-signed cert. See **Part 2** below for how to properly trust it on any device.

---

### Step 5 — Add your music

1. Log in with `admin` and the generated password
2. Go to **Library** and click **Scan Library** to index your music folder
3. To add more music later, just drop files into your `MUSIC_DIR` folder and scan again

You can also download individual songs from YouTube: go to **YouTube** in the sidebar, search for a song, and click Download.

---

### Step 6 — Seed default collections (optional)

This downloads 15 curated collections (180+ songs) from YouTube and makes them visible to all users:

> Dinner Jazz · Morning Acoustic · Lo-fi Chill · Classical Focus · Workout Pump · Evening R&B · Blues Classics · Bossa Nova · Soul & Motown · Indie Folk · Electronic & House · 80s Classics · 90s Alternative · Hip Hop Classics · Ambient & Sleep

```bash
docker compose exec backend npm run seed
```

The script is **safe to re-run** — songs and collections that already exist are skipped automatically. It downloads songs one at a time with a short pause between each, so **expect it to take 30–60 minutes** for the full set. Internet access is required during seeding.

After seeding, all users will see the collections in the sidebar and on the Home page. As an admin you can edit, add to, or delete any collection from **Admin → Collections**.

---

### Step 7 — Create user accounts

1. Go to **Admin** in the sidebar
2. Click **New User**, enter a username and password
3. Share the server address (`https://YOUR_SERVER_IP:4000`) and their credentials with them
4. Direct them to **Part 2** of this guide to set up their device

---

### Managing Collections (admin)

Collections are curated playlists that appear for all users on the Home page and sidebar. You manage them from **Admin → Collections**.

**Create a collection:**
1. Click **New Collection**, enter a name, description, and pick a colour
2. Open the collection and use the **Library** button to add songs from your existing library, or the **YouTube** button to search for and download a new song directly into the collection

**Edit or delete:** Click the collection name to expand it, then use the edit form or the Delete button.

---

### Updating

```bash
git pull
docker compose up --build -d
```

The database and TLS certificate are stored in Docker volumes and survive rebuilds.

---

### Changing the server IP

If your server's IP address changes, you need to regenerate the certificate:

```bash
# Update SERVER_IP in .env, then:
docker compose down
docker volume rm skynet_music_ssl_certs
docker compose up --build -d
```

Users will need to reinstall the certificate on their devices after this.

---

### Configuration reference

| Variable | Default | Description |
|---|---|---|
| `SERVER_IP` | `127.0.0.1` | Server's LAN IP — embedded in the TLS certificate |
| `HTTP_PORT` | `8080` | Port for certificate download (`http://IP:8080/cert`) |
| `HTTPS_PORT` | `4000` | Port for the main app (`https://IP:4000`) |
| `MUSIC_DIR` | `./music` | Path to the music folder on the host |
| `JWT_SECRET` | *(insecure default)* | Secret for signing login tokens — change this |
| `ADMIN_USERNAME` | `admin` | Admin account username |
| `ADMIN_PASSWORD` | *(auto-generated)* | Set to override; otherwise printed once in logs |
| `SECURE_COOKIE` | `true` | Keep true — required for HTTPS cookie handling |
| `SURFSHARK_USER` | *(empty)* | Surfshark OpenVPN service credential username — routes downloads through VPN |
| `SURFSHARK_PASSWORD` | *(empty)* | Surfshark OpenVPN service credential password |
| `VPN_COUNTRY` | `Netherlands` | VPN server country for downloads |

---

---

## Part 2 — User Setup

For people who have been given an account on the server.

You need two things from the server admin:
- The **server address** (something like `https://192.168.1.x:4000`)
- Your **username and password**

The app runs over HTTPS using a self-signed certificate (not from a public authority like Let's Encrypt). You need to install and trust this certificate once on each device. After that, the app works like any normal website and can be added to your home screen like a native app.

---

### What you'll find in the app

**Home** — Your personal landing page. Shows a greeting, your current listening streak, recently played songs, your playlists for quick access, your Daily Mixes, and any Collections the admin has created.

**Daily Mixes** — Auto-generated playlists based on your listening history:
- *Your Mix* — songs you've been playing most
- *Rediscovery* — songs in the library you haven't heard in a while
- *Artist Focus* — deep dives into your most-played artists
- *Genre* — playlists by genre, drawn from your library

Mixes refresh each time you log in. Use the **Refresh Mix** button inside a mix to regenerate it on demand.

**Library** — Browse all songs, search, filter, and manage your Liked Songs and playlists.

**YouTube** — Search for any song and download it to the library.

**Collections** — Curated playlists from the admin (e.g. Dinner Jazz, Lo-fi Chill, 80s Classics).

**Stats** — Your listening history: total play count, listening time, streaks, and top songs.

**Smart Shuffle** — When you shuffle any playlist or collection, songs are weighted by how often you've played them and arranged so the same artist never plays back-to-back.

---

### iPhone / iPad

#### Step 1 — Download the certificate

1. Open **Safari** (must be Safari, not Chrome)
2. Go to: `http://YOUR_SERVER_IP:8080/cert`  
   *(use http, not https, and port 8080)*
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

14. Open **Safari** and go to: `https://YOUR_SERVER_IP:4000`
15. Log in with your username and password
16. Browse around for a moment — the app caches itself in the background

> This step (logging in via Safari first) is required before adding to home screen.

#### Step 5 — Add to Home Screen (optional but recommended)

Adding the app to your home screen gives you a full-screen experience with no browser UI, similar to a native app.

17. While on `https://YOUR_SERVER_IP:4000` in Safari, tap the **Share** button (the square with an arrow pointing up, at the bottom of the screen)
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
2. Go to: `http://YOUR_SERVER_IP:8080/cert`  
   *(use http, not https, and port 8080)*
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

12. Open **Chrome** and go to: `https://YOUR_SERVER_IP:4000`
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

1. Go to: `http://YOUR_SERVER_IP:8080/cert`
2. The file `cert.crt` downloads automatically

#### Step 2 — Install and trust

3. Double-click `cert.crt` — **Keychain Access** opens
4. The certificate appears in the list — double-click it to open
5. Expand the **Trust** section at the top
6. Set **"When using this certificate"** to **Always Trust**
7. Close the window
8. Enter your Mac password to confirm

#### Step 3 — Open the app

9. Go to: `https://YOUR_SERVER_IP:4000`
10. Log in with your username and password

---

### Desktop App (Windows / macOS / Linux — recommended)

Download the installer for your platform from the [Releases page](https://github.com/zekicandemiralay/Skynet_Music/releases/latest):

| Platform | File |
|----------|------|
| Windows | `*_x64-setup.exe` |
| macOS (Apple Silicon M1/M2/M3) | `*_aarch64.dmg` |
| macOS (Intel) | `*_x64.dmg` |
| Linux | `*_amd64.deb` or `*_amd64.AppImage` |

Install it once and launch Skynet Music from your Start menu / Applications / app launcher. Users still need to install the certificate (steps below) before opening the app.

**macOS note:** Right-click the app → Open the first time to bypass the unsigned app warning.

---

### Windows (Chrome, Edge, or Desktop App)

#### Step 1 — Download the certificate

1. Go to: `http://YOUR_SERVER_IP:8080/cert`
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
10. **Restart your browser**

#### Step 3 — Open the app

11. Go to: `https://YOUR_SERVER_IP:4000`
12. Log in with your username and password

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

To remove offline copies, tap the green **Offline** button and confirm.

---

### Importing playlists (Spotify / YouTube Music)

Go to **Import** in the sidebar and choose the source tab.

**From Spotify:**
1. Go to **[exportify.net](https://exportify.net)** and log in with Spotify
2. Click **"Export All"** for all playlists as a ZIP, or export individual playlists as CSVs
3. Upload the file(s) and click **Start Import**

**From YouTube Music:**
1. Go to **[takeout.google.com](https://takeout.google.com)** and sign in
2. Click "Deselect all", then check **"YouTube and YouTube Music"**
3. Click **"All YouTube data included"** and select **playlists only**
4. Click "Next step" → "Create export" and wait for the download email
5. Upload the ZIP and click **Start Import**

Each playlist is created automatically in your account. Songs already in the library are not re-downloaded. Tracks that can't be found are skipped and listed at the end. YouTube Music imports use exact video IDs so every match is perfect.

> Large imports run in the background — you can navigate away and check progress by returning to the Import page. Expect roughly 1 minute per song.

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
Make sure you're using `http://` (not `https://`) and port `8080` (not `4000`).

**Daily Mixes are empty**  
Mixes are generated from your listening history. Play some songs first — after a few listens they will start to populate.
