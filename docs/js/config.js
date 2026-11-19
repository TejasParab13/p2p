// ---------------------------------------------------------------------------
// Configuration and constants
// ---------------------------------------------------------------------------
// To override the signaling URL, set window.P2P_SIGNALING_URL before this
// module loads, or update the value below for your deployment.
// ---------------------------------------------------------------------------

export const SIGNALING_URL =
	(typeof window !== "undefined" && window.P2P_SIGNALING_URL) || "https://p2p-rmpb.onrender.com";

// ICE servers for WebRTC peer connections.
// These use publicly available STUN/TURN servers.  For production, consider
// deploying your own TURN server (e.g. coturn) and providing credentials
// via environment-specific config.
export const RTC_CONFIG = {
	iceServers: [
		{ urls: "stun:stun.l.google.com:19302" },
		{ urls: "stun:stun1.l.google.com:19302" },
		{
			urls: "turn:turn.anyfirewall.com:443?transport=tcp",
			username: "anyfirewall",
			credential: "anyfirewall",
		},
		{
			urls: "turn:openrelay.metered.ca:80",
			username: "openrelayproject",
			credential: "openrelayproject",
		},
		{
			urls: "turn:openrelay.metered.ca:443",
			username: "openrelayproject",
			credential: "openrelayproject",
		},
		{
			urls: "turn:openrelay.metered.ca:443?transport=tcp",
			username: "openrelayproject",
			credential: "openrelayproject",
		},
	],
	iceTransportPolicy: "all",
};
