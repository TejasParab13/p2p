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
	socket.on("join-room", (roomId) => {
		if (typeof roomId === "string" && roomId.trim()) {
			socket.join(roomId.trim());
		}
	});

	// 🔥 Fixed: accept and invoke the ack callback
	socket.on("signal", (data, callback) => {
		if (!data || typeof data.room !== "string" || !data.signal) {
			if (typeof callback === "function")
				callback({ error: "invalid signal" });
			return;
		}
		socket.to(data.room.trim()).emit("signal", data.signal);
		if (typeof callback === "function") callback({ ok: true });
	});
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => {
	console.log(`Signaling server running on port ${PORT}`);
});
