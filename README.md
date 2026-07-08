# ▶ STREAM — macOS IPTV Player

A bold, modern Xtream Codes IPTV player built with Electron for macOS.

## Features

- 🔐 Xtream Codes login (URL + username + password)
- 📺 Live channel browser with category tabs & search
- 🎬 HLS stream playback via hls.js
- 💾 Auto-saves credentials between sessions
- 🎨 Dark, cinematic macOS UI with hidden titlebar
- 🔇 Volume control & fullscreen support
- ⚡ Retry on stream failure

## Setup

### Prerequisites
- [Node.js](https://nodejs.org/) v18 or newer
- npm (comes with Node.js)

### Install & Run

```bash
# 1. Navigate to this folder
cd iptv-player

# 2. Install dependencies
npm install

# 3. Launch the app
npm start
```

### Build a distributable macOS .app

```bash
npm run build
# Output will be in the /dist folder as a .dmg
```

## Usage

1. Launch the app with `npm start`
2. Enter your Xtream Codes server URL (e.g. `http://yourserver.com:8080`)
3. Enter your username and password
4. Click **Connect**
5. Browse channels in the sidebar — click any to start watching

## Notes

- Streams load via HLS. Most IPTV providers support this out of the box.
- If a stream fails, click **Retry** to reconnect.
- The app bypasses CORS restrictions by routing API calls through Electron's main process.
- Credentials are saved locally and auto-loaded on next launch.

## Troubleshooting

| Problem | Solution |
|---|---|
| "Connection failed" | Double-check your server URL includes the port (e.g. `:8080`) |
| Stream won't play | Try switching the stream extension in `main.js` (`ts` → `m3u8`) |
| Blank video | Your provider may use a non-standard HLS format — check their docs |
