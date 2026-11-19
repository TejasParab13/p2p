// ============================================================
// components.js – Reusable UI parts (no layout, just pure HTML)
// ============================================================

export function ModeSelector({ selected = "webrtc" } = {}) {
	const webrtcChecked = selected === "webrtc" ? "checked" : "";
	const fallbackChecked = selected === "fallback" ? "checked" : "";
	return `
    <div class="flex rounded-full bg-[#121214] p-0.5 border border-[#2a2a2e] w-full">
      <label class="flex-1 text-center cursor-pointer transition-colors" data-mode="webrtc">
        <input type="radio" name="mode" value="webrtc" class="hidden peer" ${webrtcChecked} />
        <span class="peer-checked:bg-white peer-checked:text-[#1a1a1a] peer-checked:shadow-md text-zinc-400 hover:text-zinc-300 block py-1.5 px-2 rounded-full text-sm font-medium transition-all duration-200">Direct</span>
      </label>
      <label class="flex-1 text-center cursor-pointer transition-colors" data-mode="fallback">
        <input type="radio" name="mode" value="fallback" class="hidden peer" ${fallbackChecked} />
        <span class="peer-checked:bg-white peer-checked:text-[#1a1a1a] peer-checked:shadow-md text-zinc-400 hover:text-zinc-300 block py-1.5 px-2 rounded-full text-sm font-medium transition-all duration-200">Relay</span>
      </label>
    </div>
  `;
}

export function DropZone({
	id = "drop-zone",
	inputId = "file-input",
	label = "Click or Drop",
} = {}) {
	return `
    <label id="${id}" class="flex flex-col items-center justify-center border-2 border-dashed border-[#2a2a2e] hover:border-[#5a5a5e] hover:bg-[#1a1a1e] rounded-xl cursor-pointer transition-all group flex-1 min-h-[60px]">
      <input type="file" id="${inputId}" class="hidden" multiple />
      <div class="text-center p-2">
        <div class="w-10 h-10 rounded-xl bg-[#121214] group-hover:bg-[#1e1e22] flex items-center justify-center mx-auto mb-1 transition">
          <svg class="w-5 h-5 text-zinc-500 group-hover:text-[#b0b0b0] transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
        </div>
        <span class="text-base font-medium text-zinc-200 group-hover:text-white block">${label}</span>
        <span class="text-xs text-zinc-500">Drop as many files as you want</span>
      </div>
    </label>
  `;
}

export function HistoryPanel({
	listId = "history-list",
	emptyId = "history-empty",
	title = "Transfers",
} = {}) {
	return `
    <div class="flex flex-col gap-1 h-full overflow-hidden">
      <div class="flex items-center justify-between px-1 shrink-0">
        <h2 class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">${title}</h2>
        <button onclick="window.clearHistory()" class="text-[9px] text-zinc-500 hover:text-red-400 transition">Clear All</button>
      </div>
      <div class="bg-[#18181b] border border-[#2a2a2e] rounded-xl p-3 flex-1 flex flex-col min-h-0 overflow-hidden">
        <!-- Filter bar with improved alignment -->
        <div class="flex items-center justify-between mb-2 shrink-0">
          <div class="flex rounded-full bg-[#121214] p-0.5 border border-[#2a2a2e]">
            <label class="cursor-pointer flex-1">
              <input type="radio" name="filter" value="all" class="hidden peer" checked />
              <span class="peer-checked:bg-white peer-checked:text-[#1a1a1a] peer-checked:shadow-sm text-zinc-400 hover:text-zinc-300 block text-center text-[10px] px-3 py-0.5 rounded-full transition-all">All</span>
            </label>
            <label class="cursor-pointer flex-1">
              <input type="radio" name="filter" value="sent" class="hidden peer" />
              <span class="peer-checked:bg-white peer-checked:text-[#1a1a1a] peer-checked:shadow-sm text-zinc-400 hover:text-zinc-300 block text-center text-[10px] px-3 py-0.5 rounded-full transition-all">Sent</span>
            </label>
            <label class="cursor-pointer flex-1">
              <input type="radio" name="filter" value="received" class="hidden peer" />
              <span class="peer-checked:bg-white peer-checked:text-[#1a1a1a] peer-checked:shadow-sm text-zinc-400 hover:text-zinc-300 block text-center text-[10px] px-3 py-0.5 rounded-full transition-all">Received</span>
            </label>
          </div>
        </div>
        <div id="${listId}" class="flex-1 overflow-y-auto space-y-1 pr-1">
          <div id="${emptyId}" class="h-full flex flex-col items-center justify-center text-zinc-600">
            <svg class="w-8 h-8 mb-1 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <p class="text-xs font-medium">No files transferred yet</p>
            <p class="text-[9px] mt-0.5">Sent and received files appear here</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function ChatPanel({
	chatId = "chat-messages",
	inputId = "chat-input",
	sendId = "chat-send",
} = {}) {
	return `
		<div class="flex flex-col gap-1 h-full overflow-hidden">
			<div class="flex items-center justify-between px-1 shrink-0">
				<h2 class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Chat</h2>
			</div>
			<div class="bg-[#18181b] border border-[#2a2a2e] rounded-xl p-3 flex-1 flex flex-col min-h-0 overflow-hidden">
				<div id="${chatId}" class="flex-1 overflow-y-auto space-y-1 pr-1"></div>
				<div class="flex gap-2 mt-2">
					<input id="${inputId}" type="text" class="flex-1 bg-[#121214] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#5a5a5e]" placeholder="Type a message..." />
					<button id="${sendId}" class="bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg px-4 py-2 text-sm transition">Send</button>
				</div>
			</div>
		</div>
	`;
}