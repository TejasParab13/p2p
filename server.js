const express = require("express");
const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const { Server } = require("socket.io");

const app = express();

let server;

// Optional HTTPS support:
// HTTPS_KEY=key.pem HTTPS_CERT=cert.pem npm start
if (process.env.HTTPS_KEY && process.env.HTTPS_CERT) {
	server = https.createServer(
		{
			key: fs.readFileSync(process.env.HTTPS_KEY),
			cert: fs.readFileSync(process.env.HTTPS_CERT),
		},
		app,
	);
} else {
	server = http.createServer(app);
}

const io = new Server(server, {
	maxHttpBufferSize: 1e6,
});

app.use(express.static("public"));

function getLanAddresses() {
	const addresses = [];

	try {
		const interfaces = os.networkInterfaces();

		for (const list of Object.values(interfaces)) {
			for (const iface of list || []) {
				if (iface.family === "IPv4" && !iface.internal) {
					addresses.push(iface.address);
				}
			}
		}
	} catch (err) {
		// ignore
	}

	return addresses;
}

app.get("/api/host", (req, res) => {
	const addresses = getLanAddresses();

	res.json({
		host: addresses[0] || req.hostname || "localhost",
	});
});

io.on("connection", (socket) => {
	socket.on("join-room", (roomId) => {
		if (typeof roomId === "string" && roomId.trim()) {
			socket.join(roomId.trim());
		}
	});

	// Important: send signal only to other devices in room, not sender
	socket.on("signal", (data) => {
		if (!data || typeof data.room !== "string" || !data.signal) return;

		socket.to(data.room.trim()).emit("signal", data.signal);
	});
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
	const protocol =
		process.env.HTTPS_KEY && process.env.HTTPS_CERT ? "https" : "http";

	console.log(`Server running on ${protocol}://0.0.0.0:${PORT}`);

	for (const address of getLanAddresses()) {
		console.log(`Open on this device: ${protocol}://${address}:${PORT}`);
	}
});
