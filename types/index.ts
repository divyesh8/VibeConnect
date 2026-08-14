export type Gender = "male" | "female" | "other";
export type CommunicationMode = "text" | "voice" | "video";
export type OnlineStatus = "searching" | "confirming" | "connected" | "offline";
export type WebRTCPhase =
  | "idle"
  | "subscribing"
  | "media-preparing"
  | "waiting-for-peer"
  | "signaling"
  | "ice-connecting"
  | "connected"
  | "reconnecting"
  | "failed"
  | "ended";

export interface AnonymousProfile {
  id: string;
  sessionId: string;
  username: string;
  gender: Gender;
  mode: CommunicationMode;
  interests: string[];
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: string;
  seenAt?: string | null;
  status?: "sending" | "sent" | "failed";
}

export interface MatchResult {
  proposal: null | {
    id: string;
    expiresAt: string;
    partner: {
      id: string;
      username: string;
      interests: string[];
    };
  };
}

export interface MatchProposalStatus {
  status: "pending" | "matched" | "declined" | "expired" | "cancelled" | "invalid";
  roomId: string | null;
  partnerAccepted: boolean;
  partner: {
    id: string;
    username: string;
    interests: string[];
  };
}

export interface LiveRoomContext {
  initiator: boolean;
  mode: CommunicationMode;
  status: "connecting" | "active" | "ended";
  partner: {
    id: string;
    username: string;
    interests: string[];
  };
}

export type ReportReason =
  | "harassment"
  | "hate_speech"
  | "sexual_content"
  | "spam"
  | "threats"
  | "underage_concern"
  | "other";

export interface WebRTCDiagnostics {
  signalingState: RTCSignalingState | "unavailable";
  iceGatheringState: RTCIceGatheringState | "unavailable";
  iceConnectionState: RTCIceConnectionState | "unavailable";
  connectionState: RTCPeerConnectionState | "unavailable";
  localAudio: MediaStreamTrackState | "missing";
  localVideo: MediaStreamTrackState | "missing";
  remoteAudio: MediaStreamTrackState | "missing";
  remoteVideo: MediaStreamTrackState | "missing";
  bytesSent: number;
  bytesReceived: number;
  packetsSent: number;
  packetsReceived: number;
  framesEncoded: number;
  framesDecoded: number;
  candidateType: "host" | "srflx" | "prflx" | "relay" | "unknown";
  localCandidateType: "host" | "srflx" | "prflx" | "relay" | "unknown";
  remoteCandidateType: "host" | "srflx" | "prflx" | "relay" | "unknown";
  route: "P2P" | "TURN" | "unknown";
  protocol: string | null;
  relayProtocol: string | null;
  rttMs: number | null;
  availableOutgoingBitrateKbps: number | null;
  outgoingBitrateKbps: number | null;
  incomingBitrateKbps: number | null;
  packetsLost: number;
  packetLossPercent: number | null;
  jitterMs: number | null;
  jitterBufferMs: number | null;
  codec: string | null;
  videoOutbound: {
    bytesSent: number;
    packetsSent: number;
    framesEncoded: number;
    framesSent: number;
    framesPerSecond: number | null;
    frameWidth: number | null;
    frameHeight: number | null;
    bitrateKbps: number | null;
    qualityLimitationReason: string | null;
  };
  videoInbound: {
    bytesReceived: number;
    packetsReceived: number;
    packetsLost: number;
    framesReceived: number;
    framesDecoded: number;
    framesDropped: number;
    framesPerSecond: number | null;
    frameWidth: number | null;
    frameHeight: number | null;
    bitrateKbps: number | null;
    jitterMs: number | null;
    jitterBufferMs: number | null;
  };
  audioOutbound: {
    bytesSent: number;
    packetsSent: number;
    bitrateKbps: number | null;
  };
  audioInbound: {
    bytesReceived: number;
    packetsReceived: number;
    packetsLost: number;
    bitrateKbps: number | null;
    jitterMs: number | null;
    jitterBufferMs: number | null;
  };
}

export type WebRTCTimeline = Partial<Record<
  | "matched"
  | "localMediaReady"
  | "signalingSubscribed"
  | "offerSent"
  | "offerReceived"
  | "answerSent"
  | "answerReceived"
  | "firstLocalIce"
  | "firstRemoteIce"
  | "iceConnected"
  | "peerConnected"
  | "firstRemoteAudioTrack"
  | "firstRemoteVideoTrack"
  | "firstInboundVideoPacket"
  | "firstDecodedVideoFrame"
  | "firstRemoteVideoFrame",
  number
>>;
