import type { WebRTCDiagnostics } from "@/types";

export type PeerSignal =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice-candidate"; candidate: RTCIceCandidateInit };

type PeerManagerOptions = {
  iceServers: RTCIceServer[];
  forceRelay: boolean;
  emitSignal: (signal: PeerSignal) => Promise<void>;
  onRemoteStream: (stream: MediaStream) => void;
  onStateChange: () => void;
  onError: (message: string, error: unknown) => void;
};

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

export class PeerManager {
  readonly connection: RTCPeerConnection;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private candidateKeys = new Set<string>();
  private remoteStream = new MediaStream();
  private makingOffer = false;
  private closed = false;

  constructor(private readonly options: PeerManagerOptions) {
    this.connection = new RTCPeerConnection({
      iceServers: options.iceServers,
      iceCandidatePoolSize: 8,
      iceTransportPolicy: options.forceRelay ? "relay" : "all",
    });

    developmentLog("WEBRTC", `peer connection created (${options.forceRelay ? "relay-only" : "all candidates"})`);

    this.connection.onicecandidate = (event) => {
      if (!event.candidate || this.closed) return;
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
      this.options.onStateChange();
    };
    this.connection.oniceconnectionstatechange = () => {
      developmentLog("ICE", `iceConnectionState=${this.connection.iceConnectionState}`);
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

  addLocalStream(stream: MediaStream) {
    if (this.closed) throw new Error("The peer connection is already closed.");
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.some((track) => track.readyState === "live")) throw new Error("A live microphone track is required before creating the peer connection.");
    for (const track of stream.getTracks()) {
      developmentLog("MEDIA", `local ${track.kind} track`, {
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
      });
      this.connection.addTrack(track, stream);
    }
    const senderKinds = this.connection.getSenders().map((sender) => sender.track?.kind ?? "missing");
    if (!senderKinds.includes("audio")) throw new Error("The microphone track was not added to the peer connection.");
    developmentLog("WEBRTC", "local senders ready", senderKinds);
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
      developmentLog("SIGNAL", "OFFER SENT");
      return true;
    } finally {
      this.makingOffer = false;
    }
  }

  async acceptOffer(sdp: RTCSessionDescriptionInit) {
    if (this.closed) return;
    if (
      this.connection.remoteDescription?.type === "offer"
      && this.connection.remoteDescription.sdp === sdp.sdp
      && this.connection.localDescription?.type === "answer"
    ) {
      await this.options.emitSignal({ kind: "answer", sdp: descriptionInit(this.connection.localDescription) });
      return;
    }
    developmentLog("SIGNAL", "OFFER RECEIVED", { type: sdp.type, sdpLength: sdp.sdp?.length ?? 0 });
    await this.connection.setRemoteDescription(sdp);
    await this.flushCandidates();
    const answer = await this.connection.createAnswer();
    developmentLog("SIGNAL", "ANSWER CREATED", { type: answer.type, sdpLength: answer.sdp?.length ?? 0 });
    await this.connection.setLocalDescription(answer);
    await this.options.emitSignal({ kind: "answer", sdp: descriptionInit(this.connection.localDescription) });
    developmentLog("SIGNAL", "ANSWER SENT");
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

  toggleCamera(enabled: boolean) {
    for (const sender of this.connection.getSenders()) {
      if (sender.track?.kind === "video") sender.track.enabled = enabled;
    }
  }

  async getDiagnostics(localStream: MediaStream | null): Promise<WebRTCDiagnostics> {
    const diagnostics: WebRTCDiagnostics = {
      signalingState: this.connection.signalingState,
      iceGatheringState: this.connection.iceGatheringState,
      iceConnectionState: this.connection.iceConnectionState,
      connectionState: this.connection.connectionState,
      localAudio: trackState(localStream, "audio"),
      localVideo: trackState(localStream, "video"),
      remoteAudio: trackState(this.remoteStream, "audio"),
      remoteVideo: trackState(this.remoteStream, "video"),
      bytesSent: 0,
      bytesReceived: 0,
      packetsSent: 0,
      packetsReceived: 0,
      framesEncoded: 0,
      framesDecoded: 0,
      candidateType: "unknown",
    };

    const report = await this.connection.getStats();
    let selectedRemoteCandidateId: string | null = null;
    report.forEach((raw) => {
      const stat = raw as RTCStats & Record<string, unknown>;
      if (stat.type === "outbound-rtp" && stat.isRemote !== true) {
        diagnostics.bytesSent += Number(stat.bytesSent ?? 0);
        diagnostics.packetsSent += Number(stat.packetsSent ?? 0);
        diagnostics.framesEncoded += Number(stat.framesEncoded ?? 0);
      }
      if (stat.type === "inbound-rtp" && stat.isRemote !== true) {
        diagnostics.bytesReceived += Number(stat.bytesReceived ?? 0);
        diagnostics.packetsReceived += Number(stat.packetsReceived ?? 0);
        diagnostics.framesDecoded += Number(stat.framesDecoded ?? 0);
      }
      if (stat.type === "candidate-pair" && (stat.selected === true || stat.nominated === true) && stat.state === "succeeded") {
        selectedRemoteCandidateId = typeof stat.remoteCandidateId === "string" ? stat.remoteCandidateId : null;
      }
    });
    if (selectedRemoteCandidateId) {
      const candidate = report.get(selectedRemoteCandidateId) as (RTCStats & Record<string, unknown>) | undefined;
      const candidateType = candidate?.candidateType;
      if (["host", "srflx", "prflx", "relay"].includes(String(candidateType))) {
        diagnostics.candidateType = candidateType as WebRTCDiagnostics["candidateType"];
      }
    }
    return diagnostics;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.pendingCandidates = [];
    this.candidateKeys.clear();
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

  private async flushCandidates() {
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) {
      await this.connection.addIceCandidate(candidate);
      developmentLog("ICE", "queued remote candidate added");
    }
  }
}
