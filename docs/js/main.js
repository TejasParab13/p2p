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
	isSwitchingToRelay,
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
const modeRadiosPC = document.querySelectorAll('input[name="mode"]');
const roomCodeDisplay = document.getElementById("room-code-display");
const roomCodeInput = document.getElementById("room-code-input");
const filterRadios = document.querySelectorAll('input[name="filter"]');

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

// ---- Display room code ----
if (roomCodeDisplay) {
	roomCodeDisplay.textContent = currentRoom;
}

// ---- Join room function ----
window.joinRoom = function () {
	const code = roomCodeInput.value.trim();
	if (!code) {
		showError("Please enter a room code", errorBox);
		return;
	}
	const url = new URL(window.location.href);
	url.search = `?room=${code}`;
	window.location.href = url.toString();
};

// ---- Filter radio listeners ----
filterRadios.forEach((radio) => {
	radio.addEventListener("change", () => {
		if (radio.checked) {
			setFilter(radio.value);
		}
	});
});

// ---- Mode management ----
let currentMode = "webrtc";

function getSelectedMode() {
	for (const radio of modeRadiosPC) {
		if (radio.checked) return radio.value;
	}
	return currentMode;
}

function setModeFromSignal(mode) {
	if (mode !== "webrtc" && mode !== "fallback") return;
	console.log("Mode changed via signal:", mode);
	currentMode = mode;
	for (const radio of modeRadiosPC) {
		radio.checked = radio.value === mode;
	}
	applyMode();
}

function applyMode() {
	const mode = getSelectedMode();
	console.log("Applying mode:", mode);

	// Check if we have an active direct connection
	const hadDirectConnection = !!(
		webrtcState.dataChannel && webrtcState.dataChannel.readyState === "open"
	);

	// If switching to fallback from an active direct connection, set flag to suppress "Data channel closed"
	if (mode === "fallback" && hadDirectConnection) {
		isSwitchingToRelay = true;
	}

	resetWebRTC();
	resetFallback();
	initiatorStarted = false;

	if (mode === "fallback") {
		// Pass whether we had a peer already
		activateFallback(hadDirectConnection);
		if (!isInitiator) {
			socket.emit("signal", {
				room: currentRoom,
				signal: { type: "mode-change", mode: "fallback" },
			});
		}
		// If we didn't have a peer, set status to waiting
		if (!hadDirectConnection) {
			setConnectionStatus(
				connectionStatus,
				statusText,
				"Waiting for phone to scan...",
				"warn",
			);
		}
	} else {
		if (isInitiator) {
			startInitiator();
		} else {
			setConnectionStatus(
				connectionStatus,
				statusText,
				"Waiting for phone...",
				"warn",
			);
			socket.emit("signal", {
				room: currentRoom,
				signal: { type: "mode-change", mode: "webrtc" },
			});
		}
	}
}

// ---- WebRTC initiator wrapper (phone only) ----
function startInitiator() {
	if (initiatorStarted || !window.RTCPeerConnection) return;
	if (getSelectedMode() === "fallback") return;
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

// ---- Signaling ----
async function handleSignal(signal) {
	if (!signal || typeof signal !== "object") return;

	if (signal.type === "mode-change" && typeof signal.mode === "string") {
		setModeFromSignal(signal.mode);
		return;
	}

	if (signal.type && signal.type.startsWith("file-")) {
		handleFallbackSignal(signal);
		return;
	}

	if (getSelectedMode() === "fallback") {
		console.log("Ignoring WebRTC signal because fallback is active");
		return;
	}

	if (!window.RTCPeerConnection) return;

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
		console.warn("QRCode library not loaded – falling back to text");
		qrEl.textContent = u.toString();
	}
}

function joinAndMaybeStart() {
	connectErrorCount = 0;
	socket.emit("join-room", currentRoom);
	if (isInitiator) {
		setConnectionStatus(
			connectionStatus,
			statusText,
			"Waiting for PC mode...",
			"warn",
		);
	} else {
		applyMode();
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
	setConnectionStatus(
		connectionStatus,
		statusText,
		"Waiting for phone to scan...",
		"warn",
	);
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

// ---- Mode change: auto-apply when radio changes ----
for (const radio of modeRadiosPC) {
	radio.addEventListener("change", () => {
		const slider = document.getElementById("mode-slider");
		if (slider) {
			const selected = document.querySelector(
				'input[name="mode"]:checked',
			);
			if (selected) {
				const labels = document.querySelectorAll("label[data-mode]");
				let index = 0;
				for (const label of labels) {
					if (
						label.querySelector('input[type="radio"]') === selected
					) {
						break;
					}
					index++;
				}
				slider.style.transform = `translateX(${index * 100}%)`;
			}
		}
		applyMode();
	});
}

// ---- Initial sync of slider ----
window.addEventListener("load", () => {
	const slider = document.getElementById("mode-slider");
	if (slider) {
		const selected = document.querySelector('input[name="mode"]:checked');
		if (selected) {
			const labels = document.querySelectorAll("label[data-mode]");
			let index = 0;
			for (const label of labels) {
				if (label.querySelector('input[type="radio"]') === selected) {
					break;
				}
				index++;
			}
			slider.style.transform = `translateX(${index * 100}%)`;
		}
	}
	applyMode();
});

// ---- Expose clearHistory to global ----
window.clearHistory = clearHistory;
