import { RTC_CONFIG } from "./config.js";
import { setConnectionStatus, showError } from "./utils.js";
import { transferHistory, renderHistory } from "./history.js";

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

// Helper to read chunk
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
		await new Promise((resolve) => setTimeout(resolve, 30));
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
					const pct = Math.round((offset / file.size) * 100);
					histItem.progress = Math.min(pct, 99);
					renderHistory();
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
	if (byteLength === 0) return;
	const activeId = Array.from(webrtcState.activeReceives.keys())[0];
	if (!activeId) return;
	const receiveData = webrtcState.activeReceives.get(activeId);
	if (!receiveData) return;
	receiveData.buffer.push(arrayBuffer);
	receiveData.receivedSize += byteLength;
	const histItem = transferHistory.find((h) => h.id === activeId);
	if (histItem && receiveData.meta.size > 0) {
		const pct = Math.round(
			(receiveData.receivedSize / receiveData.meta.size) * 100,
		);
		histItem.progress = Math.min(pct, 99);
		renderHistory();
	}
	if (receiveData.receivedSize >= receiveData.meta.size) {
		completeReceiveWebRTC(activeId);
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
	channel.onclose = () =>
		setConnectionStatus(
			connectionStatusRef,
			statusTextRef,
			"Data channel closed.",
			"bad",
		);
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
		if (onDataChannel) onDataChannel(webrtcState.dataChannel);
	};
	pc.onconnectionstatechange = () => {
		console.log("Connection state:", pc.connectionState);
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
	pc.oniceconnectionstatechange = () => {
		console.log("ICE state:", pc.iceConnectionState);
		if (pc.iceConnectionState === "failed" && pc.restartIce)
			pc.restartIce();
	};
	pc.onicecandidateerror = (err) => {
		console.warn("ICE candidate error:", err);
	};
	return pc;
}

export function resetWebRTC() {
	if (webrtcState.peerConnection) {
		webrtcState.peerConnection.close();
	}
	webrtcState.peerConnection = null;
	webrtcState.dataChannel = null;
	webrtcState.pendingCandidates = [];
	webrtcState.activeReceives.clear();
	webrtcState.sendQueue = [];
	webrtcState.isSending = false;
}
