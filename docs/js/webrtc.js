import { RTC_CONFIG } from "./config.js";
import { setConnectionStatus, showError } from "./utils.js";
import { transferHistory, renderHistory } from "./history.js";
import { fallbackState } from "./fallback.js";

export const webrtcState = {
	peerConnection: null,
	dataChannel: null,
	pendingCandidates: [],
	activeReceives: new Map(),
	sendQueue: [],
	isSending: false,
};

let socketRef = null;
let currentRoomRef = null;
let isInitiatorRef = false;
let errorBoxRef = null;
let connectionStatusRef = null;
let statusTextRef = null;

let isSwitchingToRelay = false;
export function setSwitchingToRelay(value) {
	isSwitchingToRelay = value;
}

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

function readFileChunk(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(reader.error);
		reader.readAsArrayBuffer(blob);
	});
}

async function waitUntilBufferLow(channel, limit) {
	while (channel.bufferedAmount > limit) {
		if (channel.readyState !== "open")
			throw new Error("Data channel closed");
		await new Promise((r) => setTimeout(r, 30));
	}
}

function throttleRender(histItem, progress) {
	const newPct = Math.min(Math.round(progress), 99);
	if (newPct !== histItem.progress) {
		histItem.progress = newPct;
		renderHistory();
	}
}

export async function sendFileWebRTC(file) {
	const transferId = crypto.randomUUID();
	// Create history item with "queued" status
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

	try {
		webrtcState.dataChannel.send(
			JSON.stringify({
				type: "meta",
				id: transferId,
				name: file.name,
				size: file.size,
				fileType: file.type || "application/octet-stream",
			}),
		);
		if (file.size > 0) {
			const chunkSize = 16384;
			let offset = 0;
			while (offset < file.size) {
				await waitUntilBufferLow(
					webrtcState.dataChannel,
					2 * 1024 * 1024,
				);
				const chunk = await readFileChunk(
					file.slice(offset, offset + chunkSize),
				);
				webrtcState.dataChannel.send(chunk);
				offset += chunk.byteLength || chunk.size || 0;
				const histItem = transferHistory.find(
					(h) => h.id === transferId,
				);
				if (histItem) {
					throttleRender(histItem, (offset / file.size) * 100);
				}
			}
		}
		webrtcState.dataChannel.send(
			JSON.stringify({ type: "end", id: transferId }),
		);
		const histItem = transferHistory.find((h) => h.id === transferId);
		if (histItem) {
			histItem.status = "completed";
			histItem.progress = 100;
			renderHistory();
		}
	} catch (err) {
		console.error("WebRTC send error:", err);
		const histItem = transferHistory.find((h) => h.id === transferId);
		if (histItem) {
			histItem.status = "error";
			renderHistory();
		}
		throw err;
	}
}

function completeReceiveWebRTC(id) {
	const receiveData = webrtcState.activeReceives.get(id);
	if (!receiveData) return;
	const histItem = transferHistory.find((h) => h.id === id);
	if (histItem) {
		try {
			const blob = new Blob(receiveData.buffer, {
				type: histItem.type || "application/octet-stream",
			});
			histItem.objectUrl = URL.createObjectURL(blob);
			histItem.status = "completed";
			histItem.progress = 100;
		} catch (e) {
			histItem.status = "error";
			console.error("Blob creation failed:", e);
		}
		renderHistory();
	}
	webrtcState.activeReceives.delete(id);
}

async function handleDataMessage(event) {
	if (typeof event.data === "string") {
		let msg;
		try {
			msg = JSON.parse(event.data);
		} catch (_) {
			return;
		}
		if (msg.type === "meta") {
			webrtcState.activeReceives.set(msg.id, {
				buffer: [],
				receivedSize: 0,
				meta: msg,
			});
			transferHistory.push({
				id: msg.id,
				name: msg.name,
				size: msg.size,
				type: msg.fileType || "application/octet-stream",
				direction: "received",
				status: "transferring",
				progress: 0,
				timestamp: new Date(),
				objectUrl: null,
			});
			renderHistory();
			if (msg.size === 0) completeReceiveWebRTC(msg.id);
		} else if (msg.type === "end") {
			completeReceiveWebRTC(msg.id);
		}
		return;
	}
	// Binary chunk – it must be matched to a specific transfer ID.
	// We embed the ID in a small binary header: first 4 bytes = ID length, then ID, then chunk.
	let arrayBuffer = null;
	let byteLength = 0;
	if (event.data instanceof ArrayBuffer) {
		arrayBuffer = event.data;
		byteLength = arrayBuffer.byteLength;
	} else if (event.data instanceof Blob) {
		try {
			arrayBuffer = await event.data.arrayBuffer();
			byteLength = arrayBuffer.byteLength;
		} catch (_) {
			return;
		}
	} else {
		return;
	}
	if (byteLength < 4) return;
	// Read the ID length from first 4 bytes (uint32)
	const idLen = new Uint32Array(arrayBuffer.slice(0, 4))[0];
	if (byteLength < 4 + idLen) return;
	const id = new TextDecoder().decode(arrayBuffer.slice(4, 4 + idLen));
	const chunkData = arrayBuffer.slice(4 + idLen);
	if (chunkData.byteLength === 0) return;
	const receiveData = webrtcState.activeReceives.get(id);
	if (!receiveData) return;
	receiveData.buffer.push(chunkData);
	receiveData.receivedSize += chunkData.byteLength;
	const histItem = transferHistory.find((h) => h.id === id);
	if (histItem && receiveData.meta.size > 0) {
		throttleRender(
			histItem,
			(receiveData.receivedSize / receiveData.meta.size) * 100,
		);
	}
	if (receiveData.receivedSize >= receiveData.meta.size) {
		completeReceiveWebRTC(id);
	}
}

export function setupDataChannel(channel, processSendQueueCallback) {
	channel.binaryType = "arraybuffer";
	channel.bufferedAmountLowThreshold = 256 * 1024;
	channel.onopen = () => {
		setConnectionStatus(
			connectionStatusRef,
			statusTextRef,
			"Connected Directly via P2P!",
			"good",
		);
		processSendQueueCallback();
	};
	channel.onclose = () => {
		if (!fallbackState.active && !isSwitchingToRelay) {
			setConnectionStatus(
				connectionStatusRef,
				statusTextRef,
				"Data channel closed.",
				"bad",
			);
		}
		isSwitchingToRelay = false;
	};
	channel.onerror = (err) => {
		console.error("Data channel error:", err);
		showError("Data channel error. Reload and reconnect.", errorBoxRef);
	};
	channel.onmessage = handleDataMessage;
}

export async function flushPendingCandidates() {
	if (
		!webrtcState.peerConnection ||
		!webrtcState.peerConnection.remoteDescription ||
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

export function createPeerConnection(
	roomId,
	onDataChannel,
	processSendQueueCallback,
) {
	const pc = new RTCPeerConnection(RTC_CONFIG);
	pc.onicecandidate = (event) => {
		if (event.candidate) {
			socketRef.emit("signal", {
				room: roomId,
				signal: { candidate: event.candidate.toJSON() },
			});
		}
	};
	pc.ondatachannel = (event) => {
		webrtcState.dataChannel = event.channel;
		setupDataChannel(webrtcState.dataChannel, processSendQueueCallback);
		if (onDataChannel) onDataChannel(webrtcState.dataChannel);
	};
	pc.onconnectionstatechange = () => {
		if (pc.connectionState === "connected") {
			setConnectionStatus(
				connectionStatusRef,
				statusTextRef,
				"Connected Directly via P2P!",
				"good",
			);
		} else if (pc.connectionState === "failed") {
			setConnectionStatus(
				connectionStatusRef,
				statusTextRef,
				"Peer connection failed.",
				"bad",
			);
		}
	};
	// Fix ICE restart: actually renegotiate
	pc.onnegotiationneeded = async () => {
		try {
			// Only initiator should send new offer
			if (!isInitiatorRef) return;
			const offer = await pc.createOffer({ iceRestart: true });
			await pc.setLocalDescription(offer);
			socketRef.emit("signal", {
				room: roomId,
				signal: {
					sdp: {
						type: pc.localDescription.type,
						sdp: pc.localDescription.sdp,
					},
				},
			});
		} catch (e) {
			console.error("Renegotiation failed:", e);
		}
	};
	pc.oniceconnectionstatechange = () => {
		if (pc.iceConnectionState === "failed" && pc.restartIce)
			pc.restartIce();
	};
	pc.onicecandidateerror = (err) => console.warn("ICE candidate error:", err);
	return pc;
}

export function resetWebRTC() {
	if (webrtcState.peerConnection) webrtcState.peerConnection.close();
	webrtcState.peerConnection = null;
	webrtcState.dataChannel = null;
	webrtcState.pendingCandidates = [];
	webrtcState.activeReceives.clear();
	webrtcState.sendQueue = [];
	webrtcState.isSending = false;
}
