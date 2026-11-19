import { formatBytes, formatTime, getFileIcon } from "./utils.js";

export let transferHistory = [];
export let historyListPC, historyListMobile, historyEmptyPC, historyEmptyMobile;
export let currentFilter = "all";
export const downloadedSet = new Set();

export function setFilter(filter) {
	currentFilter = filter;
	renderHistory();
}

export function initHistory(domRefs) {
	historyListPC = domRefs.historyListPC;
	historyListMobile = domRefs.historyListMobile;
	historyEmptyPC = domRefs.historyEmptyPC;
	historyEmptyMobile = domRefs.historyEmptyMobile;
}

export function markDownloaded(id) {
	downloadedSet.add(id);
	renderHistory();
}

function trimHistory() {
	while (transferHistory.length > 50) {
		const removed = transferHistory.shift();
		if (removed.objectUrl) {
			URL.revokeObjectURL(removed.objectUrl);
			removed.objectUrl = null;
		}
	}
}

export function renderHistory() {
	trimHistory();
	const items = transferHistory.slice(-20).reverse();
	let filteredItems = items;
	if (currentFilter === "sent") {
		filteredItems = items.filter((item) => item.direction === "sent");
	} else if (currentFilter === "received") {
		filteredItems = items.filter((item) => item.direction === "received");
	}

	const isEmpty = filteredItems.length === 0;

	// Update empty state
	if (historyEmptyPC) {
		historyEmptyPC.classList.toggle("hidden", !isEmpty);
	}
	if (historyEmptyMobile && historyEmptyMobile !== historyEmptyPC) {
		historyEmptyMobile.classList.toggle("hidden", !isEmpty);
	}

	const generateHTML = (item) => {
		const isReceived = item.direction === "received";
		const isCompleted = item.status === "completed";
		const isTransferring = item.status === "transferring";
		const isQueued = item.status === "queued";
		const isError = item.status === "error";

		// Image preview thumbnail
		let previewHtml = "";
		if (isCompleted && item.objectUrl && item.type && item.type.startsWith("image/")) {
			previewHtml = `
				<div class="mt-2.5 rounded-lg overflow-hidden border border-zinc-700/60 bg-black/40 flex items-center justify-center p-1">
					<img src="${item.objectUrl}" alt="${item.name}"
						class="max-h-36 max-w-full rounded object-contain cursor-pointer hover:opacity-90 transition"
						onclick="window.open('${item.objectUrl}', '_blank')"
						title="Click to view full image" />
				</div>
			`;
		}

		// Action button / status
		let actionButton;
		if (isReceived && isCompleted && item.objectUrl) {
			const isDownloaded = downloadedSet.has(item.id);
			actionButton = `
				<a href="${item.objectUrl}" download="${item.name}"
					onclick="window.markDownloaded('${item.id}')"
					class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${
						isDownloaded ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" : "bg-indigo-600 hover:bg-indigo-500 text-white shadow"
					} text-xs font-medium transition-all shrink-0"
					title="${isDownloaded ? 'Downloaded (click to download again)' : 'Download to device'}">
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
					</svg>
					<span>${isDownloaded ? "Saved" : "Save"}</span>
				</a>
			`;
		} else if (isCompleted) {
			actionButton = `
				<div class="shrink-0 p-1.5 text-emerald-400" title="Completed">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
					</svg>
				</div>
			`;
		} else if (isError) {
			actionButton = `
				<div class="shrink-0 p-1.5 text-red-400" title="Failed">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
					</svg>
				</div>
			`;
		} else {
			actionButton = `
				<div class="shrink-0 p-1.5 text-indigo-400" title="${isQueued ? 'Queued' : 'Transferring'}">
					<div class="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
				</div>
			`;
		}

		const progressBar = (isTransferring || isQueued)
			? `<div class="w-full bg-zinc-800 rounded-full h-1.5 mt-2 overflow-hidden">
					<div class="bg-indigo-500 h-1.5 rounded-full transition-all duration-200" style="width: ${Math.min(item.progress || 0, 100)}%"></div>
			   </div>`
			: "";

		return `
			<div class="fade-in p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 transition-colors">
				<div class="flex items-center gap-3">
					<div class="shrink-0">${getFileIcon(item.type, item.name)}</div>
					<div class="flex-1 min-w-0">
						<div class="flex items-center justify-between gap-2">
							<p class="text-sm font-medium text-zinc-200 truncate" title="${item.name}">${item.name}</p>
							<span class="text-[10px] text-zinc-500 whitespace-nowrap">${formatTime(item.timestamp)}</span>
						</div>
						<div class="flex items-center justify-between mt-0.5">
							<span class="text-xs text-zinc-400">
								${formatBytes(item.size)} • ${isReceived ? "Received" : "Sent"}
								${isTransferring ? `• ${Math.round(item.progress || 0)}%` : ""}
								${isQueued ? "• Queued" : ""}
							</span>
						</div>
					</div>
					${actionButton}
				</div>
				${progressBar}
				${previewHtml}
			</div>
		`;
	};

	const html = filteredItems.map(generateHTML).join("");
	const emptyHTML = `
		<div class="h-full flex flex-col items-center justify-center text-zinc-600">
			<svg class="w-10 h-10 mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
			</svg>
			<p class="text-sm font-medium">${isEmpty ? "No files transferred yet" : "No matching files"}</p>
			${isEmpty ? '<p class="text-[10px] mt-0.5">Sent and received files appear here</p>' : ""}
		</div>
	`;

	const content = (isEmpty ? "" : html) + (isEmpty ? emptyHTML : "");
	if (historyListPC) historyListPC.innerHTML = content;
	if (historyListMobile && historyListMobile !== historyListPC) {
		historyListMobile.innerHTML = content;
	}
}

export function clearHistory() {
	transferHistory.forEach((item) => {
		if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
	});
	transferHistory = [];
	downloadedSet.clear();
	renderHistory();
}

window.markDownloaded = markDownloaded;
window.clearHistory = clearHistory;
