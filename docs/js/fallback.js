import { transferHistory, renderHistory } from "./history.js";
import { setConnectionStatus, showError } from "./utils.js";

export let fallbackActive = false;
export let fallbackReceiveBuffer = [];
export let fallbackMeta = null;
export let fallbackReceivedSize = 0;
export let fallbackComplete = false;
export let fallbackObjectUrl = null;

// These will be set from main
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

export function activateFallback() {
	if (fallbackActive) return;
	fallbackActive = true;
	setConnectionStatus(
		connectionStatusRef,
		statusTextRef,
		"Using WebSocket fallback (reliable)",
		"good",
	);
	showError(
		"Using Relay mode – all data goes through signaling server.",
		errorBoxRef,
	);
	if (processSendQueueCallback) processSendQueueCallback();
}

export async function sendFileFallback(file) {
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
		while (offset < file.size) {
			const chunk = file.slice(offset, offset + chunkSize);
			const data = await new Promise((resolve) => {
				const reader = new FileReader();
				reader.onload = (e) => resolve(e.target.result);
				reader.readAsArrayBuffer(chunk);
			});
			const base64 = btoa(String.fromCharCode(...new Uint8Array(data)));
			socketRef.emit("signal", {
				room: currentRoomRef,
				signal: {
					type: "file-chunk",
					id: transferId,
					data: base64,
					offset: offset,
				},
			});
			offset += chunk.size || data.byteLength || 0;
			const histItem = transferHistory.find((h) => h.id === transferId);
			if (histItem) {
				const pct = Math.round((offset / file.size) * 100);
				histItem.progress = Math.min(pct, 99);
				renderHistory();
			}
		}

		socketRef.emit("signal", {
			room: currentRoomRef,
			signal: { type: "file-end", id: transferId },
		});

		const histItem = transferHistory.find((h) => h.id === transferId);
		if (histItem) {
			histItem.status = "completed";
			histItem.progress = 100;
			renderHistory();
		}
	} catch (err) {
		console.error("Fallback send error:", err);
		const histItem = transferHistory.find((h) => h.id === transferId);
		if (histItem) {
			histItem.status = "error";
			renderHistory();
		}
		showError(`Fallback send failed: ${err.message}`, errorBoxRef);
	}
}

export function handleFallbackSignal(signal) {
	if (!signal || typeof signal !== "object") return;
	if (signal.type === "file-meta") {
		fallbackMeta = signal;
		fallbackReceiveBuffer = [];
		fallbackReceivedSize = 0;
		fallbackComplete = false;
		fallbackObjectUrl = null;
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
		if (!fallbackMeta || fallbackMeta.id !== signal.id) return;
		try {
			const binary = atob(signal.data);
			const len = binary.length;
			const bytes = new Uint8Array(len);
			for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
			fallbackReceiveBuffer.push(bytes.buffer);
			fallbackReceivedSize += bytes.byteLength;
			const histItem = transferHistory.find((h) => h.id === signal.id);
			if (histItem && fallbackMeta.size > 0) {
				const pct = Math.round(
					(fallbackReceivedSize / fallbackMeta.size) * 100,
				);
				histItem.progress = Math.min(pct, 99);
				renderHistory();
			}
			if (fallbackReceivedSize >= fallbackMeta.size) {
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
	if (fallbackComplete || !fallbackMeta || fallbackMeta.id !== id) return;
	fallbackComplete = true;
	const histItem = transferHistory.find((h) => h.id === id);
	if (histItem) {
		try {
			const blob = new Blob(fallbackReceiveBuffer, {
				type: histItem.type || "application/octet-stream",
			});
			fallbackObjectUrl = URL.createObjectURL(blob);
			histItem.objectUrl = fallbackObjectUrl;
			histItem.status = "completed";
			histItem.progress = 100;
		} catch (e) {
			histItem.status = "error";
			console.error("Fallback blob creation failed:", e);
		}
		renderHistory();
	}
	fallbackReceiveBuffer = [];
	fallbackMeta = null;
}
