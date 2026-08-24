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
const isInitiator = Boolean(urlRoom);
const currentRoom = urlRoom || Math.random().toString(36).substring(2, 9);
let currentMode = "webrtc";
let retryTimeout = null;
let retryStartedAt = null;
const MAX_RETRY_MS = 30000;

// ============================================================
// 3. Device detection & view updater
// ============================================================
function isMobileDevice() {
	return window.innerWidth < 768;
}

function injectComponents(viewId, mode = currentMode) {
	// Determine which containers to inject based on viewId
	const modeContainer = document.getElementById(`${viewId}-mode-container`);
	const dropContainer = document.getElementById(`${viewId}-drop-container`);
	const historyContainer = document.getElementById(
		`${viewId}-history-container`,
	);

	if (modeContainer) {
		modeContainer.innerHTML = ModeSelector({ selected: mode });
	}
	if (dropContainer) {
		// Use unique IDs for each drop zone
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
		// HOST
		if (isMobileDevice()) {
			mobileHostView.classList.remove("hidden");
			injectComponents("mobile-host");
			// QR code generation (need to find the element in this view)
			const qrEl = document.getElementById("qrcode-mobile");
			if (qrEl) makeQr(currentRoom, qrEl);
			// Update room display
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
			// QR code generation
			const qrEl = document.getElementById("qrcode");
			if (qrEl) makeQr(currentRoom, qrEl);
			// Room code display
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
		// CLIENT
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

	// After injecting components, re-attach event listeners for file inputs and drop zones
	attachFileHandlers();
	attachModeListeners();
	attachFilterListeners();

	// Re-initialise history module with the new history list IDs
	// We need to map the current view's history list and empty IDs.
	// We'll use a consistent naming pattern.
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
		// history.js expects both PC and mobile list elements – we'll store them accordingly.
		// We'll assign the current view's list to both PC and mobile references so history renders in the visible view.
		// This is a bit hacky but works because only one view is visible.
		// We'll update the module's internal refs.
		import("./history.js").then((module) => {
			module.historyListPC = listEl;
			module.historyListMobile = listEl; // both point to the same visible list
			module.historyEmptyPC = emptyEl;
			module.historyEmptyMobile = emptyEl;
			module.renderHistory();
		});
	}
}

// ----- Attach file input and drop zone handlers (delegated) -----
function attachFileHandlers() {
	// Use event delegation on document
	// We already have delegated listeners in place – we'll add them once.
	// Since we use delegation, we don't need to reattach per view.
}

// ----- Mode listener (delegated) -----
function attachModeListeners() {
	const radios = document.querySelectorAll('input[name="mode"]');
	radios.forEach((radio) => {
		radio.removeEventListener("change", handleModeChange);
		radio.addEventListener("change", handleModeChange);
	});
}

function handleModeChange(e) {
	const radio = e.target;
	if (radio.checked) {
		// Update slider if present
		const slider = document.getElementById("mode-slider");
		if (slider) {
			const selected = document.querySelector(
				'input[name="mode"]:checked',
			);
			if (selected) {
				const labels = document.querySelectorAll("label[data-mode]");
				let index = 0;
				for (const label of labels) {
					if (label.querySelector('input[type="radio"]') === selected)
						break;
					index++;
				}
				slider.style.transform = `translateX(${index * 100}%)`;
			}
		}
		applyMode();
	}
}

function attachFilterListeners() {
	const radios = document.querySelectorAll('input[name="filter"]');
	radios.forEach((radio) => {
		radio.removeEventListener("change", handleFilterChange);
		radio.addEventListener("change", handleFilterChange);
	});
}

function handleFilterChange(e) {
	const radio = e.target;
	if (radio.checked) setFilter(radio.value);
}

// Window resize
let resizeTimeout;
window.addEventListener("resize", () => {
	clearTimeout(resizeTimeout);
	resizeTimeout = setTimeout(updateView, 300);
});

// ============================================================
// 4. Join room (used by all join buttons)
// ============================================================
window.joinRoom = function () {
	// Find the visible room code input (could be in any view)
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
// 5. Mode management
// ============================================================
function getSelectedMode() {
	const checked = document.querySelector('input[name="mode"]:checked');
	return checked ? checked.value : currentMode;
}

function setModeFromSignal(mode) {
	if (mode !== "webrtc" && mode !== "fallback") return;
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
	const mode = getSelectedMode();
	const hadDirectConnection = !!(
		webrtcState.dataChannel && webrtcState.dataChannel.readyState === "open"
	);
	if (mode === "fallback" && hadDirectConnection) setSwitchingToRelay(true);
	resetWebRTC();
	resetFallback();
	initiatorStarted = false;

	if (mode === "fallback") {
		activateFallback(hadDirectConnection);
		if (!isInitiator) {
			socket.emit("signal", {
				room: currentRoom,
				signal: { type: "mode-change", mode: "fallback" },
			});
		}
		if (!hadDirectConnection && !fallbackState.peerConnected) {
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

// ============================================================
// 6. WebRTC initiator
// ============================================================
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
// 9. Signal handler (unchanged)
// ============================================================
async function handleSignal(signal) {
	if (!signal || typeof signal !== "object") return;
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
	if (getSelectedMode() === "fallback") {
		console.log("Ignoring WebRTC signal because fallback is active");
		return;
	}
	if (!window.RTCPeerConnection) return;
	if (!webrtcState.peerConnection && !isInitiator) {
		webrtcState.peerConnection = createPeerConnection(
			currentRoom,
			null,
			processSendQueue,
		);
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

// ============================================================
// 10. QR Code generator (pass the target element)
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
		applyMode();
	}
}

socket.on("signal", (signal) =>
	handleSignal(signal).catch((err) =>
		showError("Signaling error: " + err.message, errorBox),
	),
);
socket.on("connect", joinAndMaybeStart);
socket.on("connect_error", (err) => {
	connectErrorCount += 1;
	if (connectErrorCount >= 3)
		showError(`Signaling connection failed: ${err.message}`, errorBox);
});

if (socket.connected) joinAndMaybeStart();
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

// Drop zone delegation
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
// 14. Expose clearHistory globally
// ============================================================
window.clearHistory = clearHistory;

// ============================================================
// 15. Load event
// ============================================================
window.addEventListener("load", () => {
	attachModeListeners();
	attachFilterListeners();
	applyMode();
});
