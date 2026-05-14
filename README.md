# Skynet Music

A self-hosted music player for your local network. Stream your music library, download from YouTube, manage users, and listen offline from any device.

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

Look for a line like:
```
[auth] Generated admin password: xxxxxxxx
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

---

### Step 6 — Create user accounts

1. Go to **Admin** in the sidebar
2. Click **New User**, enter a username and password
3. Share the server address (`https://YOUR_SERVER_IP:4000`) and their credentials with them
4. Direct them to **Part 2** of this guide to set up their device

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

---

---

## Part 2 — User Setup

For people who have been given an account on the server.

You need two things from the server admin:
- The **server address** (something like `https://192.168.1.x:4000`)
- Your **username and password**

The app runs over HTTPS using a self-signed certificate (not from a public authority like Let's Encrypt). You need to install and trust this certificate once on each device. After that, the app works like any normal website.

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

#### Step 4 — Open the app

14. Open **Safari** and go to: `https://YOUR_SERVER_IP:4000`
15. Log in with your username and password

> The certificate trust step is required for offline listening (service worker) to work. Without it, the app works online but not offline.

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
10. Find and select the downloaded `cert.pem` file
11. The certificate is installed

#### Step 3 — Open the app

12. Open **Chrome** and go to: `https://YOUR_SERVER_IP:4000`
13. Log in with your username and password

> **Note:** On some Android versions the path is different:  
> Settings → Security & privacy → More security settings → Install a certificate

---

### Mac (Safari or Chrome)

#### Step 1 — Download the certificate

1. Go to: `http://YOUR_SERVER_IP:8080/cert`
2. Download the `cert.pem` file

#### Step 2 — Install and trust

3. Double-click the downloaded `cert.pem` file — **Keychain Access** opens
4. The certificate appears in the list — double-click it to open
5. Expand the **Trust** section at the top
6. Set **"When using this certificate"** to **Always Trust**
7. Close the window
8. Enter your Mac password to confirm

#### Step 3 — Open the app

9. Go to: `https://YOUR_SERVER_IP:4000`
10. Log in with your username and password

---

### Windows (Chrome or Edge)

#### Step 1 — Download the certificate

1. Go to: `http://YOUR_SERVER_IP:8080/cert`
2. Download the `cert.pem` file

#### Step 2 — Install the certificate

3. Double-click `cert.pem`
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

Once you have the app working, you can save playlists and songs for listening without internet.

1. Open any playlist or **Liked Songs**
2. Tap the **Save offline** button next to the Shuffle button
3. Wait for the download to complete — the button turns green when done
4. You can now listen to those songs without an internet connection

**Important:** You must visit the app at least once while connected before going offline. The app caches itself in the background on first load.

To remove offline copies, tap the green **Offline** button and confirm.

---

### Troubleshooting

**"Your connection is not private" / certificate warning**  
You haven't installed and trusted the certificate yet. Follow the steps above for your device.

**Certificate Trust Settings doesn't appear on iPhone**  
Make sure you installed the profile through Settings (step 4–9 above), not just downloaded the file. The toggle only appears after the profile is properly installed.

**App loads but offline doesn't work on iPhone**  
Make sure you completed Step 3 (Certificate Trust Settings → toggle ON). Without this step, Safari won't allow the service worker to run.

**Can't find the cert download page**  
Make sure you're using `http://` (not `https://`) and port `8080` (not `4000`).
