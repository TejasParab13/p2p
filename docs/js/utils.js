let errorTimeout = null;

export function formatBytes(bytes, decimals = 1) {
	if (!bytes || isNaN(bytes) || bytes < 0) return "0 B";
	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export function formatTime(date) {
	const now = new Date();
	const diff = Math.floor((now - date) / 1000);
	if (diff < 86400 && date.getDate() === now.getDate()) {
		return date.toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});
	}
	return date.toLocaleString([], {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function getFileIcon(type, name) {
	if (type && type.startsWith("image/"))
		return '<svg class="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>';
	if (type && type.startsWith("video/"))
		return '<svg class="w-8 h-8 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>';
	if (type && type.startsWith("audio/"))
		return '<svg class="w-8 h-8 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>';
	if (type && type.includes("pdf"))
		return '<svg class="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>';
	return '<svg class="w-8 h-8 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>';
}

export function showError(message, errorBox) {
	if (errorTimeout) clearTimeout(errorTimeout);
	errorBox.textContent = message;
	errorBox.classList.remove("hidden");
	errorTimeout = setTimeout(() => errorBox.classList.add("hidden"), 8000);
}

export function setConnectionStatus(connectionStatus, statusText, text, state) {
	if (connectionStatus) {
		connectionStatus.textContent = text;
		connectionStatus.className = `font-medium text-sm ${state === "good" ? "text-emerald-400" : state === "bad" ? "text-red-400" : "text-indigo-400 animate-pulse"}`;
	}
	if (statusText) {
		statusText.textContent = text;
		statusText.className = `font-medium mb-4 text-sm ${state === "good" ? "text-emerald-400" : state === "bad" ? "text-red-400" : "text-indigo-400 animate-pulse"}`;
	}
	const infoEl = document.getElementById("connection-info");
	if (infoEl) {
		infoEl.textContent = text;
		infoEl.className = `text-center text-xs leading-tight ${state === "good" ? "text-emerald-400" : state === "bad" ? "text-red-400" : "text-zinc-400"}`;
	}
}
