import { SIGNALING_URL } from "./config.js";
import { showError, setConnectionStatus } from "./utils.js";
import {
	transferHistory,
	renderHistory,
	clearHistory,
	initHistory,
	setFilter,
} from "./history.js";
import {
	webrtcState,
	initWebRTC,
	sendFileWebRTC,
	setupDataChannel,
	createPeerConnection,
	flushPendingCandidates,
	resetWebRTC,
	setSwitchingToRelay,
} from "./webrtc.js";
import {
	fallbackState,
	initFallback,
	activateFallback,
	sendFileFallback,
	handleFallbackSignal,
	resetFallback,
} from "./fallback.js";

// ---- Component builders ----
import { ModeSelector, DropZone, HistoryPanel } from "./components.js";

// ============================================================
// 1. DOM references
// ============================================================
const pcHostView = document.getElementById("pc-host-view");
const pcClientView = document.getElementById("pc-client-view");
const mobileHostView = document.getElementById("mobile-host-view");
const mobileClientView = document.getElementById("mobile-client-view");

const errorBox = document.getElementById("error-box");
const statusText = document.getElementById("status");
const roomUrlText = document.getElementById("room-url");
const connectionStatus = document.getElementById("connection-status");

// ============================================================
// 2. Socket & room logic
// ============================================================
const socket = io(SIGNALING_URL, { transports: ["websocket", "polling"] });

let initiatorStarted = false;
let connectErrorCount = 0;
const params = new URLSearchParams(window.location.search);
const urlRoom = (params.get("room") || "").trim();
const isInitiator = Boolean(urlRoom); // true → client (phone), false → host (PC)
const currentRoom = urlRoom || Math.random().toString(36).substring(2, 9);
let currentMode = "webrtc";
let retryTimeout = null;
let retryStartedAt = null;
const MAX_RETRY_MS = 30000;
let modeChangeInProgress = false; // prevent concurrent mode changes

// ============================================================
// 3. Device detection & view updater
// ============================================================
function isMobileDevice() {
	return window.innerWidth < 768;
}

function injectComponents(viewId, mode = currentMode) {
	const modeContainer = document.getElementById(`${viewId}-mode-container`);
	const dropContainer = document.getElementById(`${viewId}-drop-container`);
	const historyContainer = document.getElementById(
		`${viewId}-history-container`,
	);

	if (modeContainer) {
		modeContainer.innerHTML = ModeSelector({ selected: mode });
	}
	if (dropContainer) {
		const dropId = `drop-${viewId}`;
		const inputId = `file-input-${viewId}`;
		dropContainer.innerHTML = DropZone({ id: dropId, inputId: inputId });
	}
	if (historyContainer) {
		const listId = `history-list-${viewId}`;
		const emptyId = `history-empty-${viewId}`;
		historyContainer.innerHTML = HistoryPanel({ listId, emptyId });
	}
}

function updateView() {
	// Hide all
	[pcHostView, pcClientView, mobileHostView, mobileClientView].forEach((el) =>
		el?.classList.add("hidden"),
	);

	if (!isInitiator) {
		// HOST (PC)
		if (isMobileDevice()) {
			mobileHostView.classList.remove("hidden");
			injectComponents("mobile-host");
			const qrEl = document.getElementById("qrcode-mobile");
			if (qrEl) makeQr(currentRoom, qrEl);
			const roomDisplay = document.getElementById(
				"room-code-display-mobile",
			);
			if (roomDisplay) roomDisplay.textContent = currentRoom;
			setConnectionStatus(
				document.getElementById("connection-status-mobile"),
				null,
				"Waiting for phone to scan...",
				"warn",
			);
		} else {
			pcHostView.classList.remove("hidden");
			injectComponents("pc-host");
			const qrEl = document.getElementById("qrcode");
			if (qrEl) makeQr(currentRoom, qrEl);
			const roomDisplay = document.getElementById("room-code-display");
			if (roomDisplay) roomDisplay.textContent = currentRoom;
			setConnectionStatus(
				document.getElementById("connection-info"),
				statusText,
				"Waiting for phone to scan...",
				"warn",
			);
		}
	} else {
		// CLIENT (phone)
		if (isMobileDevice()) {
			mobileClientView.classList.remove("hidden");
			injectComponents("mobile-client");
			setConnectionStatus(
				document.getElementById("connection-status-mobile-client"),
				null,
				"Connecting to PC...",
				"warn",
			);
		} else {
			pcClientView.classList.remove("hidden");
			injectComponents("pc-client");
			setConnectionStatus(
				document.getElementById("connection-info-client"),
				statusText,
				"Connecting to PC...",
				"warn",
			);
		}
	}

	// Attach listeners
	attachModeListeners();
	attachFilterListeners();

	// Re-init history – use initHistory instead of dynamic import
	const viewPrefix = isInitiator
		? isMobileDevice()
			? "mobile-client"
			: "pc-client"
		: isMobileDevice()
			? "mobile-host"
			: "pc-host";
	const listId = `history-list-${viewPrefix}`;
	const emptyId = `history-empty-${viewPrefix}`;
	const listEl = document.getElementById(listId);
	const emptyEl = document.getElementById(emptyId);
	if (listEl && emptyEl) {
		initHistory({
			historyListPC: listEl,
			historyListMobile: listEl,
			historyEmptyPC: emptyEl,
			historyEmptyMobile: emptyEl,
		});
		renderHistory();
	}
}

// ----- Listeners (delegated) -----
function attachModeListeners() {
	document.querySelectorAll('input[name="mode"]').forEach((radio) => {
		radio.removeEventListener("change", handleModeChange);
		radio.addEventListener("change", handleModeChange);
	});
}

function handleModeChange(e) {
	const radio = e.target;
	if (radio.checked) {
		const newMode = radio.value;
		if (newMode === currentMode && webrtcState.peerConnection) {
			// Already in this mode, ignore
			console.log("[Mode] already in mode:", newMode);
			return;
		}
		console.log("[Mode] changed to:", newMode);
		currentMode = newMode;
		applyMode();
	}
}

function attachFilterListeners() {
	document.querySelectorAll('input[name="filter"]').forEach((radio) => {
		radio.removeEventListener("change", handleFilterChange);
		radio.addEventListener("change", handleFilterChange);
	});
}

function handleFilterChange(e) {
	const radio = e.target;
	if (radio.checked) setFilter(radio.value);
}

let resizeTimeout;
window.addEventListener("resize", () => {
	clearTimeout(resizeTimeout);
	resizeTimeout = setTimeout(updateView, 300);
});

// ============================================================
// 4. Join room (used by all join buttons)
// ============================================================
window.joinRoom = function () {
	const inputs = document.querySelectorAll('input[id^="room-code-input"]');
	let input = null;
	for (const el of inputs) {
		if (el.closest(".hidden") === null) {
			input = el;
			break;
		}
	}
	if (!input) {
		showError("Room code input not found", errorBox);
		return;
	}
	const code = encodeURIComponent(input.value.trim().toLowerCase());
	if (!code) {
		showError("Please enter a room code", errorBox);
		return;
	}
	const url = new URL(window.location.href);
	url.search = `?room=${code}`;
	window.location.href = url.toString();
};

// ============================================================
// 5. Mode management (core)
// ============================================================
function getSelectedMode() {
	const checked = document.querySelector('input[name="mode"]:checked');
	return checked ? checked.value : currentMode;
}

function setModeFromSignal(mode) {
	if (mode !== "webrtc" && mode !== "fallback") return;
	if (mode === currentMode && webrtcState.peerConnection) {
		console.log("[Signal] mode already", mode, "– ignoring");
		return;
	}
	console.log("[Signal] mode-change received:", mode);
	currentMode = mode;
	document.querySelectorAll('input[name="mode"]').forEach((radio) => {
		radio.checked = radio.value === mode;
	});
	applyMode();
	if (isInitiator && mode === "fallback") {
		setConnectionStatus(
			connectionStatus,
			statusText,
			"Connected via Relay",
			"good",
		);
		fallbackState.peerConnected = true;
	}
}

function applyMode() {
	if (modeChangeInProgress) {
		console.log("[applyMode] already in progress, skipping");
		return;
	}
	modeChangeInProgress = true;

	const mode = getSelectedMode();
	console.log("[applyMode] current mode:", mode, "isInitiator:", isInitiator);

	// If the mode hasn't changed and we already have an active connection, do nothing.
	if (
		mode === currentMode &&
		webrtcState.dataChannel &&
		webrtcState.dataChannel.readyState === "open"
	) {
		console.log("[applyMode] already connected in mode:", mode);
		modeChangeInProgress = false;
		return;
	}

	// Reset state for a clean start (but only if we are actually changing something)
	resetWebRTC();
	resetFallback();
	initiatorStarted = false;

	if (mode === "fallback") {
		// Activate fallback mode
		const hadDirect = !!(
			webrtcState.dataChannel &&
			webrtcState.dataChannel.readyState === "open"
		);
		activateFallback(hadDirect);
		if (!isInitiator) {
			// Host notifies client to switch to fallback
			socket.emit("signal", {
				room: currentRoom,
				signal: { type: "mode-change", mode: "fallback" },
			});
		}
		if (!hadDirect && !fallbackState.peerConnected) {
			setConnectionStatus(
				connectionStatus,
				statusText,
				"Waiting for phone to scan...",
				"warn",
			);
		}
	} else {
		// WebRTC mode
		if (isInitiator) {
			// Client: start the offer
			console.log("[applyMode] Client starting WebRTC initiator...");
			startInitiator();
		} else {
			// Host: wait for offer, but also send a mode-change to client to trigger its offer
			console.log(
				"[applyMode] Host sending mode-change signal to client",
			);
			socket.emit("signal", {
				room: currentRoom,
				signal: { type: "mode-change", mode: "webrtc" },
			});
			setConnectionStatus(
				connectionStatus,
				statusText,
				"Waiting for phone...",
				"warn",
			);
		}
	}
	modeChangeInProgress = false;
}

// ============================================================
// 6. WebRTC initiator (client)
// ============================================================
function startInitiator() {
	if (initiatorStarted) {
		console.log("[startInitiator] already started, skipping");
		return;
	}
	if (!window.RTCPeerConnection) {
		showError("WebRTC not supported. Use Relay mode.", errorBox);
		return;
	}
	if (getSelectedMode() === "fallback") {
		console.log("[startInitiator] skipping because mode is fallback");
		return;
	}

	console.log("[startInitiator] creating offer...");
	initiatorStarted = true;

	const pc = createPeerConnection(currentRoom, null, processSendQueue);
	webrtcState.peerConnection = pc;
	const dc = pc.createDataChannel("file-transfer");
	setupDataChannel(dc, processSendQueue);
	webrtcState.dataChannel = dc;

	pc.createOffer()
		.then((offer) => pc.setLocalDescription(offer))
		.then(() => {
			console.log("[startInitiator] offer created, sending to host");
			socket.emit("signal", {
				room: currentRoom,
				signal: {
					sdp: {
						type: pc.localDescription.type,
						sdp: pc.localDescription.sdp,
					},
				},
			});
		})
		.catch((err) => {
			console.error("[startInitiator] error:", err);
			showError(
				"Failed to start WebRTC offer. Try Relay mode.",
				errorBox,
			);
			initiatorStarted = false;
		});
}

// ============================================================
// 7. Initialise modules
// ============================================================
initWebRTC(
	socket,
	currentRoom,
	isInitiator,
	errorBox,
	connectionStatus,
	statusText,
);
initFallback(
	socket,
	currentRoom,
	errorBox,
	connectionStatus,
	statusText,
	processSendQueue,
);

// ============================================================
// 8. File send queue (unchanged)
// ============================================================
async function processSendQueue() {
	if (webrtcState.isSending || webrtcState.sendQueue.length === 0) return;
	if (!fallbackState.active) {
		if (
			!webrtcState.dataChannel ||
			webrtcState.dataChannel.readyState !== "open"
		) {
			if (!retryStartedAt) retryStartedAt = Date.now();
			if (Date.now() - retryStartedAt > MAX_RETRY_MS) {
				const item = webrtcState.sendQueue.shift();
				const histItem = transferHistory.find((h) => h.id === item.id);
				if (histItem) {
					histItem.status = "error";
					renderHistory();
				}
				showError("Connection timeout. Please try again.", errorBox);
				retryStartedAt = null;
				processSendQueue();
				return;
			}
			if (retryTimeout) clearTimeout(retryTimeout);
			retryTimeout = setTimeout(() => {
				retryTimeout = null;
				processSendQueue();
			}, 2000);
			return;
		}
	}
	retryStartedAt = null;
	webrtcState.isSending = true;
	const item = webrtcState.sendQueue.shift();
	const file = item.file;
	const transferId = item.id;
	try {
		if (
			webrtcState.dataChannel &&
			webrtcState.dataChannel.readyState === "open" &&
			!fallbackState.active
		) {
			await sendFileWebRTC(file, transferId);
		} else if (fallbackState.active) {
			await sendFileFallback(file, transferId);
		} else {
			showError("No active connection", errorBox);
			const histItem = transferHistory.find((h) => h.id === transferId);
			if (histItem) {
				histItem.status = "error";
				renderHistory();
			}
		}
	} catch (err) {
		console.error("Send error:", err);
		const histItem = transferHistory.find((h) => h.id === transferId);
		if (histItem) {
			histItem.status = "error";
			renderHistory();
		}
	} finally {
		webrtcState.isSending = false;
		processSendQueue();
	}
}

// ============================================================
// 9. Signal handler (receives SDP/ICE)
// ============================================================
async function handleSignal(signal) {
	if (!signal || typeof signal !== "object") return;
	console.log(
		"[handleSignal] received:",
		signal.type || (signal.sdp ? "sdp" : "candidate"),
	);

	if (signal.type === "request-mode") {
		if (!isInitiator) {
			const mode = getSelectedMode();
			socket.emit("signal", {
				room: currentRoom,
				signal: { type: "mode-change", mode },
			});
			if (mode === "fallback") {
				setConnectionStatus(
					connectionStatus,
					statusText,
					"Connected via Relay",
					"good",
				);
				fallbackState.peerConnected = true;
			}
		}
		return;
	}
	if (signal.type === "mode-change" && typeof signal.mode === "string") {
		setModeFromSignal(signal.mode);
		return;
	}
	if (signal.type && signal.type.startsWith("file-")) {
		handleFallbackSignal(signal);
		return;
	}

	// WebRTC signals – ignore if in fallback mode
	if (getSelectedMode() === "fallback") {
		console.log(
			"[handleSignal] ignoring WebRTC signal because mode is fallback",
		);
		return;
	}

	// SDP handling
	if (signal.sdp) {
		// Ensure we have a peer connection
		if (!webrtcState.peerConnection) {
			if (isInitiator) {
				// Client already has PC from startInitiator
				console.warn(
					"[handleSignal] no peer connection on client, but should exist",
				);
				return;
			} else {
				// Host: create PC when receiving offer
				console.log(
					"[handleSignal] host creating peer connection for incoming offer",
				);
				webrtcState.peerConnection = createPeerConnection(
					currentRoom,
					null,
					processSendQueue,
				);
			}
		}

		const pc = webrtcState.peerConnection;
		if (signal.sdp.type === "offer") {
			if (pc.signalingState !== "stable") {
				console.warn(
					"[handleSignal] offer ignored, signaling state:",
					pc.signalingState,
				);
				return;
			}
			console.log("[handleSignal] setting remote description (offer)");
			await pc.setRemoteDescription(
				new RTCSessionDescription(signal.sdp),
			);
			await flushPendingCandidates();
			const answer = await pc.createAnswer();
			await pc.setLocalDescription(answer);
			console.log("[handleSignal] sending answer");
			socket.emit("signal", {
				room: currentRoom,
				signal: {
					sdp: {
						type: pc.localDescription.type,
						sdp: pc.localDescription.sdp,
					},
				},
			});
		} else if (signal.sdp.type === "answer") {
			if (pc.signalingState !== "have-local-offer") {
				console.warn(
					"[handleSignal] answer ignored, signaling state:",
					pc.signalingState,
				);
				return;
			}
			console.log("[handleSignal] setting remote description (answer)");
			await pc.setRemoteDescription(
				new RTCSessionDescription(signal.sdp),
			);
			await flushPendingCandidates();
		}
	} else if (signal.candidate) {
		// ICE candidate handling
		const pc = webrtcState.peerConnection;
		if (!pc) {
			console.warn("[handleSignal] no peer connection for candidate");
			return;
		}
		if (pc.remoteDescription) {
			try {
				await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
			} catch (e) {
				console.warn("[handleSignal] failed to add ICE candidate", e);
			}
		} else {
			webrtcState.pendingCandidates.push(signal.candidate);
		}
	}
}

// ============================================================
// 10. QR Code generator
// ============================================================
function makeQr(roomId, qrEl) {
	if (!qrEl) {
		console.warn("QR element not found – skipping QR generation");
		return;
	}
	qrEl.innerHTML = "";
	const u = new URL(window.location.href);
	if (u.pathname && !u.pathname.includes(".") && !u.pathname.endsWith("/"))
		u.pathname += "/";
	u.search = `?room=${roomId}`;
	u.hash = "";
	if (roomUrlText) roomUrlText.textContent = u.toString();
	if (typeof QRCode !== "undefined") {
		new QRCode(qrEl, {
			text: u.toString(),
			width: 140,
			height: 140,
			colorDark: "#09090b",
			colorLight: "#ffffff",
		});
	} else {
		qrEl.textContent = u.toString();
	}
}

// ============================================================
// 11. Socket events and initial load
// ============================================================
function joinAndMaybeStart() {
	connectErrorCount = 0;
	socket.emit("join-room", currentRoom);
	if (isInitiator) {
		socket.emit("signal", {
			room: currentRoom,
			signal: { type: "request-mode" },
		});
		setConnectionStatus(
			connectionStatus,
			statusText,
			"Waiting for PC mode...",
			"warn",
		);
	} else {
		// Host: apply mode now (this will also send mode-change to client)
		// Wait a short moment to ensure the UI is fully injected.
		setTimeout(() => {
			applyMode();
		}, 100);
	}
}

socket.on("signal", (signal) => {
	handleSignal(signal).catch((err) =>
		showError("Signaling error: " + err.message, errorBox),
	);
});
socket.on("connect", joinAndMaybeStart);
socket.on("connect_error", (err) => {
	connectErrorCount += 1;
	if (connectErrorCount >= 3)
		showError(`Signaling connection failed: ${err.message}`, errorBox);
});

if (!window.RTCPeerConnection)
	showError("WebRTC not supported. Use Relay mode.", errorBox);

// ============================================================
// 12. Initial view
// ============================================================
updateView();

// ============================================================
// 13. File selection handlers (delegated)
// ============================================================
async function handleFileSelect(event) {
	const input = event.target;
	const files = input.files;
	if (!files || files.length === 0) return;
	const hasWebRTC =
		webrtcState.dataChannel &&
		webrtcState.dataChannel.readyState === "open";
	const hasFallback = fallbackState.active;
	if (!hasWebRTC && !hasFallback) {
		showError(
			"No active connection. Please ensure you are connected or switch to Relay mode.",
			errorBox,
		);
		input.value = "";
		return;
	}
	for (const file of files) {
		const id = crypto.randomUUID();
		webrtcState.sendQueue.push({ file, id });
		transferHistory.push({
			id,
			name: file.name,
			size: file.size,
			type: file.type || "application/octet-stream",
			direction: "sent",
			status: "queued",
			progress: 0,
			timestamp: new Date(),
			objectUrl: null,
		});
	}
	renderHistory();
	input.value = "";
	processSendQueue();
}

document.addEventListener("change", (e) => {
	if (e.target.matches('input[type="file"]')) handleFileSelect(e);
});

document.addEventListener("dragover", (e) => {
	const dropZone = e.target.closest('[id^="drop-"]');
	if (dropZone) {
		e.preventDefault();
		dropZone.classList.add("drop-zone-active");
	}
});
document.addEventListener("dragleave", (e) => {
	const dropZone = e.target.closest('[id^="drop-"]');
	if (dropZone) {
		e.preventDefault();
		dropZone.classList.remove("drop-zone-active");
	}
});
document.addEventListener("drop", (e) => {
	const dropZone = e.target.closest('[id^="drop-"]');
	if (dropZone) {
		e.preventDefault();
		dropZone.classList.remove("drop-zone-active");
		const files = e.dataTransfer.files;
		if (files.length) {
			const hasWebRTC =
				webrtcState.dataChannel &&
				webrtcState.dataChannel.readyState === "open";
			const hasFallback = fallbackState.active;
			if (!hasWebRTC && !hasFallback) {
				showError(
					"No active connection. Please ensure you are connected or switch to Relay mode.",
					errorBox,
				);
				return;
			}
			for (const file of files) {
				const id = crypto.randomUUID();
				webrtcState.sendQueue.push({ file, id });
				transferHistory.push({
					id,
					name: file.name,
					size: file.size,
					type: file.type || "application/octet-stream",
					direction: "sent",
					status: "queued",
					progress: 0,
					timestamp: new Date(),
					objectUrl: null,
				});
			}
			renderHistory();
			processSendQueue();
		}
	}
});

// ============================================================
// 14. Clear history & load
// ============================================================
window.clearHistory = clearHistory;

window.addEventListener("load", () => {
	attachModeListeners();
	attachFilterListeners();
	// Ensure mode is applied after UI is ready (already called via joinAndMaybeStart)
});
