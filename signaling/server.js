const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

app.use((req, res, next) => {
	res.setHeader("Access-Control-Allow-Origin", "*");
	next();
});

const server = http.createServer(app);

const io = new Server(server, {
	cors: {
		origin: "*",
		methods: ["GET", "POST"],
	},
});

app.get("/", (req, res) => {
	res.send("P2P signaling server running");
});

app.get("/health", (req, res) => {
	res.json({ status: "ok" });
});

io.on("connection", (socket) => {
	console.log(`Client connected: ${socket.id}`);

	socket.on("join-room", (roomId) => {
		if (typeof roomId === "string" && roomId.trim()) {
			const trimmed = roomId.trim();
			socket.join(trimmed);
			console.log(`${socket.id} joined room: ${trimmed}`);
			// --- FIX: Send confirmation ---
			socket.emit("room-joined", { room: trimmed });
		} else {
			socket.emit("error", { message: "Invalid room ID" });
		}
	});

	socket.on("signal", (data) => {
		if (!data || typeof data.room !== "string" || !data.signal) return;
		const room = data.room.trim();
		console.log(`Signal from ${socket.id} in room ${room}`);
		socket.to(room).emit("signal", data.signal);
	});

	socket.on("disconnect", () => {
		console.log(`Client disconnected: ${socket.id}`);
	});
});

const PORT = process.env.PORT || 10000;

server.listen(PORT, "0.0.0.0", () => {
	console.log(`Signaling server running on port ${PORT}`);
});
