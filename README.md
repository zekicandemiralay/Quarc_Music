# Quarc Music

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
- Desktop app — native installers for Windows, macOS, and Linux built with Tauri — download from [Releases](https://github.com/zekicandemiralay/Quarc_Music/releases/latest)
- Spotify import — upload an Exportify ZIP/CSV and all your playlists are downloaded automatically
- YouTube Music import — upload a Google Takeout export and playlists are downloaded by exact video ID (no searching, perfect matches)

---

## Part 1 — Server Setup

For the person who owns and runs the server.

### Requirements

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose  
- A machine that stays on, running [Tailscale](https://tailscale.com)
- Tailscale HTTPS Certificates enabled in the admin console

That's it. Node.js, nginx, ffmpeg, yt-dlp — everything else runs inside containers.

---

### Step 1 — Clone the repository

```bash
git clone https://github.com/zekicandemiralay/Quarc_Music.git
cd Quarc_Music
```

---

### Step 2 — Configure your environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

```env
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
- nginx serves the Tailscale certificate from `/var/lib/tailscale/certs/`
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
https://quarc.tail5fe1a9.ts.net:4000
```

The app uses a trusted Tailscale certificate — no browser warnings, no certificate installation required on any device.

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
3. Share `https://quarc.tail5fe1a9.ts.net:4000` and their credentials with them
4. Direct them to **README_Users.md** — they just need Tailscale and a browser

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

The database is stored in a Docker volume and survives rebuilds.

---

### Configuration reference

| Variable | Default | Description |
|---|---|---|
| `MUSIC_DIR` | `./music` | Path to the music folder on the host |
| `JWT_SECRET` | *(insecure default)* | Secret for signing login tokens — change this |
| `ADMIN_USERNAME` | `admin` | Admin account username |
| `ADMIN_PASSWORD` | *(auto-generated)* | Set to override; otherwise printed once in logs |
| `SECURE_COOKIE` | `true` | Keep true — required for HTTPS cookie handling |
| `YTDLP_RATE_LIMIT` | `2M` | Max download speed for yt-dlp |
| `LASTFM_API_KEY` | *(empty)* | Last.fm API key for the Radio feature |
| `SURFSHARK_USER` | *(empty)* | Surfshark OpenVPN service credential username |
| `SURFSHARK_PASSWORD` | *(empty)* | Surfshark OpenVPN service credential password |
| `VPN_COUNTRY` | `Netherlands` | VPN server country for downloads |


---

## Part 2 — User Setup

See **[README_Users.md](README_Users.md)** for the full user guide.

**Short version:** Users need Tailscale installed and connected, then just open `https://quarc.tail5fe1a9.ts.net:4000` in any browser. No certificate installation required.
