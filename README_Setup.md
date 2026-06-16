# Quarc Music — Setup

The app runs over Tailscale. Users access it at:

**`https://quarc.tail5fe1a9.ts.net:4000`**

No certificate installation required — Tailscale provides a trusted HTTPS certificate automatically.

---

## Requirements

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Tailscale](https://tailscale.com) installed and running on the server machine
- Tailscale HTTPS Certificates enabled in the [admin console](https://login.tailscale.com/admin/dns) (DNS → HTTPS Certificates → Enable)

---

## Step 1 — Get the Tailscale certificate

Run this once on the server:

```bash
sudo tailscale cert quarc.tail5fe1a9.ts.net
```

This creates the cert files at `/var/lib/tailscale/certs/`. They renew automatically — re-run the command if nginx ever reports a certificate error after renewal.

---

## Step 2 — Clone the repository

```bash
git clone https://github.com/zekicandemiralay/Quarc_Music.git
cd Quarc_Music
```

---

## Step 3 — Configure your environment

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

```env
# Where your music files are stored on the host machine
MUSIC_DIR=/path/to/your/music

# Long random string used to sign login tokens — never share this
JWT_SECRET=change-this-to-a-long-random-string
```

---

## Step 4 — Start the server

```bash
bash deploy.sh
```

On first start, if `ADMIN_PASSWORD` is not set, a random password is generated and printed once in the logs:

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

---

## Step 5 — Access the app

```
https://quarc.tail5fe1a9.ts.net:4000
```

---

## Step 6 — Add your music

1. Log in with `admin` and the password from the logs
2. Go to **Library** and click **Scan Library** to index your music folder
3. To add more music later, drop files into your `MUSIC_DIR` and scan again

---

## Step 7 — Seed default collections (optional)

Downloads 15 curated collections (180+ songs) from YouTube, visible to all users:

```bash
docker compose exec backend npm run seed
```

Safe to re-run — existing songs are skipped. Expect 30–60 minutes for the full set.

---

## Step 8 — Create user accounts

1. Go to **Admin** in the sidebar
2. Click **New User**, enter a username and password
3. Share `https://quarc.tail5fe1a9.ts.net:4000` and their credentials
4. They need Tailscale installed and connected — direct them to **README_Users.md**

---

## Updating

```bash
git pull
bash deploy.sh
```

---

## Configuration reference

| Variable | Default | Description |
|---|---|---|
| `MUSIC_DIR` | `./music` | Path to the music folder on the host |
| `JWT_SECRET` | *(insecure default)* | Secret for signing login tokens — change this |
| `ADMIN_USERNAME` | `admin` | Admin account username |
| `ADMIN_PASSWORD` | *(auto-generated)* | Set to override; otherwise printed once in logs |
| `SECURE_COOKIE` | `true` | Keep true — required for HTTPS cookie handling |
| `YTDLP_RATE_LIMIT` | `2M` | Max download speed for yt-dlp (e.g. `2M`, `500K`) |
| `LASTFM_API_KEY` | *(empty)* | Last.fm API key for the Radio feature |
| `SURFSHARK_USER` | *(empty)* | Surfshark OpenVPN service credential username |
| `SURFSHARK_PASSWORD` | *(empty)* | Surfshark OpenVPN service credential password |
| `VPN_COUNTRY` | `Netherlands` | VPN server country for downloads |
