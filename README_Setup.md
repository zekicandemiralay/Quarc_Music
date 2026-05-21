# Skynet Music — Setup

You need two things from the server admin:
- **Server address:** `https://100.115.252.65:4000`
- **Username and password**

Before you can open the app, you need to install a certificate once on your device. Pick your platform below.

---

## Windows (Desktop App — recommended)

1. Download the installer: [GitHub Releases](https://github.com/zekicandemiralay/Skynet_Music/releases/latest) → `*_x64-setup.exe`
2. Go to `http://100.115.252.65:8888/cert` — `cert.crt` downloads automatically
3. Double-click `cert.crt` → **Install Certificate** → **Local Machine** → **Next**
4. Select **"Place all certificates in the following store"** → **Browse** → **Trusted Root Certification Authorities** → **OK**
5. **Next** → **Finish** → **OK**
6. Launch **Skynet Music** from the Start menu and log in

*Browser instead of desktop app:* After step 5, go to `https://100.115.252.65:4000` in Chrome or Edge.

---

## iPhone / iPad

1. Open **Safari** and go to `http://100.115.252.65:8888/cert` — tap **Allow** to download
2. Open **Settings** → tap the **"Profile Downloaded"** banner at the top → **Install** → enter passcode → **Install** → **Done**
3. Go to **Settings → General → About → Certificate Trust Settings** → find **Skynet Music** → toggle **ON** → **Continue**
4. In Safari, go to `https://100.115.252.65:4000` and log in
5. *(Optional)* Tap **Share → Add to Home Screen** for a full-screen app icon

---

## Android

1. Open **Chrome** and go to `http://100.115.252.65:8888/cert` — the file downloads automatically
2. Open **Settings → Security → More security settings → Install a certificate → CA certificate → Install anyway**
3. Select the downloaded `cert.crt` file
4. Go to `https://100.115.252.65:4000` in Chrome and log in
5. *(Optional)* Tap the three-dot menu → **Add to Home screen**

*On some devices the path is: Settings → Security & privacy → More security settings → Install a certificate*

---

## Mac

1. Go to `http://100.115.252.65:8888/cert` — `cert.crt` downloads automatically
2. Double-click `cert.crt` → **Keychain Access** opens → double-click the certificate
3. Expand **Trust** → set **"When using this certificate"** to **Always Trust** → close → enter your Mac password
4. Go to `https://100.115.252.65:4000` and log in

*Desktop app available:* [GitHub Releases](https://github.com/zekicandemiralay/Skynet_Music/releases/latest) → `*_aarch64.dmg` (Apple Silicon) or `*_x64.dmg` (Intel). Right-click → Open the first time to bypass the unsigned app warning. Certificate still needs to be installed first.
