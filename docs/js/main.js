import { SIGNALING_URL } from "./config.js";
import { showError, setConnectionStatus } from "./utils.js";
import { transferHistory, renderHistory, clearHistory, initHistory, setFilter } from "./history.js";
import {
	webrtcState,
	initWebRTC,
	sendFileWebRTC,
	setupDataChannel,
	createPeerConnection,
	flushPendingCandidates,
	resetWebRTC,
	setSwitchingToRelay,
	setWebRTCStatusElements,
} from "./webrtc.js";
import {
	fallbackState,
	initFallback,
	activateFallback,
	sendFileFallback,
	handleFallbackSignal,
	resetFallback,
	setFallbackStatusElements,
} from "./fallback.js";
import { ModeSelector, DropZone, HistoryPanel, ChatPanel, SectionTabs } from "./components.js";

const pcHostView = document.getElementById("pc-host-view");
const pcClientView = document.getElementById("pc-client-view");
const mobileHostView = document.getElementById("mobile-host-view");
const mobileClientView = document.getElementById("mobile-client-view");
const errorBox = document.getElementById("error-box");
const roomUrlText = document.getElementById("room-url");

const socket = io(SIGNALING_URL, { transports: ["websocket", "polling"] });

let initiatorStarted = false;
let connectErrorCount = 0;

const params = new URLSearchParams(window.location.search);
const urlRoom = (params.get("room") || "").trim();
const isInitiator = Boolean(urlRoom); // true → client (phone), false → host (PC)

// Generate a 4-digit code (0000–9999) with leading zeros
const currentRoom =
	urlRoom || String(Math.floor(Math.random() * 10000)).padStart(4, "0");

let currentMode = "webrtc";
let currentSectionTab = "transfers";
let chatHistory = [];
let retryTimeout = null;
let retryStartedAt = null;
const MAX_RETRY_MS = 30000;
let modeChangeInProgress = false;
let hasPeer = false;
let currentConnStatusEl = null;
let currentStatusTextEl = null;

function isMobileDevice() {
	return window.innerWidth < 768;
}

function getCurrentViewId() {
	if (!isInitiator) {
		return isMobileDevice() ? "mobile-host" : "pc-host";
	} else {
		return isMobileDevice() ? "mobile-client" : "pc-client";
	}
}

function injectComponents(viewId, mode = currentMode) {
	const navContainer = document.getElementById(`${viewId}-nav-container`);
	const modeContainer = document.getElementById(`${viewId}-mode-container`);
	const dropContainer = document.getElementById(`${viewId}-drop-container`);
	const historyContainer = document.getElementById(`${viewId}-history-container`);
	const chatContainer = document.getElementById(`${viewId}-chat-container`);

	if (navContainer) {
		navContainer.innerHTML = SectionTabs({ viewId, active: currentSectionTab });
	}
	if (modeContainer) {
		modeContainer.innerHTML = ModeSelector({ selected: mode });
	}
	if (dropContainer) {
		const dropId = `drop-${viewId}`;
		const inputId = `file-input-${viewId}`;
		dropContainer.innerHTML = DropZone({ id: dropId, inputId: inputId });
		const fileInput = dropContainer.querySelector(`#${inputId}`);
		if (fileInput) {
			fileInput.removeEventListener("change", handleFileSelectDirect);
			fileInput.addEventListener("change", handleFileSelectDirect);
			console.log(`[injectComponents] attached direct listener to ${inputId}`);
		}
	}
	if (historyContainer) {
		const listId = `history-list-${viewId}`;
		const emptyId = `history-empty-${viewId}`;
		historyContainer.innerHTML = HistoryPanel({ listId, emptyId });
		if (currentSectionTab === "chat") {
			historyContainer.classList.add("hidden");
		} else {
			historyContainer.classList.remove("hidden");
		}
	}
	if (chatContainer) {
		chatContainer.innerHTML = ChatPanel({ viewId });
		attachChatListeners();
		renderChatHistory();
		if (currentSectionTab === "transfers") {
			chatContainer.classList.add("hidden");
		} else {
			chatContainer.classList.remove("hidden");
		}
	}
}

window.switchTab = function (tab, viewId) {
	currentSectionTab = tab;
	const activeView = viewId || getCurrentViewId();
	["pc-host", "pc-client", "mobile-host", "mobile-client"].forEach((vId) => {
		const historyContainer = document.getElementById(`${vId}-history-container`);
		const chatContainer = document.getElementById(`${vId}-chat-container`);
		const transfersBtn = document.getElementById(`tab-btn-transfers-${vId}`);
		const chatBtn = document.getElementById(`tab-btn-chat-${vId}`);
		const badge = document.getElementById(`chat-badge-${vId}`);

		if (tab === "transfers") {
			if (historyContainer) historyContainer.classList.remove("hidden");
			if (chatContainer) chatContainer.classList.add("hidden");
			if (transfersBtn) {
				transfersBtn.className =
					"flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-full text-xs font-semibold uppercase tracking-wider transition-all duration-200 bg-white text-[#1a1a1a] shadow-md";
			}
			if (chatBtn) {
				chatBtn.className =
					"flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-full text-xs font-semibold uppercase tracking-wider transition-all duration-200 relative text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40";
			}
		} else if (tab === "chat") {
			if (historyContainer) historyContainer.classList.add("hidden");
			if (chatContainer) chatContainer.classList.remove("hidden");
			if (badge) badge.classList.add("hidden");
			if (transfersBtn) {
				transfersBtn.className =
					"flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-full text-xs font-semibold uppercase tracking-wider transition-all duration-200 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40";
			}
			if (chatBtn) {
				chatBtn.className =
					"flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-full text-xs font-semibold uppercase tracking-wider transition-all duration-200 relative bg-white text-[#1a1a1a] shadow-md";
			}
			const chatBox = chatContainer?.querySelector('[id*="chat-messages"]');
			if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
		}
	});
};

function updateView() {
	[pcHostView, pcClientView, mobileHostView, mobileClientView].forEach((el) =>
		el?.classList.add("hidden"),
	);

	let connStatusEl, statusTextEl;

	if (!isInitiator) {
		if (isMobileDevice()) {
			mobileHostView.classList.remove("hidden");
			injectComponents("mobile-host");
			const qrEl = document.getElementById("qrcode-mobile");
			if (qrEl) makeQr(currentRoom, qrEl);
			const roomDisplay = document.getElementById("room-code-display-mobile");
			if (roomDisplay) roomDisplay.textContent = currentRoom;
			connStatusEl = document.getElementById("connection-status-mobile");
			statusTextEl = null;
		} else {
			pcHostView.classList.remove("hidden");
			injectComponents("pc-host");
			const qrEl = document.getElementById("qrcode");
			if (qrEl) makeQr(currentRoom, qrEl);
			const roomDisplay = document.getElementById("room-code-display");
			if (roomDisplay) roomDisplay.textContent = currentRoom;
			connStatusEl = document.getElementById("connection-info");
			statusTextEl = null;
		}
	} else {
		if (isMobileDevice()) {
			mobileClientView.classList.remove("hidden");
			injectComponents("mobile-client");
			connStatusEl = document.getElementById("connection-status-mobile-client");
			statusTextEl = null;
		} else {
			pcClientView.classList.remove("hidden");
			injectComponents("pc-client");
			connStatusEl = document.getElementById("connection-info-client");
			statusTextEl = null;
		}
	}

	currentConnStatusEl = connStatusEl;
	currentStatusTextEl = statusTextEl;
	setWebRTCStatusElements(connStatusEl, statusTextEl);
	setFallbackStatusElements(connStatusEl, statusTextEl);

	attachModeListeners();
	attachFilterListeners();
	attachRoomInputListeners();

	const viewPrefix = getCurrentViewId();
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

	refreshStatus();
}

function refreshStatus() {
	if (!currentConnStatusEl) return;
	updateConnectionStatus(currentConnStatusEl, currentStatusTextEl);
}

function updateConnectionStatus(connStatusEl, statusTextEl) {
	const isWebRTCConnected =
		webrtcState.dataChannel && webrtcState.dataChannel.readyState === "open";
	const isRelayConnected = fallbackState.active && hasPeer;

	if (currentMode === "webrtc") {
		if (isWebRTCConnected) {
			setConnectionStatus(connStatusEl, statusTextEl, "Connected Directly via P2P!", "good");
		} else {
			setConnectionStatus(connStatusEl, statusTextEl, "Waiting for peer...", "warn");
		}
	} else if (currentMode === "fallback") {
		if (isRelayConnected) {
			setConnectionStatus(connStatusEl, statusTextEl, "Connected via Relay", "good");
		} else {
			setConnectionStatus(connStatusEl, statusTextEl, "Waiting for peer...", "warn");
		}
	}
}

function handleFileSelectDirect(event) {
	console.log("[handleFileSelectDirect] event triggered on:", event.target.id);
	handleFileSelect(event);
}

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

function attachRoomInputListeners() {
	document.querySelectorAll('input[id^="room-code-input"]').forEach((input) => {
		input.removeEventListener("keypress", handleRoomInputEnter);
		input.addEventListener("keypress", handleRoomInputEnter);
		// Only allow digits
		input.removeEventListener("input", handleRoomInputFilter);
		input.addEventListener("input", handleRoomInputFilter);
	});
}

function handleRoomInputFilter(e) {
	const input = e.target;
	input.value = input.value.replace(/[^0-9]/g, "").slice(0, 4);
}

function handleRoomInputEnter(e) {
	if (e.key === "Enter") {
		e.preventDefault();
		window.joinRoom();
	}
}

let resizeTimeout;
window.addEventListener("resize", () => {
	clearTimeout(resizeTimeout);
	resizeTimeout = setTimeout(updateView, 300);
});

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
	const code = input.value.trim();
	if (!/^[0-9]{4}$/.test(code)) {
		showError("Please enter exactly 4 digits", errorBox);
		return;
	}
	const url = new URL(window.location.href);
	url.search = `?room=${code}`;
	window.location.href = url.toString();
};

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
	hasPeer = true;
	document.querySelectorAll('input[name="mode"]').forEach((radio) => {
		radio.checked = radio.value === mode;
	});
	applyMode();
	updateChatUI();
}

function applyMode() {
	if (modeChangeInProgress) {
		console.log("[applyMode] already in progress, skipping");
		return;
	}
	modeChangeInProgress = true;
	const mode = getSelectedMode();
	console.log("[applyMode] current mode:", mode, "isInitiator:", isInitiator);

	if (mode === currentMode) {
		if (
			mode === "webrtc" &&
			webrtcState.dataChannel &&
			webrtcState.dataChannel.readyState === "open"
		) {
			console.log("[applyMode] already connected via WebRTC");
			modeChangeInProgress = false;
			refreshStatus();
			return;
		}
		if (mode === "fallback" && fallbackState.active && hasPeer) {
			console.log("[applyMode] already connected via Relay");
			modeChangeInProgress = false;
			refreshStatus();
			return;
		}
	}

	const hadDirect = !!(webrtcState.dataChannel && webrtcState.dataChannel.readyState === "open");
	if (mode === "fallback" && hadDirect) {
		setSwitchingToRelay(true);
	}

	resetWebRTC();
	resetFallback();
	initiatorStarted = false;

	if (mode === "fallback") {
		activateFallback(hadDirect);
		if (!isInitiator) {
			socket.emit("signal", {
				room: currentRoom,
				signal: { type: "mode-change", mode: "fallback" },
			});
		} else {
			socket.emit("signal", {
				room: currentRoom,
				signal: { type: "fallback-ready" },
			});
		}
	} else {
		if (isInitiator) {
			console.log("[applyMode] Client starting WebRTC initiator...");
			startInitiator();
		} else {
			console.log("[applyMode] Host sending mode-change signal to client");
			socket.emit("signal", {
				room: currentRoom,
				signal: { type: "mode-change", mode: "webrtc" },
			});
		}
	}

	modeChangeInProgress = false;
	refreshStatus();
}

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
			showError("Failed to start WebRTC offer. Try Relay mode.", errorBox);
			initiatorStarted = false;
		});
}

initWebRTC(socket, currentRoom, isInitiator, errorBox, null, null);
initFallback(socket, currentRoom, errorBox, null, null, processSendQueue);

async function processSendQueue() {
	if (webrtcState.isSending || webrtcState.sendQueue.length === 0) {
		return;
	}

	if (!fallbackState.active) {
		if (!webrtcState.dataChannel || webrtcState.dataChannel.readyState !== "open") {
			console.log(
				"[processSendQueue] waiting for open data channel, readyState:",
				webrtcState.dataChannel?.readyState || "null",
			);
			if (!retryStartedAt) retryStartedAt = Date.now();
			if (Date.now() - retryStartedAt > MAX_RETRY_MS) {
				const item = webrtcState.sendQueue.shift();
				const histItem = transferHistory.find((h) => h.id === item.id);
				if (histItem) {
					histItem.status = "error";
					renderHistory();
				}
				showError("Connection timeout. Please try again or switch to Relay mode.", errorBox);
				retryStartedAt = null;
				processSendQueue();
				return;
			}
			if (retryTimeout) clearTimeout(retryTimeout);
			retryTimeout = setTimeout(() => {
				retryTimeout = null;
				processSendQueue();
			}, 1500);
			return;
		}
	}

	retryStartedAt = null;
	webrtcState.isSending = true;
	const item = webrtcState.sendQueue.shift();
	const file = item.file;
	const transferId = item.id;
	console.log("[processSendQueue] sending file:", file.name, "id:", transferId);

	try {
		if (
			webrtcState.dataChannel &&
			webrtcState.dataChannel.readyState === "open" &&
			!fallbackState.active
		) {
			console.log("[processSendQueue] using WebRTC to send");
			await sendFileWebRTC(file, transferId);
		} else if (fallbackState.active) {
			console.log("[processSendQueue] using Fallback Relay to send");
			await sendFileFallback(file, transferId);
		} else {
			console.error("[processSendQueue] no active connection!");
			showError("No active connection. Switch to Relay mode.", errorBox);
			const histItem = transferHistory.find((h) => h.id === transferId);
			if (histItem) {
				histItem.status = "error";
				renderHistory();
			}
		}
	} catch (err) {
		console.error("[processSendQueue] send error:", err);
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

async function handleSignal(signal) {
	if (!signal || typeof signal !== "object") return;
	hasPeer = true;

	if (signal.type === "request-mode") {
		if (!isInitiator) {
			const mode = getSelectedMode();
			socket.emit("signal", {
				room: currentRoom,
				signal: { type: "mode-change", mode },
			});
		}
		return;
	}

	if (signal.type === "mode-change" && typeof signal.mode === "string") {
		setModeFromSignal(signal.mode);
		return;
	}

	if (signal.type === "fallback-ready") {
		console.log("[Signal] client fallback is ready");
		hasPeer = true;
		if (!isInitiator) {
			refreshStatus();
		}
		return;
	}

	if (signal.type && signal.type.startsWith("file-")) {
		handleFallbackSignal(signal);
		return;
	}

	if (signal.type === "chat-message" && signal.message) {
		console.log("[handleSignal] received chat message:", signal.message);
		handleChatMessage(signal.message, signal.timestamp);
		return;
	}

	if (getSelectedMode() === "fallback") {
		return;
	}

	if (signal.sdp) {
		if (!webrtcState.peerConnection) {
			if (isInitiator) {
				console.warn("[handleSignal] no peer connection on client, but should exist");
				return;
			} else {
				console.log("[handleSignal] host creating peer connection for incoming offer");
				webrtcState.peerConnection = createPeerConnection(currentRoom, null, processSendQueue);
			}
		}
		const pc = webrtcState.peerConnection;

		if (signal.sdp.type === "offer") {
			if (pc.signalingState !== "stable") {
				console.warn("[handleSignal] offer ignored, signaling state:", pc.signalingState);
				return;
			}
			console.log("[handleSignal] setting remote description (offer)");
			await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
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
				console.warn("[handleSignal] answer ignored, signaling state:", pc.signalingState);
				return;
			}
			console.log("[handleSignal] setting remote description (answer)");
			await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
			await flushPendingCandidates();
		}
	} else if (signal.candidate) {
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

function makeQr(roomId, qrEl) {
	if (!qrEl) {
		console.warn("QR element not found – skipping QR generation");
		return;
	}
	qrEl.innerHTML = "";
	const u = new URL(window.location.href);
	if (u.pathname && !u.pathname.includes(".") && !u.pathname.endsWith("/")) u.pathname += "/";
	u.search = `?room=${roomId}`;
	u.hash = "";

	if (roomUrlText) roomUrlText.textContent = u.toString();

	const isMobile = qrEl.id === "qrcode-mobile";
	const size = isMobile ? 120 : 140;

	if (typeof QRCode !== "undefined") {
		new QRCode(qrEl, {
			text: u.toString(),
			width: size,
			height: size,
			colorDark: "#09090b",
			colorLight: "#ffffff",
			correctLevel: QRCode.CorrectLevel.H,
		});
	} else {
		qrEl.textContent = u.toString();
	}

	const badge = document.createElement("div");
	badge.className = "absolute inset-0 flex items-center justify-center pointer-events-none";
	badge.innerHTML = `
		<span class="bg-[#09090b] text-white font-mono font-bold text-xs px-2 py-0.5 rounded shadow-lg border border-zinc-600 tracking-widest">
			${roomId}
		</span>
	`;
	qrEl.appendChild(badge);
}

function joinAndMaybeStart() {
	connectErrorCount = 0;
	socket.emit("join-room", currentRoom);
	if (isInitiator) {
		socket.emit("signal", {
			room: currentRoom,
			signal: { type: "request-mode" },
		});
	} else {
		setTimeout(() => {
			applyMode();
		}, 100);
	}
}

socket.on("signal", (signal) => {
	handleSignal(signal).catch((err) => showError("Signaling error: " + err.message, errorBox));
});

socket.on("connect", joinAndMaybeStart);
socket.on("connect_error", (err) => {
	connectErrorCount += 1;
	if (connectErrorCount >= 3) showError(`Signaling connection failed: ${err.message}`, errorBox);
});

if (!window.RTCPeerConnection) showError("WebRTC not supported. Use Relay mode.", errorBox);

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", updateView);
} else {
	updateView();
}

function enqueueFiles(files) {
	const MAX_FILE_SIZE = 1024 * 1024 * 1024;
	for (const file of files) {
		if (file.size > MAX_FILE_SIZE) {
			showError(`File "${file.name}" exceeds the 1GB limit.`, errorBox);
			return false;
		}
	}

	const hasWebRTC = webrtcState.dataChannel && webrtcState.dataChannel.readyState === "open";
	const hasFallback = fallbackState.active;

	if (!hasWebRTC && !hasFallback) {
		showError(
			"No active connection. Please wait for peer to connect or switch to Relay mode.",
			errorBox,
		);
		return false;
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
	return true;
}

async function handleFileSelect(event) {
	const input = event.target;
	const files = input.files;
	if (!files || files.length === 0) return;
	console.log("[handleFileSelect] files selected:", files.length);
	enqueueFiles(files);
	input.value = "";
}

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
			console.log("[drop] files dropped:", files.length);
			enqueueFiles(files);
		}
	}
});

function updateChatUI() {
	const currentView = getCurrentViewId();
	const chatContainer = document.getElementById(`${currentView}-chat-container`);
	if (chatContainer) {
		chatContainer.innerHTML = ChatPanel({ viewId: currentView });
		attachChatListeners();
		renderChatHistory();
	}
}

function renderChatHistory() {
	document.querySelectorAll('[id*="chat-messages"]').forEach((chatMessages) => {
		if (chatHistory.length === 0) {
			chatMessages.innerHTML = `
				<div class="h-full flex flex-col items-center justify-center text-zinc-600 chat-empty-placeholder">
					<svg class="w-8 h-8 mb-1 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
					</svg>
					<p class="text-xs font-medium">No messages yet</p>
					<p class="text-[10px] mt-0.5">Send a message to start chatting</p>
				</div>
			`;
			return;
		}
		chatMessages.innerHTML = "";
		chatHistory.forEach((item) => {
			const messageDiv = document.createElement("div");
			messageDiv.className = `chat-message ${item.sender} mb-3`;

			const header = document.createElement("div");
			header.className = "mb-1 text-xs text-zinc-500 font-medium";
			header.textContent = item.sender === "sent" ? "You" : "Peer";

			const text = document.createElement("p");
			text.className = "text-sm text-zinc-200 break-words leading-relaxed";
			text.textContent = item.text;

			const time = document.createElement("div");
			time.className = "chat-message-time text-[10px] text-zinc-500 mt-1";
			time.textContent = new Date(item.timestamp).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			});

			messageDiv.appendChild(header);
			messageDiv.appendChild(text);
			messageDiv.appendChild(time);
			chatMessages.appendChild(messageDiv);
		});
		chatMessages.scrollTop = chatMessages.scrollHeight;
	});
}

function attachChatListeners() {
	document.querySelectorAll('[id*="chat-send"]').forEach((sendBtn) => {
		sendBtn.removeEventListener("click", handleChatSendClick);
		sendBtn.addEventListener("click", handleChatSendClick);
	});
	document.querySelectorAll('[id*="chat-input"]').forEach((input) => {
		input.removeEventListener("keypress", handleChatInputKeypress);
		input.addEventListener("keypress", handleChatInputKeypress);
	});
}

function handleChatSendClick(e) {
	const chatContainer = e.currentTarget.closest('[id*="chat-container"]');
	const chatInput = chatContainer?.querySelector('[id*="chat-input"]');
	if (!chatInput) return;
	const message = chatInput.value.trim();
	if (message) {
		sendChatMessage(message);
		chatInput.value = "";
	}
}

function handleChatInputKeypress(e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		const sendBtn = e.currentTarget
			.closest('[id*="chat-container"]')
			?.querySelector('[id*="chat-send"]');
		if (sendBtn) {
			sendBtn.click();
		}
	}
}

function sendChatMessage(message) {
	if (!message || !message.trim()) return;
	const item = {
		sender: "sent",
		text: message,
		timestamp: new Date().toISOString(),
	};
	chatHistory.push(item);
	renderChatHistory();
	socket.emit("signal", {
		room: currentRoom,
		signal: { type: "chat-message", message, timestamp: item.timestamp },
	});
}

function handleChatMessage(message, timestamp) {
	const item = {
		sender: "received",
		text: message,
		timestamp: timestamp || new Date().toISOString(),
	};
	chatHistory.push(item);
	renderChatHistory();
	if (currentSectionTab !== "chat") {
		document.querySelectorAll('[id^="chat-badge-"]').forEach((badge) => {
			badge.classList.remove("hidden");
		});
	}
}

window.clearHistory = clearHistory;

window.addEventListener("load", () => {
	attachModeListeners();
	attachFilterListeners();
	attachRoomInputListeners();
	attachChatListeners();
});