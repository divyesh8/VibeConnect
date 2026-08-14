import type { WebRTCDiagnostics } from "@/types";

export type PeerSignal =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice-candidate"; candidate: RTCIceCandidateInit };

export type PeerMilestone =
  | "first-local-ice"
  | "ice-connected"
  | "peer-connected"
  | "first-remote-audio-track"
  | "first-remote-video-track"
  | "first-inbound-video-packet"
  | "first-decoded-video-frame";

type PeerManagerOptions = {
  iceServers: RTCIceServer[];
  forceRelay: boolean;
  emitSignal: (signal: PeerSignal) => Promise<void>;
  onRemoteStream: (stream: MediaStream) => void;
  onStateChange: () => void;
  onMilestone: (milestone: PeerMilestone) => void;
  onError: (message: string, error: unknown) => void;
};

type StatsRecord = RTCStats & Record<string, unknown>;

type StatsSample = {
  at: number;
  bytesSent: number;
  bytesReceived: number;
  videoBytesSent: number;
  videoBytesReceived: number;
  audioBytesSent: number;
  audioBytesReceived: number;
};

const CANDIDATE_TYPES = ["host", "srflx", "prflx", "relay"] as const;

function developmentLog(prefix: string, message: string, details?: unknown) {
  if (process.env.NODE_ENV !== "development") return;
  if (details === undefined) console.info(`[${prefix}] ${message}`);
  else console.info(`[${prefix}] ${message}`, details);
}

function descriptionInit(description: RTCSessionDescription | null): RTCSessionDescriptionInit {
  if (!description) throw new Error("The local session description is missing.");
  return { type: description.type, sdp: description.sdp };
}

function trackState(stream: MediaStream | null, kind: "audio" | "video"): MediaStreamTrackState | "missing" {
  return stream?.getTracks().find((track) => track.kind === kind)?.readyState ?? "missing";
}

function finiteNumber(value: unknown): number | null {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : null;
}

function numberOrZero(value: unknown) {
  return finiteNumber(value) ?? 0;
}

function candidateType(value: unknown): WebRTCDiagnostics["candidateType"] {
  return CANDIDATE_TYPES.includes(value as (typeof CANDIDATE_TYPES)[number])
    ? value as WebRTCDiagnostics["candidateType"]
    : "unknown";
}

function bitrateKbps(current: number, previous: number, elapsedMs: number): number | null {
  if (elapsedMs <= 0 || current < previous) return null;
  return ((current - previous) * 8) / elapsedMs;
}

function emptyDiagnostics(connection: RTCPeerConnection, localStream: MediaStream | null, remoteStream: MediaStream): WebRTCDiagnostics {
  return {
    signalingState: connection.signalingState,
    iceGatheringState: connection.iceGatheringState,
    iceConnectionState: connection.iceConnectionState,
    connectionState: connection.connectionState,
    localAudio: trackState(localStream, "audio"),
    localVideo: trackState(localStream, "video"),
    remoteAudio: trackState(remoteStream, "audio"),
    remoteVideo: trackState(remoteStream, "video"),
    bytesSent: 0,
    bytesReceived: 0,
    packetsSent: 0,
    packetsReceived: 0,
    framesEncoded: 0,
    framesDecoded: 0,
    candidateType: "unknown",
    localCandidateType: "unknown",
    remoteCandidateType: "unknown",
    route: "unknown",
    protocol: null,
    relayProtocol: null,
    rttMs: null,
    availableOutgoingBitrateKbps: null,
    outgoingBitrateKbps: null,
    incomingBitrateKbps: null,
    packetsLost: 0,
    packetLossPercent: null,
    jitterMs: null,
    jitterBufferMs: null,
    codec: null,
    videoOutbound: {
      bytesSent: 0,
      packetsSent: 0,
      framesEncoded: 0,
      framesSent: 0,
      framesPerSecond: null,
      frameWidth: null,
      frameHeight: null,
      bitrateKbps: null,
      qualityLimitationReason: null,
    },
    videoInbound: {
      bytesReceived: 0,
      packetsReceived: 0,
      packetsLost: 0,
      framesReceived: 0,
      framesDecoded: 0,
      framesDropped: 0,
      framesPerSecond: null,
      frameWidth: null,
      frameHeight: null,
      bitrateKbps: null,
      jitterMs: null,
      jitterBufferMs: null,
    },
    audioOutbound: {
      bytesSent: 0,
      packetsSent: 0,
      bitrateKbps: null,
    },
    audioInbound: {
      bytesReceived: 0,
      packetsReceived: 0,
      packetsLost: 0,
      bitrateKbps: null,
      jitterMs: null,
      jitterBufferMs: null,
    },
  };
}

export class PeerManager {
  readonly connection: RTCPeerConnection;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private candidateKeys = new Set<string>();
  private remoteStream = new MediaStream();
  private emittedMilestones = new Set<PeerMilestone>();
  private previousStatsSample: StatsSample | null = null;
  private makingOffer = false;
  private closed = false;

  constructor(private readonly options: PeerManagerOptions) {
    this.connection = new RTCPeerConnection({
      iceServers: options.iceServers,
      iceCandidatePoolSize: 4,
      iceTransportPolicy: options.forceRelay ? "relay" : "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    });

    developmentLog("WEBRTC", `peer connection created (${options.forceRelay ? "relay-only" : "all candidates"})`);

    this.connection.onicecandidate = (event) => {
      if (!event.candidate || this.closed) return;
      this.markMilestone("first-local-ice");
      developmentLog("ICE", `local candidate generated (${event.candidate.type ?? "unknown"})`);
      void this.options.emitSignal({ kind: "ice-candidate", candidate: event.candidate.toJSON() })
        .catch((error) => this.options.onError("Could not send an ICE candidate.", error));
    };
    this.connection.ontrack = (event) => {
      if (this.closed) return;
      const negotiatedStream = event.streams[0];
      if (negotiatedStream) {
        this.remoteStream = negotiatedStream;
      } else if (!this.remoteStream.getTracks().some((track) => track.id === event.track.id)) {
        this.remoteStream.addTrack(event.track);
      }
      this.markMilestone(event.track.kind === "video" ? "first-remote-video-track" : "first-remote-audio-track");
      developmentLog("MEDIA", `remote ${event.track.kind} track received (${event.track.readyState})`);
      developmentLog("MEDIA", "Remote tracks received:", this.remoteStream.getTracks().map((track) => ({
        kind: track.kind,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
      })));
      event.track.onended = () => this.options.onStateChange();
      event.track.onmute = () => this.options.onStateChange();
      event.track.onunmute = () => this.options.onStateChange();
      this.options.onRemoteStream(this.remoteStream);
      this.options.onStateChange();
    };
    this.connection.onconnectionstatechange = () => {
      developmentLog("WEBRTC", `connectionState=${this.connection.connectionState}`);
      if (this.connection.connectionState === "connected") {
        this.markMilestone("peer-connected");
        void this.configureVideoForRealtime();
      }
      this.options.onStateChange();
    };
    this.connection.oniceconnectionstatechange = () => {
      developmentLog("ICE", `iceConnectionState=${this.connection.iceConnectionState}`);
      if (this.connection.iceConnectionState === "connected" || this.connection.iceConnectionState === "completed") {
        this.markMilestone("ice-connected");
      }
      this.options.onStateChange();
    };
    this.connection.onicegatheringstatechange = () => {
      developmentLog("ICE", `iceGatheringState=${this.connection.iceGatheringState}`);
      this.options.onStateChange();
    };
    this.connection.onsignalingstatechange = () => {
      developmentLog("SIGNAL", `signalingState=${this.connection.signalingState}`);
      this.options.onStateChange();
    };
  }

  async addLocalStream(stream: MediaStream, requireVideo: boolean) {
    if (this.closed) throw new Error("The peer connection is already closed.");
    const audioTracks = stream.getAudioTracks();
    const videoTracks = stream.getVideoTracks();
    if (!audioTracks.some((track) => track.readyState === "live")) throw new Error("A live microphone track is required before creating the peer connection.");
    if (requireVideo && !videoTracks.some((track) => track.readyState === "live")) throw new Error("A live camera track is required before creating the peer connection.");

    for (const track of stream.getTracks()) {
      try {
        track.contentHint = track.kind === "video" ? "motion" : "speech";
      } catch (error) {
        developmentLog("MEDIA", `${track.kind} content hint is not supported`, error);
      }
      developmentLog("MEDIA", `local ${track.kind} track`, {
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
      });
      this.connection.addTrack(track, stream);
    }

    const senderKinds = this.connection.getSenders().map((sender) => sender.track?.kind ?? "missing");
    if (!senderKinds.includes("audio")) throw new Error("The microphone track was not added to the peer connection.");
    if (requireVideo && !senderKinds.includes("video")) throw new Error("The camera track was not added before offer creation.");
    developmentLog("WEBRTC", "local senders ready before offer", senderKinds);
    await this.configureVideoForRealtime();
  }

  async createOffer(options: { iceRestart?: boolean } = {}) {
    if (this.closed || this.makingOffer || this.connection.signalingState !== "stable") return false;
    this.makingOffer = true;
    try {
      developmentLog("SIGNAL", options.iceRestart ? "creating ICE-restart offer" : "creating offer");
      const offer = await this.connection.createOffer({ iceRestart: options.iceRestart });
      developmentLog("SIGNAL", "OFFER CREATED", { type: offer.type, sdpLength: offer.sdp?.length ?? 0 });
      await this.connection.setLocalDescription(offer);
      await this.options.emitSignal({ kind: "offer", sdp: descriptionInit(this.connection.localDescription) });
      developmentLog("SIGNAL", "OFFER SENT (trickle ICE continues independently)");
      return true;
    } finally {
      this.makingOffer = false;
    }
  }

  async resendPendingOffer() {
    if (
      this.closed
      || this.connection.signalingState !== "have-local-offer"
      || this.connection.localDescription?.type !== "offer"
      || this.connection.remoteDescription
    ) return false;
    await this.options.emitSignal({ kind: "offer", sdp: descriptionInit(this.connection.localDescription) });
    developmentLog("SIGNAL", "pending offer re-sent after peer-ready heartbeat");
    return true;
  }

  async acceptOffer(sdp: RTCSessionDescriptionInit) {
    if (this.closed) return;
    if (
      this.connection.remoteDescription?.type === "offer"
      && this.connection.remoteDescription.sdp === sdp.sdp
      && this.connection.localDescription?.type === "answer"
    ) {
      await this.options.emitSignal({ kind: "answer", sdp: descriptionInit(this.connection.localDescription) });
      developmentLog("SIGNAL", "duplicate offer recovered by re-sending the existing answer");
      return;
    }
    developmentLog("SIGNAL", "OFFER RECEIVED", { type: sdp.type, sdpLength: sdp.sdp?.length ?? 0 });
    await this.connection.setRemoteDescription(sdp);
    await this.flushCandidates();
    const answer = await this.connection.createAnswer();
    developmentLog("SIGNAL", "ANSWER CREATED", { type: answer.type, sdpLength: answer.sdp?.length ?? 0 });
    await this.connection.setLocalDescription(answer);
    await this.options.emitSignal({ kind: "answer", sdp: descriptionInit(this.connection.localDescription) });
    developmentLog("SIGNAL", "ANSWER SENT (trickle ICE continues independently)");
  }

  async acceptAnswer(sdp: RTCSessionDescriptionInit) {
    if (this.closed || this.connection.signalingState === "stable") return;
    developmentLog("SIGNAL", "ANSWER RECEIVED", { type: sdp.type, sdpLength: sdp.sdp?.length ?? 0 });
    await this.connection.setRemoteDescription(sdp);
    await this.flushCandidates();
  }

  async addRemoteIceCandidate(candidate: RTCIceCandidateInit) {
    if (this.closed) return;
    const key = `${candidate.sdpMid ?? ""}:${candidate.sdpMLineIndex ?? ""}:${candidate.candidate ?? ""}`;
    if (this.candidateKeys.has(key)) return;
    this.candidateKeys.add(key);
    if (!this.connection.remoteDescription) {
      this.pendingCandidates.push(candidate);
      developmentLog("ICE", "remote candidate queued until remoteDescription");
      return;
    }
    await this.connection.addIceCandidate(candidate);
    developmentLog("ICE", "remote candidate added");
  }

  async restartIce() {
    if (this.closed) return false;
    this.connection.restartIce();
    return this.createOffer({ iceRestart: true });
  }

  toggleMicrophone(enabled: boolean) {
    for (const sender of this.connection.getSenders()) {
      if (sender.track?.kind === "audio") sender.track.enabled = enabled;
    }
  }

  async replaceVideoTrack(track: MediaStreamTrack) {
    const sender = this.connection.getSenders().find((item) => item.track?.kind === "video");
    if (!sender) throw new Error("The video sender is unavailable.");
    await sender.replaceTrack(track);
    await this.configureVideoSender(sender);
  }

  async getDiagnostics(localStream: MediaStream | null): Promise<WebRTCDiagnostics> {
    const diagnostics = emptyDiagnostics(this.connection, localStream, this.remoteStream);
    const report = await this.connection.getStats();
    const stats: StatsRecord[] = [];
    report.forEach((raw) => stats.push(raw as StatsRecord));

    let selectedPairId: string | null = null;
    let selectedPair: StatsRecord | null = null;
    let videoCodecId: string | null = null;
    let totalJitterBufferDelay = 0;
    let totalJitterBufferEmittedCount = 0;
    const jitterValues: number[] = [];

    for (const stat of stats) {
      if (stat.type === "transport" && typeof stat.selectedCandidatePairId === "string") {
        selectedPairId = stat.selectedCandidatePairId;
      }
    }

    for (const stat of stats) {
      const mediaKind = String(stat.kind ?? stat.mediaType ?? "");
      if (stat.type === "outbound-rtp" && stat.isRemote !== true) {
        const bytes = numberOrZero(stat.bytesSent);
        const packets = numberOrZero(stat.packetsSent);
        diagnostics.bytesSent += bytes;
        diagnostics.packetsSent += packets;
        if (mediaKind === "video") {
          diagnostics.videoOutbound.bytesSent += bytes;
          diagnostics.videoOutbound.packetsSent += packets;
          diagnostics.videoOutbound.framesEncoded += numberOrZero(stat.framesEncoded);
          diagnostics.videoOutbound.framesSent += numberOrZero(stat.framesSent);
          diagnostics.videoOutbound.framesPerSecond = finiteNumber(stat.framesPerSecond);
          diagnostics.videoOutbound.frameWidth = finiteNumber(stat.frameWidth);
          diagnostics.videoOutbound.frameHeight = finiteNumber(stat.frameHeight);
          diagnostics.videoOutbound.qualityLimitationReason = typeof stat.qualityLimitationReason === "string" ? stat.qualityLimitationReason : null;
          diagnostics.framesEncoded += numberOrZero(stat.framesEncoded);
          if (typeof stat.codecId === "string") videoCodecId = stat.codecId;
        } else if (mediaKind === "audio") {
          diagnostics.audioOutbound.bytesSent += bytes;
          diagnostics.audioOutbound.packetsSent += packets;
        }
      }

      if (stat.type === "inbound-rtp" && stat.isRemote !== true) {
        const bytes = numberOrZero(stat.bytesReceived);
        const packets = numberOrZero(stat.packetsReceived);
        const lost = numberOrZero(stat.packetsLost);
        const jitterSeconds = finiteNumber(stat.jitter);
        const jitterBufferDelay = numberOrZero(stat.jitterBufferDelay);
        const jitterBufferCount = numberOrZero(stat.jitterBufferEmittedCount);
        diagnostics.bytesReceived += bytes;
        diagnostics.packetsReceived += packets;
        diagnostics.packetsLost += lost;
        if (jitterSeconds !== null) jitterValues.push(jitterSeconds * 1_000);
        totalJitterBufferDelay += jitterBufferDelay;
        totalJitterBufferEmittedCount += jitterBufferCount;

        if (mediaKind === "video") {
          diagnostics.videoInbound.bytesReceived += bytes;
          diagnostics.videoInbound.packetsReceived += packets;
          diagnostics.videoInbound.packetsLost += lost;
          diagnostics.videoInbound.framesReceived += numberOrZero(stat.framesReceived);
          diagnostics.videoInbound.framesDecoded += numberOrZero(stat.framesDecoded);
          diagnostics.videoInbound.framesDropped += numberOrZero(stat.framesDropped);
          diagnostics.videoInbound.framesPerSecond = finiteNumber(stat.framesPerSecond);
          diagnostics.videoInbound.frameWidth = finiteNumber(stat.frameWidth);
          diagnostics.videoInbound.frameHeight = finiteNumber(stat.frameHeight);
          diagnostics.videoInbound.jitterMs = jitterSeconds === null ? null : jitterSeconds * 1_000;
          diagnostics.videoInbound.jitterBufferMs = jitterBufferCount > 0 ? (jitterBufferDelay / jitterBufferCount) * 1_000 : null;
          diagnostics.framesDecoded += numberOrZero(stat.framesDecoded);
          if (typeof stat.codecId === "string") videoCodecId = stat.codecId;
        } else if (mediaKind === "audio") {
          diagnostics.audioInbound.bytesReceived += bytes;
          diagnostics.audioInbound.packetsReceived += packets;
          diagnostics.audioInbound.packetsLost += lost;
          diagnostics.audioInbound.jitterMs = jitterSeconds === null ? null : jitterSeconds * 1_000;
          diagnostics.audioInbound.jitterBufferMs = jitterBufferCount > 0 ? (jitterBufferDelay / jitterBufferCount) * 1_000 : null;
        }
      }

      if (stat.type === "candidate-pair" && stat.state === "succeeded") {
        if (stat.id === selectedPairId || stat.selected === true || stat.nominated === true) selectedPair = stat;
      }
    }

    if (diagnostics.videoInbound.packetsReceived > 0) this.markMilestone("first-inbound-video-packet");
    if (diagnostics.videoInbound.framesDecoded > 0) this.markMilestone("first-decoded-video-frame");

    const receivedAndLost = diagnostics.packetsReceived + diagnostics.packetsLost;
    diagnostics.packetLossPercent = receivedAndLost > 0 ? (diagnostics.packetsLost / receivedAndLost) * 100 : null;
    diagnostics.jitterMs = jitterValues.length ? Math.max(...jitterValues) : null;
    diagnostics.jitterBufferMs = totalJitterBufferEmittedCount > 0
      ? (totalJitterBufferDelay / totalJitterBufferEmittedCount) * 1_000
      : null;

    if (selectedPair) {
      const rtt = finiteNumber(selectedPair.currentRoundTripTime);
      const availableOutgoingBitrate = finiteNumber(selectedPair.availableOutgoingBitrate);
      diagnostics.rttMs = rtt === null ? null : rtt * 1_000;
      diagnostics.availableOutgoingBitrateKbps = availableOutgoingBitrate === null ? null : availableOutgoingBitrate / 1_000;
      const localCandidate = typeof selectedPair.localCandidateId === "string" ? report.get(selectedPair.localCandidateId) as StatsRecord | undefined : undefined;
      const remoteCandidate = typeof selectedPair.remoteCandidateId === "string" ? report.get(selectedPair.remoteCandidateId) as StatsRecord | undefined : undefined;
      diagnostics.localCandidateType = candidateType(localCandidate?.candidateType);
      diagnostics.remoteCandidateType = candidateType(remoteCandidate?.candidateType);
      diagnostics.candidateType = diagnostics.remoteCandidateType;
      diagnostics.protocol = typeof localCandidate?.protocol === "string"
        ? localCandidate.protocol
        : typeof remoteCandidate?.protocol === "string" ? remoteCandidate.protocol : null;
      diagnostics.relayProtocol = typeof localCandidate?.relayProtocol === "string"
        ? localCandidate.relayProtocol
        : typeof remoteCandidate?.relayProtocol === "string" ? remoteCandidate.relayProtocol : null;
      diagnostics.route = diagnostics.localCandidateType === "relay" || diagnostics.remoteCandidateType === "relay"
        ? "TURN"
        : diagnostics.localCandidateType !== "unknown" || diagnostics.remoteCandidateType !== "unknown" ? "P2P" : "unknown";
    }

    if (videoCodecId) {
      const codec = report.get(videoCodecId) as StatsRecord | undefined;
      diagnostics.codec = typeof codec?.mimeType === "string" ? codec.mimeType : null;
    }

    const now = performance.now();
    const currentSample: StatsSample = {
      at: now,
      bytesSent: diagnostics.bytesSent,
      bytesReceived: diagnostics.bytesReceived,
      videoBytesSent: diagnostics.videoOutbound.bytesSent,
      videoBytesReceived: diagnostics.videoInbound.bytesReceived,
      audioBytesSent: diagnostics.audioOutbound.bytesSent,
      audioBytesReceived: diagnostics.audioInbound.bytesReceived,
    };
    if (this.previousStatsSample) {
      const elapsedMs = now - this.previousStatsSample.at;
      diagnostics.outgoingBitrateKbps = bitrateKbps(currentSample.bytesSent, this.previousStatsSample.bytesSent, elapsedMs);
      diagnostics.incomingBitrateKbps = bitrateKbps(currentSample.bytesReceived, this.previousStatsSample.bytesReceived, elapsedMs);
      diagnostics.videoOutbound.bitrateKbps = bitrateKbps(currentSample.videoBytesSent, this.previousStatsSample.videoBytesSent, elapsedMs);
      diagnostics.videoInbound.bitrateKbps = bitrateKbps(currentSample.videoBytesReceived, this.previousStatsSample.videoBytesReceived, elapsedMs);
      diagnostics.audioOutbound.bitrateKbps = bitrateKbps(currentSample.audioBytesSent, this.previousStatsSample.audioBytesSent, elapsedMs);
      diagnostics.audioInbound.bitrateKbps = bitrateKbps(currentSample.audioBytesReceived, this.previousStatsSample.audioBytesReceived, elapsedMs);
    }
    this.previousStatsSample = currentSample;

    return diagnostics;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.pendingCandidates = [];
    this.candidateKeys.clear();
    this.previousStatsSample = null;
    for (const track of this.remoteStream.getTracks()) {
      track.onended = null;
      track.onmute = null;
      track.onunmute = null;
      this.remoteStream.removeTrack(track);
    }
    this.connection.ontrack = null;
    this.connection.onicecandidate = null;
    this.connection.onconnectionstatechange = null;
    this.connection.oniceconnectionstatechange = null;
    this.connection.onicegatheringstatechange = null;
    this.connection.onsignalingstatechange = null;
    this.connection.close();
    developmentLog("WEBRTC", "peer connection closed");
  }

  private markMilestone(milestone: PeerMilestone) {
    if (this.emittedMilestones.has(milestone)) return;
    this.emittedMilestones.add(milestone);
    this.options.onMilestone(milestone);
  }

  private async configureVideoForRealtime() {
    const sender = this.connection.getSenders().find((item) => item.track?.kind === "video");
    if (sender) await this.configureVideoSender(sender);
  }

  private async configureVideoSender(sender: RTCRtpSender) {
    try {
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) parameters.encodings = [{}];
      parameters.encodings[0].maxBitrate = 1_500_000;
      parameters.encodings[0].maxFramerate = 30;
      parameters.degradationPreference = "maintain-framerate";
      await sender.setParameters(parameters);
      developmentLog("MEDIA", "video sender configured for realtime motion", {
        maxBitrate: parameters.encodings[0].maxBitrate,
        maxFramerate: parameters.encodings[0].maxFramerate,
        degradationPreference: parameters.degradationPreference,
      });
    } catch (error) {
      developmentLog("MEDIA", "browser kept its adaptive video sender defaults", error);
    }
  }

  private async flushCandidates() {
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) {
      await this.connection.addIceCandidate(candidate);
      developmentLog("ICE", "queued remote candidate added");
    }
  }
}
