import { formatBytes, formatTime, getFileIcon } from "./utils.js";

export let transferHistory = [];
export let historyListPC, historyListMobile, historyEmptyPC, historyEmptyMobile;
export let currentFilter = "all"; // "all" | "sent" | "received"

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

export function renderHistory() {
	const items = transferHistory.slice(-20).reverse();
	let filteredItems = items;

	if (currentFilter === "sent") {
		filteredItems = items.filter((item) => item.direction === "sent");
	} else if (currentFilter === "received") {
		filteredItems = items.filter((item) => item.direction === "received");
	}

	const isEmpty = filteredItems.length === 0;
	historyEmptyPC.classList.toggle("hidden", !isEmpty);
	historyEmptyMobile.classList.toggle("hidden", !isEmpty);

	const generateHTML = (item) => {
		const isReceived = item.direction === "received";
		const statusIcon =
			item.status === "completed"
				? '<svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>'
				: item.status === "error"
					? '<svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>'
					: `<div class="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>`;

		// Redownload icon for received completed files
		const redownloadIcon = `<svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9.75v6.75m0 0-3-3m3 3 3-3m-7.5 3a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" /></svg>`;
		const downloadIcon = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>`;

		const actionButton =
			isReceived && item.status === "completed" && item.objectUrl
				? `<a href="${item.objectUrl}" download="${item.name}" class="shrink-0 ml-3 p-2 rounded-lg bg-zinc-800 hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-300 transition-colors" title="Download again">
         ${redownloadIcon}
       </a>`
				: `<div class="shrink-0 ml-3 p-2">${statusIcon}</div>`;

		const progressBar =
			item.status === "transferring"
				? `<div class="w-full bg-zinc-800 rounded-full h-1 mt-2 overflow-hidden">
         <div class="bg-indigo-500 h-1 rounded-full transition-all duration-300" style="width: ${Math.min(item.progress || 0, 100)}%"></div>
       </div>`
				: "";
		return `
      <div class="fade-in flex items-center p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/50 hover:border-zinc-700 transition-colors group">
        <div class="shrink-0 mr-3">${getFileIcon(item.type, item.name)}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between">
            <p class="text-sm font-medium text-zinc-200 truncate pr-2" title="${item.name}">${item.name}</p>
            <span class="text-[10px] text-zinc-500 whitespace-nowrap">${formatTime(item.timestamp)}</span>
          </div>
          <div class="flex items-center justify-between mt-0.5">
            <span class="text-xs text-zinc-500">${formatBytes(item.size)} ${isReceived ? "• Received" : "• Sent"}</span>
          </div>
          ${progressBar}
        </div>
        ${actionButton}
      </div>
    `;
	};

	const html = filteredItems.map(generateHTML).join("");
	const emptyHTML = `<div class="h-full flex flex-col items-center justify-center text-zinc-600">
      <svg class="w-10 h-10 mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
      <p class="text-sm font-medium">${isEmpty ? "No files transferred yet" : "No matching files"}</p>
      ${isEmpty ? '<p class="text-[10px] mt-0.5">Sent and received files appear here</p>' : ""}
    </div>`;
	historyListPC.innerHTML =
		(isEmpty ? "" : html) + (isEmpty ? emptyHTML : "");
	historyListMobile.innerHTML =
		(isEmpty ? "" : html) + (isEmpty ? emptyHTML : "");
}

export function clearHistory() {
	transferHistory.forEach((item) => {
		if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
	});
	transferHistory = [];
	renderHistory();
}
