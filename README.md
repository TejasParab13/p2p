# P2P Share

Browser-based peer-to-peer file sharing using **WebRTC** (direct) and a **Socket.IO relay** fallback. No sign-up, no file size limits imposed by the app — files transfer directly between browsers whenever possible.

## Features

- **Direct P2P transfers** via WebRTC DataChannels (fastest, no server involvement)
- **Relay fallback** via Socket.IO when P2P connectivity fails (e.g. strict NATs/firewalls)
- **QR code** for easy mobile-to-PC pairing
- **Drag & drop** or click-to-select file uploads
- **Transfer history** with download links for received files
- **Responsive UI** — dedicated layouts for desktop (host/client) and mobile (host/client)
- **No installation required** — runs entirely in the browser

## Architecture

```
┌──────────────┐         WebSocket          ┌──────────────────┐
│  Browser A   │ ◄──────────────────────► │  Signaling Server  │
│  (Host/PC)   │   signaling only          │  (Node + Socket.IO)│
└──────┬───────┘                            └────────┬──────────┘
       │                                              │
       │  WebRTC DataChannel (P2P)                    │  WebSocket
       │  ─── OR ───                                  │
       │  Socket.IO relay (fallback)                  │
       │                                              │
┌──────┴───────┐         WebSocket          ┌─────────┴─────────┐
│  Browser B   │ ◄──────────────────────► │  Signaling Server   │
│  (Client)    │                            │  (same instance)    │
└──────────────┘                            └───────────────────┘
```

## Project Structure

```
p2p-share/
├── docs/                     # Frontend (static site, served via GitHub Pages)
│   ├── index.html            # Main HTML with 4 responsive views
│   ├── style.css             # Custom styles (Inter font, dark theme)
│   ├── allow-firewall.bat    # Windows helper: add firewall rules for browsers
│   ├── remove-firewall.bat   # Windows helper: remove firewall rules
│   └── js/
│       ├── config.js         # Signaling URL, STUN/TURN ICE servers
│       ├── utils.js          # Formatting helpers, error display, status updates
│       ├── components.js     # Reusable UI component builders (ModeSelector, DropZone, HistoryPanel)
│       ├── history.js        # Transfer history state & rendering
│       ├── webrtc.js         # WebRTC peer connection & data channel logic
│       ├── fallback.js       # Socket.IO relay-based file transfer
│       └── main.js           # App orchestrator (views, socket events, file handling)
├── signaling/
│   ├── package.json          # Server dependencies (express, socket.io)
│   ├── server.js             # Signaling server with room management
│   └── server.test.js        # Jest unit tests
├── .gitignore
├── .editorconfig
├── .prettierrc
├── .prettierignore
├── eslint.config.mjs
├── package.json              # Root workspace package.json
├── README.md
└── AGENTS.md                 # Coding conventions for AI assistants
```

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18+ and npm

### 1. Install dependencies

```bash
# Install root dev dependencies (ESLint, Prettier, Jest)
npm install

# Install signaling server dependencies
cd signaling
npm install
```

### 2. Start the signaling server

```bash
cd signaling
npm start
# Server runs on http://localhost:10000
```

### 3. Serve the frontend

The frontend is plain HTML/JS/CSS. Serve the `docs/` folder with any static file server:

```bash
# Using Python
python -m http.server 8080 --directory docs

# Using npx
npx serve docs

# Or simply open docs/index.html in your browser
```

### 4. Connect two devices

1. Open the app on Device A (the **host**) — it will generate a room code and QR code.
2. On Device B (the **client**), either:
   - Scan the QR code, or
   - Enter the room code manually and click **Join**.
3. Select **Direct** (WebRTC) or **Relay** (fallback) transfer mode.
4. Drag & drop or click to select files to send.

## Environment Variables

| Variable      | Default | Description                                     |
| ------------- | ------- | ----------------------------------------------- |
| `PORT`        | `10000` | Port the signaling server listens on            |
| `CORS_ORIGIN` | `*`     | Allowed CORS origin(s) — restrict in production |

### Frontend Configuration

Edit `docs/js/config.js` or set `window.P2P_SIGNALING_URL` before the module loads:

```html
<script>
	window.P2P_SIGNALING_URL = "https://your-server.example.com";
</script>
```

## Scripts

Run from the project root:

| Command                 | Description                      |
| ----------------------- | -------------------------------- |
| `npm start`             | Start the signaling server       |
| `npm test`              | Run server unit tests (Jest)     |
| `npm run test:coverage` | Run tests with coverage report   |
| `npm run lint`          | Lint server code (ESLint)        |
| `npm run lint:fix`      | Auto-fix lint issues             |
| `npm run format`        | Format all files (Prettier)      |
| `npm run format:check`  | Check formatting without changes |

## Testing

```bash
npm test
```

Tests cover:

- HTTP routes (`/`, `/health`)
- Room ID validation (valid IDs, edge cases, invalid characters, length limits)
- Socket.IO events (connect, join-room, signal relay, error callbacks)

## Firewall (Windows)

If WebRTC connections fail on a local network, you may need to allow your browser through the Windows Firewall:

```bash
# Run as Administrator
docs\allow-firewall.bat

# To remove the rules later
docs\remove-firewall.bat
```

## Deployment

### Signaling Server

Deploy the `signaling/` directory to any Node.js host (Render, Railway, Fly.io, etc.):

1. Set `PORT` to the host-assigned port.
2. Set `CORS_ORIGIN` to your frontend domain.

### Frontend

Deploy the `docs/` folder to any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages):

1. Update `SIGNALING_URL` in `docs/js/config.js` to point to your deployed signaling server.

## License

MIT
