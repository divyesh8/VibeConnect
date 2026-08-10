export type PeerSignal =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

export class PeerManager {
  readonly connection: RTCPeerConnection;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(
    private readonly emitSignal: (signal: PeerSignal) => void,
    onRemoteStream: (stream: MediaStream) => void,
  ) {
    this.connection = new RTCPeerConnection({
      iceServers: DEFAULT_ICE_SERVERS,
      iceCandidatePoolSize: 8,
    });
    this.connection.onicecandidate = (event) => {
      if (event.candidate) this.emitSignal({ kind: "ice", candidate: event.candidate.toJSON() });
    };
    this.connection.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      onRemoteStream(stream);
    };
  }

  addLocalStream(stream: MediaStream) {
    stream.getTracks().forEach((track) => this.connection.addTrack(track, stream));
  }

  async createOffer() {
    const offer = await this.connection.createOffer();
    await this.connection.setLocalDescription(offer);
    this.emitSignal({ kind: "offer", sdp: offer });
  }

  async acceptOffer(sdp: RTCSessionDescriptionInit) {
    await this.connection.setRemoteDescription(sdp);
    await this.flushCandidates();
    const answer = await this.connection.createAnswer();
    await this.connection.setLocalDescription(answer);
    this.emitSignal({ kind: "answer", sdp: answer });
  }

  async acceptAnswer(sdp: RTCSessionDescriptionInit) {
    await this.connection.setRemoteDescription(sdp);
    await this.flushCandidates();
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.connection.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }
    await this.connection.addIceCandidate(candidate);
  }

  close() {
    this.connection.ontrack = null;
    this.connection.onicecandidate = null;
    this.connection.close();
  }

  private async flushCandidates() {
    await Promise.all(this.pendingCandidates.map((candidate) => this.connection.addIceCandidate(candidate)));
    this.pendingCandidates = [];
  }
}
