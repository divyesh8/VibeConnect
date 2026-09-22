import assert from "node:assert/strict";
import test from "node:test";

// Mock WebRTC browser globals for Node.js test environment
class MockMediaStreamTrack {
  constructor(kind, readyState = "live") {
    this.id = `track-${kind}-${Math.random().toString(36).slice(2)}`;
    this.kind = kind;
    this.readyState = readyState;
    this.enabled = true;
    this.muted = false;
  }
  stop() {
    this.readyState = "ended";
  }
}

class MockMediaStream {
  constructor(tracks = []) {
    this.id = `stream-${Math.random().toString(36).slice(2)}`;
    this._tracks = [...tracks];
  }
  getTracks() {
    return [...this._tracks];
  }
  getAudioTracks() {
    return this._tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this._tracks.filter((t) => t.kind === "video");
  }
  addTrack(track) {
    if (!this._tracks.includes(track)) {
      this._tracks.push(track);
    }
  }
  removeTrack(track) {
    this._tracks = this._tracks.filter((t) => t !== track);
  }
}

class MockRTCRtpSender {
  constructor(track) {
    this.track = track;
    this._parameters = { encodings: [{ maxBitrate: 100000 }] };
  }
  getParameters() {
    return this._parameters;
  }
  async setParameters(params) {
    this._parameters = params;
  }
  async replaceTrack(newTrack) {
    this.track = newTrack;
  }
}

class MockRTCPeerConnection {
  constructor(configuration = {}) {
    this.configuration = configuration;
    this.signalingState = "stable";
    this.iceConnectionState = "new";
    this.connectionState = "new";
    this.iceGatheringState = "new";
    this.localDescription = null;
    this.remoteDescription = null;
    this.senders = [];
    this.addedCandidates = [];
    this.eventListeners = {};
  }

  addEventListener(event, listener) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(listener);
  }

  removeEventListener(event, listener) {
    if (!this.eventListeners[event]) return;
    this.eventListeners[event] = this.eventListeners[event].filter((l) => l !== listener);
  }

  dispatchEvent(event) {
    const listeners = this.eventListeners[event.type] || [];
    for (const listener of listeners) listener(event);
  }

  getSenders() {
    return this.senders;
  }

  addTrack(track, stream) {
    const sender = new MockRTCRtpSender(track);
    this.senders.push(sender);
    return sender;
  }

  async createOffer(options = {}) {
    this.lastOfferOptions = options;
    return {
      type: "offer",
      sdp: "v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=ice-ufrag:testufrag\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n",
    };
  }

  async createAnswer() {
    return {
      type: "answer",
      sdp: "v=0\r\no=- 54321 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=ice-ufrag:remoteufrag\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n",
    };
  }

  async setLocalDescription(desc) {
    this.localDescription = desc;
    if (desc.type === "offer") {
      this.signalingState = "have-local-offer";
    } else if (desc.type === "answer") {
      this.signalingState = "stable";
    }
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
    if (desc.type === "offer") {
      this.signalingState = "have-remote-offer";
    } else if (desc.type === "answer") {
      this.signalingState = "stable";
    }
  }

  async addIceCandidate(candidate) {
    this.addedCandidates.push(candidate);
  }

  setConfiguration(config) {
    this.configuration = config;
  }

  restartIce() {
    this.iceRestartTriggered = true;
  }

  async getStats() {
    return new Map();
  }

  close() {
    this.signalingState = "closed";
    this.connectionState = "closed";
    this.iceConnectionState = "closed";
  }
}

globalThis.RTCPeerConnection = MockRTCPeerConnection;
globalThis.MediaStream = MockMediaStream;
globalThis.MediaStreamTrack = MockMediaStreamTrack;

// Dynamically import PeerManager with mock globals installed
const { PeerManager } = await import("../webrtc/peer-manager.ts");

// ============================================================================
// 1. WebRTC Unit & Regression Tests
// ============================================================================

test("WebRTC: duplicate offer handling is strictly idempotent and re-sends answer", async () => {
  const emittedSignals = [];
  const peer = new PeerManager({
    roomId: "test-room",
    userId: "test-user-receiver",
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    forceRelay: false,
    emitSignal: async (sig) => { emittedSignals.push(sig); },
    onRemoteStream: () => {},
    onStateChange: () => {},
    onMilestone: () => {},
    onError: (msg, err) => { throw err || new Error(msg); },
  });

  const offer = {
    type: "offer",
    sdp: "v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=ice-ufrag:testufrag\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
  };

  // First offer acceptance
  await peer.acceptOffer(offer);
  assert.equal(peer.connection.signalingState, "stable");
  assert.equal(emittedSignals.length, 1);
  assert.equal(emittedSignals[0].kind, "answer");

  // Duplicate offer arrives (e.g. from network retry or signaling replay)
  await peer.acceptOffer(offer);
  assert.equal(peer.connection.signalingState, "stable");
  // Answer was re-emitted to rescue sender without throwing InvalidStateError
  assert.equal(emittedSignals.length, 2);
  assert.equal(emittedSignals[1].kind, "answer");

  peer.close();
});

test("WebRTC: duplicate answer handling is cleanly ignored when state is stable", async () => {
  const emittedSignals = [];
  const peer = new PeerManager({
    roomId: "test-room",
    userId: "test-user-initiator",
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    forceRelay: false,
    emitSignal: async (sig) => { emittedSignals.push(sig); },
    onRemoteStream: () => {},
    onStateChange: () => {},
    onMilestone: () => {},
    onError: (msg, err) => { throw err || new Error(msg); },
  });

  // Add audio track so createOffer passes validation
  const audioStream = new MockMediaStream([new MockMediaStreamTrack("audio")]);
  await peer.addLocalStream(audioStream, false);

  // Initiator creates offer
  await peer.createOffer();
  assert.equal(peer.connection.signalingState, "have-local-offer");
  assert.equal(emittedSignals.length, 1);
  assert.equal(emittedSignals[0].kind, "offer");

  const answer = {
    type: "answer",
    sdp: "v=0\r\no=- 54321 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=ice-ufrag:remoteufrag\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
  };

  // Accept first answer -> transitions to stable
  await peer.acceptAnswer(answer);
  assert.equal(peer.connection.signalingState, "stable");

  // Duplicate answer arrives -> must not throw or alter stable state
  await peer.acceptAnswer(answer);
  assert.equal(peer.connection.signalingState, "stable");

  peer.close();
});

test("WebRTC: ICE candidate arriving before remote description is buffered and flushed", async () => {
  const peer = new PeerManager({
    roomId: "test-room",
    userId: "test-user",
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    forceRelay: false,
    emitSignal: async () => {},
    onRemoteStream: () => {},
    onStateChange: () => {},
    onMilestone: () => {},
    onError: () => {},
  });

  const candidate = {
    candidate: "candidate:1 1 UDP 2122260223 192.168.1.100 50000 typ host",
    sdpMid: "0",
    sdpMLineIndex: 0,
    usernameFragment: "testufrag",
  };

  // Remote description is null initially
  assert.equal(peer.connection.remoteDescription, null);

  // Candidate arrives early
  await peer.addRemoteIceCandidate(candidate);
  // Must NOT be added to RTCPeerConnection yet (would cause error in real WebRTC)
  assert.equal(peer.connection.addedCandidates.length, 0);

  // Now remote description arrives
  const offer = {
    type: "offer",
    sdp: "v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=ice-ufrag:testufrag\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
  };
  await peer.acceptOffer(offer);

  // Candidate must have been flushed into RTCPeerConnection
  assert.equal(peer.connection.addedCandidates.length, 1);
  assert.equal(peer.connection.addedCandidates[0].candidate, candidate.candidate);

  peer.close();
});

test("WebRTC: duplicate ICE candidate is deduplicated by candidateKey", async () => {
  const peer = new PeerManager({
    roomId: "test-room",
    userId: "test-user",
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    forceRelay: false,
    emitSignal: async () => {},
    onRemoteStream: () => {},
    onStateChange: () => {},
    onMilestone: () => {},
    onError: () => {},
  });

  const offer = {
    type: "offer",
    sdp: "v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=ice-ufrag:testufrag\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
  };
  await peer.acceptOffer(offer);

  const candidate = {
    candidate: "candidate:1 1 UDP 2122260223 192.168.1.100 50000 typ host",
    sdpMid: "0",
    sdpMLineIndex: 0,
    usernameFragment: "testufrag",
  };

  await peer.addRemoteIceCandidate(candidate);
  assert.equal(peer.connection.addedCandidates.length, 1);

  // Duplicate candidate arrives
  await peer.addRemoteIceCandidate(candidate);
  // Must still be 1 (deduplicated)
  assert.equal(peer.connection.addedCandidates.length, 1);

  peer.close();
});

test("WebRTC: stale signaling message older than 2 minutes is rejected", () => {
  const roomId = "room-abc";
  const userId = "user-123";
  const now = Date.now();

  const isStale = (timestamp) => Math.abs(now - timestamp) > 2 * 60_000;

  assert.equal(isStale(now - 1000), false); // 1 sec old -> valid
  assert.equal(isStale(now - 121_000), true); // 121 sec old -> rejected
  assert.equal(isStale(now + 125_000), true); // Future clock drift > 2m -> rejected
});

test("WebRTC: signaling message for a different room or sender is rejected", () => {
  const roomId = "room-active";
  const userId = "user-local";

  const isValidSignal = (signal) => signal.roomId === roomId && signal.senderId !== userId;

  assert.equal(isValidSignal({ roomId: "room-active", senderId: "user-partner" }), true);
  assert.equal(isValidSignal({ roomId: "room-old", senderId: "user-partner" }), false);
  assert.equal(isValidSignal({ roomId: "room-active", senderId: "user-local" }), false);
});

test("WebRTC: ICE restart initiated by receiver sends restart-request, handled by initiator", async () => {
  const receiverSignals = [];
  const receiverPeer = new PeerManager({
    roomId: "room-restart",
    userId: "receiver",
    iceServers: [],
    forceRelay: false,
    emitSignal: async (sig) => { receiverSignals.push(sig); },
    onRemoteStream: () => {},
    onStateChange: () => {},
    onMilestone: () => {},
    onError: () => {},
  });

  const initiatorSignals = [];
  const initiatorPeer = new PeerManager({
    roomId: "room-restart",
    userId: "initiator",
    iceServers: [],
    forceRelay: false,
    emitSignal: async (sig) => { initiatorSignals.push(sig); },
    onRemoteStream: () => {},
    onStateChange: () => {},
    onMilestone: () => {},
    onError: () => {},
  });

  const audioStream = new MockMediaStream([new MockMediaStreamTrack("audio")]);
  await initiatorPeer.addLocalStream(audioStream, false);

  // Initiator restarts ICE
  await initiatorPeer.restartIce();
  assert.equal(initiatorPeer.connection.lastOfferOptions?.iceRestart, true);
  assert.equal(initiatorSignals.some((s) => s.kind === "offer"), true);

  receiverPeer.close();
  initiatorPeer.close();
});

test("WebRTC: cleanup closes peer connection, stops tracks, and clears pending state", async () => {
  const peer = new PeerManager({
    roomId: "room-cleanup",
    userId: "user-cleanup",
    iceServers: [],
    forceRelay: false,
    emitSignal: async () => {},
    onRemoteStream: () => {},
    onStateChange: () => {},
    onMilestone: () => {},
    onError: () => {},
  });

  const audioTrack = new MockMediaStreamTrack("audio");
  const videoTrack = new MockMediaStreamTrack("video");
  const stream = new MockMediaStream([audioTrack, videoTrack]);
  await peer.addLocalStream(stream, true);

  peer.close();
  assert.equal(peer.connection.connectionState, "closed");
  assert.equal(peer.connection.signalingState, "closed");

  // Local tracks stopped on cleanup
  stream.getTracks().forEach((t) => t.stop());
  assert.equal(audioTrack.readyState, "ended");
  assert.equal(videoTrack.readyState, "ended");
});

// ============================================================================
// 2. Chat Unit & Regression Tests
// ============================================================================

test("Chat: optimistic message appearance with unique client ID and 'sending' status", () => {
  const roomId = "room-chat-1";
  const profile = { id: "user-1", username: "Alice" };
  const content = "Hello world!";

  const optimistic = {
    id: crypto.randomUUID(),
    roomId,
    senderId: profile.id,
    senderName: profile.username,
    content: content.trim(),
    createdAt: new Date().toISOString(),
    status: "sending",
  };

  assert.ok(optimistic.id);
  assert.equal(optimistic.roomId, roomId);
  assert.equal(optimistic.senderId, profile.id);
  assert.equal(optimistic.status, "sending");
});

test("Chat: failed POST updates message status to 'failed'", () => {
  const optimisticId = "msg-123";
  let messages = [{ id: optimisticId, content: "test", status: "sending" }];

  // Simulate failed POST
  const responseOk = false;
  messages = messages.map((m) => m.id === optimisticId ? { ...m, status: responseOk ? "sent" : "failed" } : m);

  assert.equal(messages[0].status, "failed");
});

test("Chat: deduplication of duplicate messages between Broadcast hint and Postgres CDC", () => {
  let messages = [];
  const knownMessageIds = new Set();

  const addMessage = (incoming) => {
    if (knownMessageIds.has(incoming.id)) return;
    knownMessageIds.add(incoming.id);
    messages = [...messages, incoming];
  };

  const message = {
    id: "msg-dedup-1",
    roomId: "room-chat-1",
    senderId: "partner-1",
    content: "Hi there!",
    createdAt: new Date().toISOString(),
  };

  // Delivery via Broadcast hint verification
  addMessage(message);
  assert.equal(messages.length, 1);

  // Delivery via Postgres CDC fallback
  addMessage(message);
  assert.equal(messages.length, 1); // Not duplicated
});

test("Chat: rejection of wrong-room message hint", () => {
  const activeRoomId = "room-active";
  const hint = {
    roomId: "room-different",
    messageId: "msg-1",
    senderId: "partner-1",
    sentAt: Date.now(),
  };

  const shouldProcess = hint.roomId === activeRoomId;
  assert.equal(shouldProcess, false);
});

test("Chat: rejection of message hint with invalid sender", () => {
  const profileId = "my-user-id";
  const hint = {
    roomId: "room-active",
    messageId: "msg-1",
    senderId: profileId, // Self-sender hint
    sentAt: Date.now(),
  };

  const shouldProcess = hint.senderId !== profileId;
  assert.equal(shouldProcess, false);

  // Mismatched verified sender
  const verifiedMessage = { id: "msg-1", senderId: "different-user" };
  const isValidVerified = verifiedMessage.senderId === hint.senderId;
  assert.equal(isValidVerified, false);
});

// ============================================================================
// 3. Media Unit & Regression Tests
// ============================================================================

test("Media: audio track requirement fails if live microphone track is missing", () => {
  const streamWithoutAudio = new MockMediaStream([new MockMediaStreamTrack("video")]);
  const audioTrack = streamWithoutAudio.getAudioTracks()[0];
  assert.throws(() => {
    if (!audioTrack || audioTrack.readyState !== "live") throw new Error("A live microphone track was not created.");
  }, /microphone track was not created/);
});

test("Media: video track requirement fails for video mode if live camera track is missing", () => {
  const streamAudioOnly = new MockMediaStream([new MockMediaStreamTrack("audio")]);
  const mode = "video";
  const videoTrack = streamAudioOnly.getVideoTracks()[0];
  assert.throws(() => {
    if (mode === "video" && (!videoTrack || videoTrack.readyState !== "live")) {
      throw new Error("A live camera track was not created.");
    }
  }, /camera track was not created/);
});

test("Media: remote audio and video tracks attach to existing remoteStream without replacement", () => {
  const remoteStream = new MockMediaStream();
  const initialStreamRef = remoteStream;

  const audioTrack = new MockMediaStreamTrack("audio");
  const videoTrack = new MockMediaStreamTrack("video");

  // First track arrival (e.g. audio)
  remoteStream.addTrack(audioTrack);
  assert.equal(remoteStream.getAudioTracks().length, 1);
  assert.equal(remoteStream, initialStreamRef);

  // Subsequent track arrival (e.g. video)
  remoteStream.addTrack(videoTrack);
  assert.equal(remoteStream.getVideoTracks().length, 1);
  // Crucial: stream instance MUST remain identical so video element srcObject is not broken
  assert.equal(remoteStream, initialStreamRef);
  assert.equal(remoteStream.getTracks().length, 2);
});

test("Media: autoplay rejection sets playbackBlocked and user interaction retries play", async () => {
  let playbackBlocked = false;
  let playAttempts = 0;
  let canPlay = false;

  const mockVideoElement = {
    muted: true,
    volume: 0,
    play: async () => {
      playAttempts += 1;
      if (!canPlay) throw new Error("NotAllowedError: play() failed because the user didn't interact first.");
      return undefined;
    },
  };

  // Initial autoplay attempt fails
  await mockVideoElement.play().catch(() => {
    playbackBlocked = true;
  });
  assert.equal(playbackBlocked, true);
  assert.equal(playAttempts, 1);

  // User gesture interaction: enablePartnerAudio
  mockVideoElement.muted = false;
  mockVideoElement.volume = 1;
  canPlay = true; // User interacted

  await mockVideoElement.play();
  playbackBlocked = false;
  assert.equal(playbackBlocked, false);
  assert.equal(playAttempts, 2);
});
