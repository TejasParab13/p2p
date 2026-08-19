import { SIGNALING_URL } from "./config.js";
import { showError, setConnectionStatus } from "./utils.js";
import {
	transferHistory,
	renderHistory,
	clearHistory,
	initHistory,
} from "./history.js";
import {
	webrtcState,
	initWebRTC,
	sendFileWebRTC,
	setupDataChannel,
	createPeerConnection,
	flushPendingCandidates,
	resetWebRTC,
} from "./webrtc.js";
import {
	fallbackState,
	initFallback,
	activateFallback,
	sendFileFallback,
	handleFallbackSignal,
	resetFallback,
} from "./fallback.js";

// ---- DOM refs ----
const pcView = document.getElementById("pc-view");
const mobileView = document.getElementById("mobile-view");
const errorBox = document.getElementById("error-box");
const statusText = document.getElementById("status");
const roomUrlText = document.getElementById("room-url");
const fileInputPC = document.getElementById("file-input-pc");
const dropZone = document.getElementById("drop-zone");
const connectionStatus = document.getElementById("connection-status");
const fileInputMobile = document.getElementById("file-input-mobile");
const historyListPC = document.getElementById("history-list");
const historyListMobile = document.getElementById("history-list-mobile");
const historyEmptyPC = document.getElementById("history-empty");
const historyEmptyMobile = document.getElementById("history-empty-mobile");
const switchBtnPC = document.getElementById("switch-mode-btn");
const switchBtnMobile = document.getElementById("switch-mode-mobile");
const modeRadiosPC = document.querySelectorAll('input[name="mode"]');
const modeRadiosMobile = document.querySelectorAll('input[name="mode-mobile"]');

// ---- Init history module ----
initHistory({
	historyListPC,
	historyListMobile,
	historyEmptyPC,
	historyEmptyMobile,
});

// ---- Socket ----
const socket = io(SIGNALING_URL, { transports: ["websocket", "polling"] });

// ---- State ----
let initiatorStarted = false;
let connectErrorCount = 0;
const params = new URLSearchParams(window.location.search);
const urlRoom = (params.get("room") || "").trim();
const isInitiator = Boolean(urlRoom);
const currentRoom = urlRoom || Math.random().toString(36).substring(2, 9);

// ---- Init modules ----
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

// ---- Unified send queue ----
async function processSendQueue() {
	if (webrtcState.isSending || webrtcState.sendQueue.length === 0) return;

	// If fallback is active, skip dataChannel check
	if (!fallbackState.active) {
		if (
			!webrtcState.dataChannel ||
			webrtcState.dataChannel.readyState !== "open"
		) {
			setTimeout(processSendQueue, 2000);
			return;
		}
	}

	webrtcState.isSending = true;
	const file = webrtcState.sendQueue.shift();
	try {
		if (
			webrtcState.dataChannel &&
			webrtcState.dataChannel.readyState === "open" &&
			!fallbackState.active
		) {
			await sendFileWebRTC(file);
		} else if (fallbackState.active) {
			await sendFileFallback(file);
		} else {
			showError("No active connection", errorBox);
		}
	} catch (err) {
		console.error("Send error:", err);
	} finally {
		webrtcState.isSending = false;
		processSendQueue();
	}
}

// ---- Mode selection ----
function getSelectedMode() {
	// PC radios first, then mobile
	for (const radio of modeRadiosPC) {
		if (radio.checked) return radio.value;
	}
	for (const radio of modeRadiosMobile) {
		if (radio.checked) return radio.value;
	}
	return "webrtc";
}

function syncRadios() {
	const mode = getSelectedMode();
	for (const radio of modeRadiosPC) {
		radio.checked = radio.value === mode;
	}
	for (const radio of modeRadiosMobile) {
		radio.checked = radio.value === mode;
	}
}

function applyMode() {
	const mode = getSelectedMode();
	console.log("Applying mode:", mode);

	// Reset WebRTC
	resetWebRTC();
	// Reset fallback
	resetFallback();
	initiatorStarted = false;

	if (mode === "fallback") {
		activateFallback();
		// If we are the initiator, we don't need WebRTC at all
		// But we keep the peer closed, and we rely on fallback.
		// Status is set by activateFallback.
	} else {
		// WebRTC mode
		if (isInitiator) {
			startInitiator();
		} else {
			setConnectionStatus(
				connectionStatus,
				statusText,
				"Waiting for PC...",
				"warn",
			);
		}
	}
}

// ---- WebRTC initiator wrapper ----
function startInitiator() {
	if (initiatorStarted || !window.RTCPeerConnection) return;
	if (getSelectedMode() === "fallback") {
		// This should not happen because applyMode handles fallback
		return;
	}
	initiatorStarted = true;
	const pc = createPeerConnection(currentRoom, null, processSendQueue);
	webrtcState.peerConnection = pc;
	const dc = pc.createDataChannel("file-transfer");
	setupDataChannel(dc, processSendQueue);
	webrtcState.dataChannel = dc;
	pc.createOffer()
		.then((offer) => pc.setLocalDescription(offer))
		.then(() =>
			socket.emit("signal", {
				room: currentRoom,
				signal: {
					sdp: {
						type: pc.localDescription.type,
						sdp: pc.localDescription.sdp,
					},
				},
			}),
		)
		.catch((err) => {
			console.error("Offer error:", err);
			showError(
				"Failed to start WebRTC offer. Try Relay mode.",
				errorBox,
			);
		});
}

// ---- Signaling ----
async function handleSignal(signal) {
	if (!signal || !window.RTCPeerConnection) return;
	// Always handle fallback signals first
	if (signal.type && signal.type.startsWith("file-")) {
		handleFallbackSignal(signal);
		return;
	}
	// If fallback is active, ignore WebRTC signals
	if (getSelectedMode() === "fallback") {
		console.log("Ignoring WebRTC signal because fallback is active");
		return;
	}

	// Ensure peerConnection exists (for non-initiator)
	if (!webrtcState.peerConnection && !isInitiator) {
		const pc = createPeerConnection(currentRoom, null, processSendQueue);
		webrtcState.peerConnection = pc;
	}
	if (!webrtcState.peerConnection) return;
	if (signal.sdp) {
		if (signal.sdp.type === "offer") {
			if (webrtcState.peerConnection.signalingState !== "stable") return;
			await webrtcState.peerConnection.setRemoteDescription(
				new RTCSessionDescription(signal.sdp),
			);
			await flushPendingCandidates();
			const answer = await webrtcState.peerConnection.createAnswer();
			await webrtcState.peerConnection.setLocalDescription(answer);
			socket.emit("signal", {
				room: currentRoom,
				signal: {
					sdp: {
						type: webrtcState.peerConnection.localDescription.type,
						sdp: webrtcState.peerConnection.localDescription.sdp,
					},
				},
			});
		} else if (signal.sdp.type === "answer") {
			if (
				webrtcState.peerConnection.signalingState !== "have-local-offer"
			)
				return;
			await webrtcState.peerConnection.setRemoteDescription(
				new RTCSessionDescription(signal.sdp),
			);
			await flushPendingCandidates();
		}
	} else if (signal.candidate) {
		if (webrtcState.peerConnection.remoteDescription) {
			await webrtcState.peerConnection.addIceCandidate(
				new RTCIceCandidate(signal.candidate),
			);
		} else {
			webrtcState.pendingCandidates.push(signal.candidate);
		}
	}
}

// ---- QR & join ----
function makeQr(roomId) {
	const qrEl = document.getElementById("qrcode");
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
	}
}

function joinAndMaybeStart() {
	connectErrorCount = 0;
	socket.emit("join-room", currentRoom);
	if (isInitiator) {
		const mode = getSelectedMode();
		if (mode === "fallback") {
			// If fallback mode is selected on load, activate immediately
			activateFallback();
		} else {
			startInitiator();
		}
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

if (socket.connected) joinAndMaybeStart();
if (!window.RTCPeerConnection)
	showError("WebRTC not supported. Use Relay mode.", errorBox);

// ---- View setup ----
if (!isInitiator) {
	pcView.classList.remove("hidden");
	makeQr(currentRoom);
	// PC default status
	setConnectionStatus(
		connectionStatus,
		statusText,
		"Waiting for phone to scan...",
		"warn",
	);
} else {
	mobileView.classList.remove("hidden");
	// If fallback is active, status is already set by activateFallback, else show connecting
	if (!fallbackState.active) {
		setConnectionStatus(
			connectionStatus,
			statusText,
			"Connecting to PC...",
			"warn",
		);
	}
}

// ---- File handling ----
async function handleFileSelect(event) {
	const files = event.target.files;
	if (!files || files.length === 0) return;

	// Check if we have a working connection
	const hasWebRTC =
		webrtcState.dataChannel &&
		webrtcState.dataChannel.readyState === "open";
	const hasFallback = fallbackState.active;

	if (!hasWebRTC && !hasFallback) {
		showError(
			"No active connection. Please ensure you are connected or switch to Relay mode.",
			errorBox,
		);
		event.target.value = "";
		return;
	}

	for (let i = 0; i < files.length; i++) webrtcState.sendQueue.push(files[i]);
	event.target.value = "";
	processSendQueue();
}

if (fileInputPC) fileInputPC.addEventListener("change", handleFileSelect);
if (fileInputMobile)
	fileInputMobile.addEventListener("change", handleFileSelect);

if (dropZone && fileInputPC) {
	dropZone.addEventListener("dragover", (e) => {
		e.preventDefault();
		dropZone.classList.add("drop-zone-active");
	});
	dropZone.addEventListener("dragleave", () => {
		dropZone.classList.remove("drop-zone-active");
	});
	dropZone.addEventListener("drop", (e) => {
		e.preventDefault();
		dropZone.classList.remove("drop-zone-active");
		if (e.dataTransfer.files.length) {
			for (let i = 0; i < e.dataTransfer.files.length; i++)
				webrtcState.sendQueue.push(e.dataTransfer.files[i]);
			processSendQueue();
		}
	});
}

// ---- Mode switch buttons ----
if (switchBtnPC) {
	switchBtnPC.addEventListener("click", () => {
		syncRadios();
		applyMode();
	});
}
if (switchBtnMobile) {
	switchBtnMobile.addEventListener("click", () => {
		syncRadios();
		applyMode();
	});
}
for (const radio of modeRadiosPC) {
	radio.addEventListener("change", syncRadios);
}
for (const radio of modeRadiosMobile) {
	radio.addEventListener("change", syncRadios);
}
syncRadios();

// ---- Expose clearHistory to global ----
window.clearHistory = clearHistory;
