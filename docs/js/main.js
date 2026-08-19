import { SIGNALING_URL } from "./config.js";
import { showError, setConnectionStatus } from "./utils.js";
import {
	transferHistory,
	renderHistory,
	clearHistory,
	initHistory,
} from "./history.js";
import {
	peerConnection,
	dataChannel,
	pendingCandidates,
	activeReceives,
	sendQueue,
	isSending,
	initWebRTC,
	sendFileWebRTC,
	setupDataChannel,
	createPeerConnection,
	flushPendingCandidates,
	startInitiator as startWebRTCInitiator,
} from "./webrtc.js";
import {
	fallbackActive,
	initFallback,
	activateFallback,
	sendFileFallback,
	handleFallbackSignal,
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
	if (isSending || sendQueue.length === 0) return;
	if (!dataChannel || dataChannel.readyState !== "open") {
		if (!fallbackActive) {
			setTimeout(processSendQueue, 2000);
			return;
		}
	}
	isSending = true;
	const file = sendQueue.shift();
	try {
		if (dataChannel && dataChannel.readyState === "open") {
			await sendFileWebRTC(file);
		} else if (fallbackActive) {
			await sendFileFallback(file);
		} else {
			showError("No active connection", errorBox);
		}
	} catch (err) {
		console.error("Send error:", err);
	} finally {
		isSending = false;
		processSendQueue();
	}
}

// ---- Mode selection ----
function getSelectedMode() {
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
	if (peerConnection) {
		peerConnection.close();
		// Reset global references
		peerConnection = null;
		dataChannel = null;
		pendingCandidates = [];
		initiatorStarted = false;
	}
	// Reset fallback state
	fallbackActive = false;
	if (mode === "fallback") {
		activateFallback();
	} else {
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
	if (getSelectedMode() === "fallback") return;
	initiatorStarted = true;
	const pc = createPeerConnection(currentRoom, null, processSendQueue);
	// Store in global variable (webrtc.js exports a variable)
	peerConnection = pc;
	const dc = pc.createDataChannel("file-transfer");
	setupDataChannel(dc, processSendQueue);
	dataChannel = dc;
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
	if (signal.type && signal.type.startsWith("file-")) {
		handleFallbackSignal(signal);
		return;
	}
	if (getSelectedMode() === "fallback") return;

	// Ensure peerConnection exists (for non-initiator)
	if (!peerConnection && !isInitiator) {
		const pc = createPeerConnection(currentRoom, null, processSendQueue);
		peerConnection = pc;
	}
	if (!peerConnection) return;
	if (signal.sdp) {
		if (signal.sdp.type === "offer") {
			if (peerConnection.signalingState !== "stable") return;
			await peerConnection.setRemoteDescription(
				new RTCSessionDescription(signal.sdp),
			);
			await flushPendingCandidates();
			const answer = await peerConnection.createAnswer();
			await peerConnection.setLocalDescription(answer);
			socket.emit("signal", {
				room: currentRoom,
				signal: {
					sdp: {
						type: peerConnection.localDescription.type,
						sdp: peerConnection.localDescription.sdp,
					},
				},
			});
		} else if (signal.sdp.type === "answer") {
			if (peerConnection.signalingState !== "have-local-offer") return;
			await peerConnection.setRemoteDescription(
				new RTCSessionDescription(signal.sdp),
			);
			await flushPendingCandidates();
		}
	} else if (signal.candidate) {
		if (peerConnection.remoteDescription)
			await peerConnection.addIceCandidate(
				new RTCIceCandidate(signal.candidate),
			);
		else pendingCandidates.push(signal.candidate);
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
		if (getSelectedMode() === "fallback") {
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

if (!isInitiator) {
	pcView.classList.remove("hidden");
	makeQr(currentRoom);
} else {
	mobileView.classList.remove("hidden");
	setConnectionStatus(
		connectionStatus,
		statusText,
		"Connecting to PC...",
		"warn",
	);
}

// ---- File handling ----
async function handleFileSelect(event) {
	const files = event.target.files;
	if (!files || files.length === 0) return;
	if (
		!fallbackActive &&
		(!dataChannel || dataChannel.readyState !== "open")
	) {
		showError(
			"Waiting for connection. If stuck, switch to Relay mode.",
			errorBox,
		);
		event.target.value = "";
		return;
	}
	for (let i = 0; i < files.length; i++) sendQueue.push(files[i]);
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
				sendQueue.push(e.dataTransfer.files[i]);
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
