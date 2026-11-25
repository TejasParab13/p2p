const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 10000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const ROOM_ID_PATTERN = /^[0-9]{4}$/;

const app = express();

app.use((_req, res, next) => {
	res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
	next();
});

app.use((req, _res, next) => {
	console.log(`[HTTP] ${req.method} ${req.url}`);
	next();
});

const server = http.createServer(app);
const io = new Server(server, {
	cors: {
		origin: CORS_ORIGIN,
		methods: ["GET", "POST"],
	},
});

app.get("/", (_req, res) => {
	res.send("P2P signaling server running");
});

app.get("/health", (_req, res) => {
	res.json({ status: "ok", uptime: process.uptime() });
});

function validateRoomId(roomId) {
	if (typeof roomId !== "string" || !roomId.trim()) {
		return { valid: false, error: "Room ID must be a non-empty string" };
	}
	const sanitized = roomId.trim();
	if (!ROOM_ID_PATTERN.test(sanitized)) {
		return { valid: false, error: "Room ID must be exactly 4 digits" };
	}
	return { valid: true, sanitized };
}

const pendingFiles = new Map(); // roomId -> Map of id -> { meta, chunks, complete }
const roomClients = new Map(); // roomId -> Set of socket.ids

io.on("connection", (socket) => {
	console.log(`[WS] Client connected: ${socket.id}`);

	socket.on("join-room", (roomId) => {
		const result = validateRoomId(roomId);
		if (!result.valid) {
			console.warn(`[WS] Invalid room ID from ${socket.id}: ${result.error}`);
			return;
		}
		const room = result.sanitized;
		socket.join(room);
		console.log(`[WS] ${socket.id} joined room: ${room}`);

		if (!roomClients.has(room)) {
			roomClients.set(room, new Set());
		}
		roomClients.get(room).add(socket.id);

		if (pendingFiles.has(room)) {
			const roomPendingFiles = pendingFiles.get(room);
			console.log(`[WS] Delivering pending files to ${socket.id} in room ${room}`);
			roomPendingFiles.forEach((fileData, fileId) => {
				if (!fileData.complete) {
					console.log(`[WS] Skipping incomplete file ${fileId}`);
					return;
				}
				console.log(`[WS] Delivering pending file ${fileId} (${fileData.meta.name}) to ${socket.id}`);
				socket.emit("signal", {
					type: "file-meta",
					id: fileId,
					name: fileData.meta.name,
					size: fileData.meta.size,
					fileType: fileData.meta.fileType,
					timestamp: fileData.meta.timestamp,
				});
				if (fileData.chunks && fileData.chunks.length > 0) {
					fileData.chunks.forEach((chunk) => {
						socket.emit("signal", chunk);
					});
				}
				socket.emit("signal", {
					type: "file-end",
					id: fileId,
				});
			});
			pendingFiles.delete(room);
		}
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

		const room = result.sanitized;
		const signal = data.signal;

		if (signal.type && signal.type.startsWith("file-")) {
			const clientsInRoom = io.sockets.adapter.rooms.get(room);
			const otherClientCount = clientsInRoom ? clientsInRoom.size - 1 : 0;

			if (otherClientCount === 0) {
				console.log(`[WS] Storing file signal for offline peer in room ${room}`);
				if (!pendingFiles.has(room)) {
					pendingFiles.set(room, new Map());
				}
				const roomPendingFiles = pendingFiles.get(room);

				if (signal.type === "file-meta") {
					roomPendingFiles.set(signal.id, {
						meta: {
							id: signal.id,
							name: signal.name,
							size: signal.size,
							fileType: signal.fileType,
							timestamp: signal.timestamp || Date.now(),
						},
						chunks: [],
						complete: false,
					});
				} else if (signal.type === "file-chunk") {
					const pendingFile = roomPendingFiles.get(signal.id);
					if (pendingFile) {
						pendingFile.chunks.push(signal);
					}
				} else if (signal.type === "file-end") {
					const pendingFile = roomPendingFiles.get(signal.id);
					if (pendingFile) {
						pendingFile.complete = true;
						console.log(`[WS] File ${signal.id} complete with ${pendingFile.chunks.length} chunks`);
						setTimeout(() => {
							if (roomPendingFiles.has(signal.id)) {
								roomPendingFiles.delete(signal.id);
							}
						}, 24 * 60 * 60 * 1000);
					}
				}

				if (typeof callback === "function") {
					callback({ ok: true, stored: true });
				}
				return;
			}
		}

		socket.to(room).emit("signal", signal);
		if (typeof callback === "function") {
			callback({ ok: true });
		}
	});

	socket.on("disconnect", (reason) => {
		console.log(`[WS] Client disconnected: ${socket.id} (${reason})`);
		roomClients.forEach((clients, room) => {
			if (clients.has(socket.id)) {
				clients.delete(socket.id);
				console.log(`[WS] Removed ${socket.id} from room ${room}`);
			}
		});
	});
});

server.listen(PORT, "0.0.0.0", () => {
	console.log(`Signaling server running on port ${PORT}`);
	console.log(`CORS origin: ${CORS_ORIGIN}`);
});

function shutdown(signal) {
	console.log(`\n[Server] ${signal} received – shutting down gracefully…`);
	io.close(() => {
		server.close(() => {
			console.log("[Server] Closed.");
			process.exit(0);
		});
	});
	setTimeout(() => {
		console.error("[Server] Forced shutdown after timeout");
		process.exit(1);
	}, 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = { app, server, io, validateRoomId };