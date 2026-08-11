# >=22 is required, not just "the current LTS" — yt-dlp's JS-challenge engine
# hard-requires Node >=22.0.0 to consider a `--js-runtimes node` runtime
# "supported" (confirmed via yt-dlp's EJS docs). On node:20, yt-dlp silently
# rejects it and excludes the `web` client (the one bgutil-ytdlp-pot-provider's
# PO token actually applies to) from its default client list, falling back to
# `android_vr` instead — which needs no PO token but has been increasingly
# hitting YouTube's own "Sign in to confirm you're not a bot"/LOGIN_REQUIRED
# on ordinary (non-viral) videos. That silent fallback made check.sh/autoheal's
# canary (a viral video immune to this) look healthy while real downloads on
# a flagged IP kept failing.
FROM node:22-alpine

RUN apk add --no-cache ffmpeg python3 py3-pip && \
    pip3 install --break-system-packages yt-dlp bgutil-ytdlp-pot-provider --upgrade

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

EXPOSE 3001

CMD ["node", "src/index.js"]
