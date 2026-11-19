# AGENTS.md — Conventions for AI Coding Assistants

This document describes the project conventions, structure, and guidelines
that any AI assistant (Cline, Copilot, Cursor, etc.) should follow when
working on the **P2P Share** codebase.

## Project Overview

P2P Share is a browser-based file sharing app with two main parts:

1. **Frontend** (`docs/`): Vanilla HTML/CSS/JS using ES modules, Tailwind CSS
   (CDN), and QRCode.js (CDN). No build step required.
2. **Signaling Server** (`signaling/`): Node.js + Express + Socket.IO.
   CommonJS modules.

## Tech Stack

| Layer         | Technology                        | Notes                                        |
| ------------- | --------------------------------- | -------------------------------------------- |
| Frontend JS   | Vanilla ES Modules                | No React/Vue/Angular — plain `import/export` |
| Frontend CSS  | Tailwind CSS (CDN)                | Via `cdn.tailwindcss.com` in `<script>` tag  |
| Frontend Libs | QRCode.js, Socket.IO client       | Loaded via CDN `<script>` tags               |
| Server        | Node.js, Express, Socket.IO       | CommonJS (`require`)                         |
| Tests         | Jest, supertest, socket.io-client | Server-side only                             |
| Linting       | ESLint 9 (flat config)            | `eslint.config.mjs`                          |
| Formatting    | Prettier                          | `.prettierrc`                                |

## Code Style

- **Indentation**: Tabs (not spaces)
- **Semicolons**: Always
- **Quotes**: Double quotes (`"`)
- **Trailing commas**: Always (`"all"`)
- **Line width**: 100 characters
- **Naming**: camelCase for variables/functions, PascalCase for component
  builder functions (e.g., `ModeSelector`, `DropZone`)
- **Console logging**: Use `[Module]` prefix for log messages (e.g.,
  `console.log("[WebRTC] connected")`)
- **Unused params**: Prefix with underscore (`_req`, `_res`)

## File Organization

```
docs/js/config.js      — Constants and configuration
docs/js/utils.js       — Pure utility functions (formatting, UI helpers)
docs/js/components.js  — Reusable HTML component builders (return string HTML)
docs/js/history.js     — Transfer history state management and rendering
docs/js/webrtc.js      — WebRTC peer connection, data channel, file transfer
docs/js/fallback.js    — Socket.IO relay-based file transfer
docs/js/main.js        — App entry point, view management, socket orchestration
```

## Key Patterns

### Frontend Module Communication

- Modules export state objects (e.g., `webrtcState`, `fallbackState`) and
  functions. `main.js` wires them together.
- DOM references are passed as arguments, not accessed via globals.
- Status elements can change on view switches; use
  `setWebRTCStatusElements()` / `setFallbackStatusElements()` to update refs.

### Component Injection

- `components.js` exports functions that return HTML strings.
- `main.js` calls `injectComponents(viewId)` to render them into containers.
- Event listeners are attached after injection via `attachModeListeners()` and
  `attachFilterListeners()`.

### File Transfer Protocol (WebRTC)

1. Sender sends JSON `{ type: "meta", id, name, size, fileType }`
2. Sender sends binary frames: `[4-byte id-length][id-bytes][chunk-data]`
3. Sender sends JSON `{ type: "end", id }`

### File Transfer Protocol (Relay/Fallback)

1. Signal `{ type: "file-meta", id, name, size, fileType }`
2. Signal `{ type: "file-chunk", id, data: base64, offset }`
3. Signal `{ type: "file-end", id }`

### Signaling Protocol

- `join-room`: Client sends room ID to join
- `signal`: Client sends `{ room, signal }` — server relays `signal` to room
- Custom signal types: `mode-change`, `request-mode`, `fallback-ready`

## Testing

- Server tests live in `signaling/server.test.js`
- Run with `npm test` from root or `cd signaling && npm test`
- Tests create a separate HTTP/Socket.IO server on a random port
- Each test gets fresh client sockets (cleaned up in `afterEach`)

## Common Tasks

### Adding a new socket event

1. Add handler in `signaling/server.js` inside `io.on("connection", ...)`
2. Add corresponding test in `signaling/server.test.js`
3. Handle on client in `main.js` `handleSignal()` function

### Modifying the UI

1. If it's a reusable component, update `docs/js/components.js`
2. For layout changes, edit `docs/index.html` (4 views: pc-host, pc-client,
   mobile-host, mobile-client)
3. Custom styles go in `docs/style.css` — Tailwind utility classes are preferred

### Adding new transfer modes

1. Create a new module in `docs/js/` following the pattern of `fallback.js`
2. Export `init`, `activate`, `reset`, `sendFile`, and `handleSignal` functions
3. Wire it into `main.js` `applyMode()` and `processSendQueue()`

## Important Constraints

- **No build step** for the frontend: no webpack, vite, or bundler.
  Everything runs as native ES modules in the browser.
- **No framework** on the frontend: no React, Vue, or Angular.
- **CDN-loaded libraries** (Tailwind, QRCode.js, Socket.IO client) are loaded
  via `<script>` tags in `index.html`, NOT via npm.
- The `docs/` folder name is required for GitHub Pages compatibility.
- The signaling server must remain deployable as a standalone Node.js app.
