import { transferHistory, renderHistory } from "./history.js";
import { setConnectionStatus, showError } from "./utils.js";

export const fallbackState = {
	active: false,
	receiveBuffer: [],
	meta: null,
	receivedSize: 0,
	complete: false,
	objectUrl: null,
	peerConnected: false,
};

let socketRef = null;
let currentRoomRef = null;
let errorBoxRef = null;
let connectionStatusRef = null;
let statusTextRef = null;
let processSendQueueCallback = null;

export function initFallback(
	socket,
	room,
	errorBox,
	connectionStatus,
	statusText,
	processSendQueue,
) {
	socketRef = socket;
	currentRoomRef = room;
	errorBoxRef = errorBox;
	connectionStatusRef = connectionStatus;
	statusTextRef = statusText;
	processSendQueueCallback = processSendQueue;
}

export function activateFallback(hasPeer = false) {
	if (fallbackState.active) return;
	fallbackState.active = true;
	fallbackState.peerConnected = hasPeer;
	console.log("Fallback activated, hasPeer:", hasPeer);
	if (hasPeer) {
		setConnectionStatus(
			connectionStatusRef,
			statusTextRef,
			"Connected via Relay",
			"good",
		);
	}
	if (processSendQueueCallback) processSendQueueCallback();
}

export function resetFallback() {
	fallbackState.active = false;
	fallbackState.receiveBuffer = [];
	fallbackState.meta = null;
	fallbackState.receivedSize = 0;
	fallbackState.complete = false;
	fallbackState.peerConnected = false;
	if (fallbackState.objectUrl) {
		URL.revokeObjectURL(fallbackState.objectUrl);
		fallbackState.objectUrl = null;
	}
	console.log("Fallback reset");
}

function throttleRender(histItem, progress) {
	const newPct = Math.min(Math.round(progress), 99);
	if (newPct !== histItem.progress) {
		histItem.progress = newPct;
		renderHistory();
	}
}

export async function sendFileFallback(file, transferId) {
	// Find the queued entry created in main.js
	let histItem = transferHistory.find((h) => h.id === transferId);
	if (!histItem) {
		// fallback: create one (shouldn't happen)
		histItem = {
			id: transferId,
			name: file.name,
			size: file.size,
			type: file.type || "application/octet-stream",
			direction: "sent",
			status: "transferring",
			progress: 0,
			timestamp: new Date(),
			objectUrl: null,
		};
		transferHistory.push(histItem);
	} else {
		histItem.status = "transferring";
	}
	renderHistory();

	if (fallbackState.active && !fallbackState.peerConnected) {
		fallbackState.peerConnected = true;
		setConnectionStatus(
			connectionStatusRef,
			statusTextRef,
			"Connected via Relay",
			"good",
		);
	}

	try {
		socketRef.emit("signal", {
			room: currentRoomRef,
			signal: {
				type: "file-meta",
				id: transferId,
				name: file.name,
				size: file.size,
				fileType: file.type || "application/octet-stream",
			},
		});

		const chunkSize = 16384;
		let offset = 0;
		const sendChunk = (chunkData, off) => {
			return new Promise((resolve, reject) => {
				const base64 = btoa(
					String.fromCharCode(...new Uint8Array(chunkData)),
				);
				socketRef.emit(
					"signal",
					{
						room: currentRoomRef,
						signal: {
							type: "file-chunk",
							id: transferId,
							data: base64,
							offset: off,
						},
					},
					(ack) => {
						if (ack && ack.error) reject(new Error(ack.error));
						else resolve();
					},
				);
			});
		};

		while (offset < file.size) {
			const chunk = file.slice(offset, offset + chunkSize);
			const data = await new Promise((resolve) => {
				const reader = new FileReader();
				reader.onload = (e) => resolve(e.target.result);
				reader.readAsArrayBuffer(chunk);
			});
			await sendChunk(data, offset);
			offset += chunk.size || data.byteLength || 0;
			const histItem2 = transferHistory.find((h) => h.id === transferId);
			if (histItem2)
				throttleRender(histItem2, (offset / file.size) * 100);
		}

		await new Promise((resolve, reject) => {
			socketRef.emit(
				"signal",
				{
					room: currentRoomRef,
					signal: { type: "file-end", id: transferId },
				},
				(ack) => {
					if (ack && ack.error) reject(new Error(ack.error));
					else resolve();
				},
			);
		});

		const histItem2 = transferHistory.find((h) => h.id === transferId);
		if (histItem2) {
			histItem2.status = "completed";
			histItem2.progress = 100;
			renderHistory();
		}
	} catch (err) {
		console.error("Fallback send error:", err);
		const histItem2 = transferHistory.find((h) => h.id === transferId);
		if (histItem2) {
			histItem2.status = "error";
			renderHistory();
		}
		showError(`Fallback send failed: ${err.message}`, errorBoxRef);
	}
}

export function handleFallbackSignal(signal) {
	if (!signal || typeof signal !== "object") return;
	if (fallbackState.active && !fallbackState.peerConnected) {
		fallbackState.peerConnected = true;
		setConnectionStatus(
			connectionStatusRef,
			statusTextRef,
			"Connected via Relay",
			"good",
		);
	}
	if (signal.type === "file-meta") {
		fallbackState.meta = signal;
		fallbackState.receiveBuffer = [];
		fallbackState.receivedSize = 0;
		fallbackState.complete = false;
		fallbackState.objectUrl = null;
		transferHistory.push({
			id: signal.id,
			name: signal.name,
			size: signal.size,
			type: signal.fileType || "application/octet-stream",
			direction: "received",
			status: "transferring",
			progress: 0,
			timestamp: new Date(),
			objectUrl: null,
		});
		renderHistory();
		if (signal.size === 0) completeFallbackReceive(signal.id);
	} else if (signal.type === "file-chunk") {
		if (!fallbackState.meta || fallbackState.meta.id !== signal.id) return;
		try {
			const binary = atob(signal.data);
			const len = binary.length;
			const bytes = new Uint8Array(len);
			for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
			fallbackState.receiveBuffer.push(bytes.buffer);
			fallbackState.receivedSize += bytes.byteLength;
			const histItem = transferHistory.find((h) => h.id === signal.id);
			if (histItem && fallbackState.meta.size > 0) {
				throttleRender(
					histItem,
					(fallbackState.receivedSize / fallbackState.meta.size) *
						100,
				);
			}
			if (fallbackState.receivedSize >= fallbackState.meta.size) {
				completeFallbackReceive(signal.id);
			}
		} catch (e) {
			console.error("Fallback chunk decode error:", e);
		}
	} else if (signal.type === "file-end") {
		completeFallbackReceive(signal.id);
	}
}

function completeFallbackReceive(id) {
	if (
		fallbackState.complete ||
		!fallbackState.meta ||
		fallbackState.meta.id !== id
	)
		return;
	fallbackState.complete = true;
	const histItem = transferHistory.find((h) => h.id === id);
	if (histItem) {
		try {
			const blob = new Blob(fallbackState.receiveBuffer, {
				type: histItem.type || "application/octet-stream",
			});
			fallbackState.objectUrl = URL.createObjectURL(blob);
			histItem.objectUrl = fallbackState.objectUrl;
			histItem.status = "completed";
			histItem.progress = 100;
		} catch (e) {
			histItem.status = "error";
			console.error("Fallback blob creation failed:", e);
		}
		renderHistory();
	}
	fallbackState.receiveBuffer = [];
	fallbackState.meta = null;
}
