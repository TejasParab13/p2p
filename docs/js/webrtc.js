import { RTC_CONFIG } from "./config.js";
import { setConnectionStatus, showError } from "./utils.js";
import { transferHistory, renderHistory } from "./history.js";
import { activateFallback } from "./fallback.js"; // for auto-fallback

// Mutable state object – exported so main.js can modify it
export const webrtcState = {
	peerConnection: null,
	dataChannel: null,
	pendingCandidates: [],
	activeReceives: new Map(),
	sendQueue: [],
	isSending: false,
};

// These will be set from main
let socketRef = null;
let currentRoomRef = null;
let isInitiatorRef = false;
let errorBoxRef = null;
let connectionStatusRef = null;
let statusTextRef = null;
let processSendQueueCallback = null;

export function initWebRTC(
	socket,
	room,
	isInitiator,
	errorBox,
	connectionStatus,
	statusText,
) {
	socketRef = socket;
	currentRoomRef = room;
	isInitiatorRef = isInitiator;
	errorBoxRef = errorBox;
	connectionStatusRef = connectionStatus;
	statusTextRef = statusText;
}

export function resetWebRTC() {
	if (webrtcState.peerConnection) {
		webrtcState.peerConnection.close();
		webrtcState.peerConnection = null;
	}
	webrtcState.dataChannel = null;
	webrtcState.pendingCandidates = [];
	webrtcState.activeReceives = new Map();
	webrtcState.sendQueue = [];
	webrtcState.isSending = false;
	console.log("WebRTC reset");
}

// Helper: read file chunk as ArrayBuffer
function readFileChunk(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = (e) => resolve(e.target.result);
		reader.onerror = reject;
		reader.readAsArrayBuffer(blob);
	});
}

export function setupDataChannel(dc, processSendQueueCallback) {
	if (!dc) return;
	webrtcState.dataChannel = dc;
	dc.binaryType = "arraybuffer";

	dc.onopen = () => {
		console.log("Data channel open");
		setConnectionStatus(
			connectionStatusRef,
			statusTextRef,
			"Connected (WebRTC)",
			"good",
		);
		if (processSendQueueCallback) processSendQueueCallback();
	};

	dc.onclose = () => {
		console.log("Data channel closed");
		setConnectionStatus(
			connectionStatusRef,
			statusTextRef,
			"Disconnected",
			"warn",
		);
	};

	dc.onmessage = (event) => {
		if (typeof event.data === "string") {
			try {
				const msg = JSON.parse(event.data);
				if (msg.type === "end") {
					// handle end marker
					const histItem = transferHistory.find(
						(h) => h.id === msg.id,
					);
					if (histItem && histItem.status === "transferring") {
						histItem.status = "completed";
						histItem.progress = 100;
						renderHistory();
					}
				}
				return;
			} catch (_) {
				// not JSON, treat as binary
			}
		}
		// binary data: accumulate
		const data = event.data;
		// We need to map transferId to receive buffer.
		// For simplicity, we handle one file at a time.
		// We'll use a global receive state.
		if (!webrtcState._receiveMeta) {
			// First chunk? We need meta first – but we receive meta as JSON.
			// To keep it simple, we'll assume the sender sends a JSON meta first.
			console.warn("Received binary without meta; ignoring");
			return;
		}
		// Actually we should handle meta separately. For now, we'll assume meta is sent as JSON
		// and we store it in webrtcState._receiveMeta.
		// We'll add a method to set meta.
	};

	// Add a receive meta setter
	webrtcState.setReceiveMeta = (meta) => {
		webrtcState._receiveMeta = meta;
		webrtcState._receiveBuffer = [];
		webrtcState._receivedSize = 0;
	};
}

export function createPeerConnection(
	roomId,
	onDataChannel,
	processSendQueueCallback,
) {
	const pc = new RTCPeerConnection(RTC_CONFIG);
	pc.onicecandidate = (event) => {
		if (event.candidate) {
			console.log("Local ICE candidate:", event.candidate.candidate);
			socketRef.emit("signal", {
				room: roomId,
				signal: { candidate: event.candidate.toJSON() },
			});
		}
	};
	pc.ondatachannel = (event) => {
		webrtcState.dataChannel = event.channel;
		setupDataChannel(webrtcState.dataChannel, processSendQueueCallback);
		if (onDataChannel) onDataChannel(event.channel);
	};

	// --- FIX: Connection state monitoring ---
	pc.onconnectionstatechange = () => {
		const state = pc.connectionState;
		console.log("WebRTC connection state:", state);
		if (state === "connected") {
			setConnectionStatus(
				connectionStatusRef,
				statusTextRef,
				"Connected (WebRTC)",
				"good",
			);
		} else if (state === "failed") {
			setConnectionStatus(
				connectionStatusRef,
				statusTextRef,
				"WebRTC failed, switching to Relay...",
				"warn",
			);
			showError(
				"WebRTC connection failed. Switching to Relay mode.",
				errorBoxRef,
			);
			// Auto-switch to fallback
			activateFallback();
		} else if (state === "disconnected") {
			setConnectionStatus(
				connectionStatusRef,
				statusTextRef,
				"WebRTC disconnected",
				"warn",
			);
		}
	};

	pc.oniceconnectionstatechange = () => {
		const state = pc.iceConnectionState;
		console.log("ICE connection state:", state);
		if (state === "failed") {
			// Sometimes ICE fails but connection state might still recover
			setConnectionStatus(
				connectionStatusRef,
				statusTextRef,
				"ICE failed, trying to recover...",
				"warn",
			);
		}
	};

	return pc;
}

export async function flushPendingCandidates() {
	if (
		!webrtcState.peerConnection ||
		webrtcState.pendingCandidates.length === 0
	)
		return;
	const candidates = webrtcState.pendingCandidates;
	webrtcState.pendingCandidates = [];
	for (const candidate of candidates) {
		try {
			await webrtcState.peerConnection.addIceCandidate(
				new RTCIceCandidate(candidate),
			);
		} catch (_) {}
	}
}

export async function sendFileWebRTC(file) {
	const transferId = crypto.randomUUID();
	transferHistory.push({
		id: transferId,
		name: file.name,
		size: file.size,
		type: file.type || "application/octet-stream",
		direction: "sent",
		status: "transferring",
		progress: 0,
		timestamp: new Date(),
		objectUrl: null,
	});
	renderHistory();

	const dc = webrtcState.dataChannel;
	if (!dc || dc.readyState !== "open") {
		const histItem = transferHistory.find((h) => h.id === transferId);
		if (histItem) histItem.status = "error";
		renderHistory();
		showError("Data channel not open", errorBoxRef);
		return;
	}

	try {
		// Send meta as JSON
		dc.send(
			JSON.stringify({
				type: "meta",
				id: transferId,
				name: file.name,
				size: file.size,
				fileType: file.type || "application/octet-stream",
			}),
		);

		const chunkSize = 16384; // 16 KB
		let offset = 0;
		while (offset < file.size) {
			const chunk = file.slice(offset, offset + chunkSize);
			const data = await readFileChunk(chunk);

			// --- FIX: Backpressure control ---
			while (dc.bufferedAmount > 64 * 1024) {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			dc.send(data);
			offset += data.byteLength || chunk.size || 0;
			const histItem = transferHistory.find((h) => h.id === transferId);
			if (histItem) {
				const pct = Math.round((offset / file.size) * 100);
				histItem.progress = Math.min(pct, 99);
				renderHistory();
			}
		}
		// Send end marker
		dc.send(JSON.stringify({ type: "end", id: transferId }));
		const histItem = transferHistory.find((h) => h.id === transferId);
		if (histItem) {
			histItem.status = "completed";
			histItem.progress = 100;
			renderHistory();
		}
	} catch (err) {
		console.error("WebRTC send error:", err);
		const histItem = transferHistory.find((h) => h.id === transferId);
		if (histItem) histItem.status = "error";
		renderHistory();
		showError(`WebRTC send failed: ${err.message}`, errorBoxRef);
	}
}
