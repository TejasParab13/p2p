const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 10000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const MAX_ROOM_ID_LENGTH = 64;
const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();

app.use((_req, res, next) => {
	res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
	next();
});

// Simple request logger
app.use((req, _res, next) => {
	console.log(`[HTTP] ${req.method} ${req.url}`);
	next();
});

const server = http.createServer(app);

// ---------------------------------------------------------------------------
// Socket.IO server
// ---------------------------------------------------------------------------
const io = new Server(server, {
	cors: {
		origin: CORS_ORIGIN,
		methods: ["GET", "POST"],
	},
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get("/", (_req, res) => {
	res.send("P2P signaling server running");
});

app.get("/health", (_req, res) => {
	res.json({ status: "ok", uptime: process.uptime() });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate a room ID string.
 * @param {string} roomId
 * @returns {{ valid: boolean, sanitized?: string, error?: string }}
 */
function validateRoomId(roomId) {
	if (typeof roomId !== "string" || !roomId.trim()) {
		return { valid: false, error: "Room ID must be a non-empty string" };
	}
	const sanitized = roomId.trim();
	if (sanitized.length > MAX_ROOM_ID_LENGTH) {
		return { valid: false, error: `Room ID exceeds max length (${MAX_ROOM_ID_LENGTH})` };
	}
	if (!ROOM_ID_PATTERN.test(sanitized)) {
		return { valid: false, error: "Room ID contains invalid characters" };
	}
	return { valid: true, sanitized };
}

// ---------------------------------------------------------------------------
// Socket events
// ---------------------------------------------------------------------------
io.on("connection", (socket) => {
	console.log(`[WS] Client connected: ${socket.id}`);

	socket.on("join-room", (roomId) => {
		const result = validateRoomId(roomId);
		if (!result.valid) {
			console.warn(`[WS] Invalid room ID from ${socket.id}: ${result.error}`);
			return;
		}
		socket.join(result.sanitized);
		console.log(`[WS] ${socket.id} joined room: ${result.sanitized}`);
	});

	socket.on("signal", (data, callback) => {
		if (!data || typeof data.room !== "string" || !data.signal) {
			if (typeof callback === "function") {
				callback({ error: "invalid signal" });
			}
			return;
		}
		const result = validateRoomId(data.room);
		if (!result.valid) {
			if (typeof callback === "function") {
				callback({ error: result.error });
			}
			return;
		}
		socket.to(result.sanitized).emit("signal", data.signal);
		if (typeof callback === "function") {
			callback({ ok: true });
		}
	});

	socket.on("disconnect", (reason) => {
		console.log(`[WS] Client disconnected: ${socket.id} (${reason})`);
	});
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
server.listen(PORT, "0.0.0.0", () => {
	console.log(`Signaling server running on port ${PORT}`);
	console.log(`CORS origin: ${CORS_ORIGIN}`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(signal) {
	console.log(`\n[Server] ${signal} received – shutting down gracefully…`);
	io.close(() => {
		server.close(() => {
			console.log("[Server] Closed.");
			process.exit(0);
		});
	});
	// Force exit after 5 seconds
	setTimeout(() => {
		console.error("[Server] Forced shutdown after timeout");
		process.exit(1);
	}, 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------
module.exports = { app, server, io, validateRoomId };
