const http = require("http");
const { Server } = require("socket.io");
const Client = require("socket.io-client");
const request = require("supertest");

// Import the server module for testing
const { app, validateRoomId } = require("./server");

// ---------------------------------------------------------------------------
// We create a FRESH server + Socket.IO for each test suite to avoid port
// conflicts with the auto-started server in server.js.
// ---------------------------------------------------------------------------
let httpServer;
let io;
let clientSocket1;
let clientSocket2;
const TEST_PORT = 0; // Let OS assign a free port

beforeAll((done) => {
	httpServer = http.createServer(app);
	io = new Server(httpServer, {
		cors: { origin: "*", methods: ["GET", "POST"] },
	});

	// Replicate the socket event handlers from server.js
	io.on("connection", (socket) => {
		socket.on("join-room", (roomId) => {
			const result = validateRoomId(roomId);
			if (result.valid) {
				socket.join(result.sanitized);
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
			socket.to(result.sanitized).emit("signal", data.signal);
			if (typeof callback === "function") {
				callback({ ok: true });
			}
		});
	});

	httpServer.listen(TEST_PORT, () => {
		done();
	});
});

afterAll((done) => {
	if (clientSocket1 && clientSocket1.connected) clientSocket1.disconnect();
	if (clientSocket2 && clientSocket2.connected) clientSocket2.disconnect();
	io.close(() => {
		httpServer.close(done);
	});
});

afterEach(() => {
	if (clientSocket1 && clientSocket1.connected) clientSocket1.disconnect();
	if (clientSocket2 && clientSocket2.connected) clientSocket2.disconnect();
});

function getServerUrl() {
	const addr = httpServer.address();
	return `http://localhost:${addr.port}`;
}

// ===========================================================================
// HTTP Route Tests
// ===========================================================================
describe("HTTP Routes", () => {
	test("GET / returns status text", async () => {
		const res = await request(app).get("/");
		expect(res.status).toBe(200);
		expect(res.text).toContain("P2P signaling server running");
	});

	test("GET /health returns JSON with status ok", async () => {
		const res = await request(app).get("/health");
		expect(res.status).toBe(200);
		expect(res.body.status).toBe("ok");
		expect(typeof res.body.uptime).toBe("number");
	});

	test("GET /nonexistent returns 404", async () => {
		const res = await request(app).get("/nonexistent");
		expect(res.status).toBe(404);
	});
});

// ===========================================================================
// validateRoomId Tests
// ===========================================================================
describe("validateRoomId", () => {
	test("accepts a valid alphanumeric room ID", () => {
		const result = validateRoomId("abc123");
		expect(result.valid).toBe(true);
		expect(result.sanitized).toBe("abc123");
	});

	test("accepts room IDs with hyphens and underscores", () => {
		expect(validateRoomId("my-room_1").valid).toBe(true);
	});

	test("trims whitespace", () => {
		const result = validateRoomId("  room1  ");
		expect(result.valid).toBe(true);
		expect(result.sanitized).toBe("room1");
	});

	test("rejects empty string", () => {
		expect(validateRoomId("").valid).toBe(false);
	});

	test("rejects whitespace-only string", () => {
		expect(validateRoomId("   ").valid).toBe(false);
	});

	test("rejects non-string input", () => {
		expect(validateRoomId(null).valid).toBe(false);
		expect(validateRoomId(undefined).valid).toBe(false);
		expect(validateRoomId(42).valid).toBe(false);
	});

	test("rejects room IDs with special characters", () => {
		expect(validateRoomId("room!@#$").valid).toBe(false);
		expect(validateRoomId("room with spaces").valid).toBe(false);
	});

	test("rejects room IDs exceeding max length", () => {
		const longId = "a".repeat(65);
		expect(validateRoomId(longId).valid).toBe(false);
	});

	test("accepts room IDs at max length boundary", () => {
		const maxId = "a".repeat(64);
		expect(validateRoomId(maxId).valid).toBe(true);
	});

	// ===========================================================================
	// Socket.IO Tests
	// ===========================================================================
	describe("Socket.IO Events", () => {
		test("client can connect to the server", (done) => {
			clientSocket1 = Client(getServerUrl(), {
				transports: ["websocket"],
				forceNew: true,
			});
			clientSocket1.on("connect", () => {
				expect(clientSocket1.connected).toBe(true);
				done();
			});
		});

		test("client can join a room", (done) => {
			clientSocket1 = Client(getServerUrl(), {
				transports: ["websocket"],
				forceNew: true,
			});
			clientSocket1.on("connect", () => {
				clientSocket1.emit("join-room", "test-room");
				setTimeout(() => {
					expect(clientSocket1.connected).toBe(true);
					done();
				}, 100);
			});
		});

		test("signal with invalid data returns error via callback", (done) => {
			clientSocket1 = Client(getServerUrl(), {
				transports: ["websocket"],
				forceNew: true,
			});
			clientSocket1.on("connect", () => {
				clientSocket1.emit("signal", null, (ack) => {
					expect(ack).toEqual({ error: "invalid signal" });
					done();
				});
			});
		});

		test("signal with invalid room ID returns validation error", (done) => {
			clientSocket1 = Client(getServerUrl(), {
				transports: ["websocket"],
				forceNew: true,
			});
			clientSocket1.on("connect", () => {
				clientSocket1.emit("signal", { room: "room!!", signal: { type: "test" } }, (ack) => {
					expect(ack.error).toContain("invalid characters");
					done();
				});
			});
		});

		test("valid signal returns ok callback", (done) => {
			clientSocket1 = Client(getServerUrl(), {
				transports: ["websocket"],
				forceNew: true,
			});
			clientSocket1.on("connect", () => {
				clientSocket1.emit("join-room", "signal-test");
				clientSocket1.emit(
					"signal",
					{ room: "signal-test", signal: { type: "test-data" } },
					(ack) => {
						expect(ack).toEqual({ ok: true });
						done();
					},
				);
			});
		});

		test("signals are relayed to other clients in the same room", (done) => {
			const room = "relay-test";
			clientSocket1 = Client(getServerUrl(), {
				transports: ["websocket"],
				forceNew: true,
			});
			clientSocket2 = Client(getServerUrl(), {
				transports: ["websocket"],
				forceNew: true,
			});

			let connectedCount = 0;
			const onBothConnected = () => {
				connectedCount++;
				if (connectedCount < 2) return;

				clientSocket2.on("signal", (signal) => {
					expect(signal).toEqual({ type: "offer", sdp: "test-sdp" });
					done();
				});

				clientSocket1.emit("signal", {
					room: room,
					signal: { type: "offer", sdp: "test-sdp" },
				});
			};

			clientSocket1.on("connect", () => {
				clientSocket1.emit("join-room", room);
				setTimeout(onBothConnected, 50);
			});

			clientSocket2.on("connect", () => {
				clientSocket2.emit("join-room", room);
				setTimeout(onBothConnected, 50);
			});
		});
	});
});
