"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { leaveRoomChannel, sendSignal, subscribeToRoom, type SignalPayload } from "@/services/realtime";
import type { CommunicationMode, WebRTCDiagnostics, WebRTCPhase } from "@/types";
import { PeerManager, type PeerSignal } from "@/webrtc/peer-manager";

type IceServerResponse = { iceServers?: RTCIceServer[]; forceRelay?: boolean; error?: string };

type UseWebRTCOptions = {
  enabled: boolean;
  mode: CommunicationMode;
  roomId: string;
  userId: string;
  initiator: boolean;
  onPeerEnded?: (reason: "skip" | "call-ended" | "peer-disconnected") => void;
};

const CONNECTION_TIMEOUT_MS = 20_000;
const DISCONNECT_GRACE_MS = 5_000;

function mediaErrorMessage(error: unknown, mode: CommunicationMode) {
  if (!(error instanceof DOMException)) return error instanceof Error ? error.message : "We could not start your camera or microphone.";
  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return mode === "video"
      ? "Camera or microphone permission is blocked. Enable both in your browser and try again."
      : "Microphone permission is blocked. Enable it in your browser and try again.";
  }
  if (error.name === "NotFoundError") return mode === "video" ? "No working camera or microphone was found." : "No working microphone was found.";
  if (error.name === "NotReadableError") return "Your camera or microphone is already in use by another app.";
  if (error.name === "OverconstrainedError") return "This device cannot provide the requested camera settings.";
  if (error.name === "AbortError") return "Media setup was interrupted. Please try again.";
  return "We could not start your camera or microphone.";
}

function signalEnvelope(
  roomId: string,
  senderId: string,
  signal: PeerSignal | { kind: "peer-ready"; mediaReady: boolean } | { kind: "restart-request" } | { kind: "skip" | "call-ended" | "peer-disconnected" },
): SignalPayload {
  return {
    ...signal,
    roomId,
    senderId,
    timestamp: Date.now(),
    nonce: crypto.randomUUID(),
  } as SignalPayload;
}

export function useWebRTC({ enabled, mode, roomId, userId, initiator, onPeerEnded }: UseWebRTCOptions) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(mode === "video");
  const [phase, setPhase] = useState<WebRTCPhase>(enabled ? "subscribing" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<WebRTCDiagnostics | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<PeerManager | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const signalingPromiseRef = useRef<Promise<RealtimeChannel | null> | null>(null);
  const phaseRef = useRef<WebRTCPhase>(phase);
  const mediaReadyRef = useRef(false);
  const remoteReadyRef = useRef(false);
  const offerStartedRef = useRef(false);
  const connectedPostedRef = useRef(false);
  const restartAttemptsRef = useRef(0);
  const pendingBeforePeerRef = useRef<RTCIceCandidateInit[]>([]);
  const seenNoncesRef = useRef(new Set<string>());
  const readyTimerRef = useRef<number | null>(null);
  const connectionTimerRef = useRef<number | null>(null);
  const disconnectTimerRef = useRef<number | null>(null);
  const statsTimerRef = useRef<number | null>(null);
  const onPeerEndedRef = useRef(onPeerEnded);
  const handleSignalRef = useRef<(signal: SignalPayload) => Promise<void>>(async () => undefined);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    onPeerEndedRef.current = onPeerEnded;
  }, [onPeerEnded]);

  const clearTimer = useCallback((timerRef: React.MutableRefObject<number | null>) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const send = useCallback(async (
    signal: PeerSignal | { kind: "peer-ready"; mediaReady: boolean } | { kind: "restart-request" } | { kind: "skip" | "call-ended" | "peer-disconnected" },
  ) => {
    await sendSignal(channelRef.current, signalEnvelope(roomId, userId, signal));
  }, [roomId, userId]);

  const refreshDiagnostics = useCallback(async () => {
    const peer = peerRef.current;
    if (!peer) return;
    try {
      setDiagnostics(await peer.getDiagnostics(streamRef.current));
    } catch (statsError) {
      if (process.env.NODE_ENV === "development") console.warn("[WEBRTC] getStats failed", statsError);
    }
  }, []);

  const startConnectionTimeout = useCallback(() => {
    clearTimer(connectionTimerRef);
    connectionTimerRef.current = window.setTimeout(() => {
      if (peerRef.current?.connection.connectionState === "connected") return;
      setPhase("failed");
      setError("We couldn't establish the call. Check your network or try another person.");
    }, CONNECTION_TIMEOUT_MS);
  }, [clearTimer]);

  const attemptIceRestart = useCallback(async () => {
    const peer = peerRef.current;
    if (!peer || restartAttemptsRef.current >= 2) {
      setPhase("failed");
      setError("We couldn't restore the call. Try finding someone else.");
      return;
    }
    restartAttemptsRef.current += 1;
    setError(null);
    setPhase("reconnecting");
    startConnectionTimeout();
    try {
      if (initiator) await peer.restartIce();
      else await send({ kind: "restart-request" });
    } catch (restartError) {
      console.error("[WEBRTC] ICE restart failed", restartError);
      setPhase("failed");
      setError("We couldn't restore the call. Try finding someone else.");
    }
  }, [initiator, send, startConnectionTimeout]);

  const syncConnectionState = useCallback(() => {
    const connection = peerRef.current?.connection;
    if (!connection) return;
    void refreshDiagnostics();
    if (connection.connectionState === "connected") {
      clearTimer(connectionTimerRef);
      clearTimer(disconnectTimerRef);
      clearTimer(readyTimerRef);
      restartAttemptsRef.current = 0;
      setError(null);
      setPhase("connected");
      if (!connectedPostedRef.current) {
        connectedPostedRef.current = true;
        void fetch("/api/rooms/connected", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId }),
        }).catch((postError) => console.error("[ROOM] could not mark media connected", postError));
      }
      return;
    }
    if (connection.connectionState === "connecting" || connection.iceConnectionState === "checking") {
      if (phaseRef.current !== "reconnecting") setPhase("ice-connecting");
    }
    if (connection.connectionState === "failed" || connection.iceConnectionState === "failed") {
      void attemptIceRestart();
      return;
    }
    if (connection.connectionState === "disconnected" && !disconnectTimerRef.current) {
      disconnectTimerRef.current = window.setTimeout(() => {
        disconnectTimerRef.current = null;
        if (peerRef.current?.connection.connectionState === "disconnected") void attemptIceRestart();
      }, DISCONNECT_GRACE_MS);
    }
  }, [attemptIceRestart, clearTimer, refreshDiagnostics, roomId]);

  const createPeer = useCallback((iceServers: RTCIceServer[], forceRelay: boolean) => {
    if (peerRef.current) return peerRef.current;
    const peer = new PeerManager({
      iceServers,
      forceRelay,
      emitSignal: send,
      onRemoteStream: (stream) => setRemoteStream(new MediaStream(stream.getTracks())),
      onStateChange: syncConnectionState,
      onError: (message, signalError) => {
        console.error("[WEBRTC]", message, signalError);
        setError(message);
      },
    });
    peerRef.current = peer;
    return peer;
  }, [send, syncConnectionState]);

  const maybeCreateOffer = useCallback(async () => {
    if (!initiator || !mediaReadyRef.current || !remoteReadyRef.current || offerStartedRef.current || !peerRef.current) return;
    offerStartedRef.current = true;
    setPhase("signaling");
    try {
      const started = await peerRef.current.createOffer();
      if (started) startConnectionTimeout();
      else offerStartedRef.current = false;
    } catch (offerError) {
      offerStartedRef.current = false;
      console.error("[SIGNAL] offer creation failed", offerError);
      setError("The secure call setup failed before an offer could be sent.");
      setPhase("failed");
    }
  }, [initiator, startConnectionTimeout]);

  const cleanupConnection = useCallback(async (leaveChannel: boolean, updateState = true) => {
    clearTimer(readyTimerRef);
    clearTimer(connectionTimerRef);
    clearTimer(disconnectTimerRef);
    if (statsTimerRef.current) window.clearInterval(statsTimerRef.current);
    statsTimerRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    mediaReadyRef.current = false;
    remoteReadyRef.current = false;
    offerStartedRef.current = false;
    connectedPostedRef.current = false;
    restartAttemptsRef.current = 0;
    pendingBeforePeerRef.current = [];
    seenNoncesRef.current.clear();
    if (leaveChannel) {
      const channel = channelRef.current;
      channelRef.current = null;
      signalingPromiseRef.current = null;
      await leaveRoomChannel(channel).catch(() => undefined);
    }
    if (updateState) {
      setLocalStream(null);
      setRemoteStream(null);
      setDiagnostics(null);
    }
  }, [clearTimer]);

  handleSignalRef.current = async (signal) => {
    if (signal.roomId !== roomId || signal.senderId === userId) return;
    if (Math.abs(Date.now() - signal.timestamp) > 2 * 60_000 || seenNoncesRef.current.has(signal.nonce)) return;
    seenNoncesRef.current.add(signal.nonce);
    if (seenNoncesRef.current.size > 512) seenNoncesRef.current.clear();

    try {
      if (signal.kind === "peer-ready") {
        if (signal.mediaReady) {
          remoteReadyRef.current = true;
          if (mediaReadyRef.current && phaseRef.current === "waiting-for-peer") setPhase("signaling");
          await maybeCreateOffer();
        }
        return;
      }
      if (signal.kind === "ice-candidate") {
        if (peerRef.current) await peerRef.current.addRemoteIceCandidate(signal.candidate);
        else pendingBeforePeerRef.current.push(signal.candidate);
        return;
      }
      if (signal.kind === "offer") {
        if (initiator || !peerRef.current || !mediaReadyRef.current) return;
        setPhase("signaling");
        startConnectionTimeout();
        await peerRef.current.acceptOffer(signal.sdp);
        setPhase("ice-connecting");
        return;
      }
      if (signal.kind === "answer") {
        if (!initiator || !peerRef.current) return;
        await peerRef.current.acceptAnswer(signal.sdp);
        setPhase("ice-connecting");
        return;
      }
      if (signal.kind === "restart-request" && initiator && peerRef.current) {
        setPhase("reconnecting");
        startConnectionTimeout();
        await peerRef.current.restartIce();
        return;
      }
      if (signal.kind === "skip" || signal.kind === "call-ended" || signal.kind === "peer-disconnected") {
        await cleanupConnection(true);
        setPhase("ended");
        onPeerEndedRef.current?.(signal.kind);
      }
    } catch (signalError) {
      console.error(`[SIGNAL] ${signal.kind} handling failed`, signalError);
      setError("The secure signaling exchange failed. Please retry the call.");
      setPhase("failed");
    }
  };

  useEffect(() => {
    if (!enabled || mode === "text" || !roomId || !userId) {
      queueMicrotask(() => setPhase("idle"));
      return;
    }
    let active = true;
    queueMicrotask(() => setPhase("subscribing"));
    const subscription = subscribeToRoom(roomId, {
      onSignal: (signal) => void handleSignalRef.current(signal),
    });
    signalingPromiseRef.current = subscription;
    void subscription
      .then((channel) => {
        if (!active) {
          void leaveRoomChannel(channel);
          return;
        }
        channelRef.current = channel;
        setPhase("idle");
        return send({ kind: "peer-ready", mediaReady: false });
      })
      .catch((subscriptionError) => {
        console.error("[SIGNAL] private room subscription failed", subscriptionError);
        if (active) {
          setError("The private signaling channel could not be opened. Verify Supabase Realtime room policies.");
          setPhase("failed");
        }
      });

    return () => {
      active = false;
      void cleanupConnection(true, false);
    };
  }, [cleanupConnection, enabled, mode, roomId, send, userId]);

  const startMedia = useCallback(async () => {
    if (!enabled || mode === "text" || mediaReadyRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not support live camera or microphone access.");
      setPhase("failed");
      return;
    }
    setError(null);
    setPhase("media-preparing");
    let acquiredStream: MediaStream | null = null;
    try {
      const signalingChannel = await signalingPromiseRef.current;
      if (!signalingChannel || !channelRef.current) throw new Error("The private signaling channel is not ready yet. Try again in a moment.");
      const [stream, iceResponse] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: mode === "video" ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } : false,
        }),
        fetch(`/api/webrtc/ice-servers?roomId=${encodeURIComponent(roomId)}`, { cache: "no-store" }),
      ]);
      acquiredStream = stream;
      const iceData = await iceResponse.json() as IceServerResponse;
      if (!iceResponse.ok || !iceData.iceServers?.length) throw new Error(iceData.error ?? "WebRTC network configuration is unavailable.");
      const audioTrack = stream.getAudioTracks()[0];
      const videoTrack = stream.getVideoTracks()[0];
      if (!audioTrack || audioTrack.readyState !== "live") throw new Error("A live microphone track was not created.");
      if (mode === "video" && (!videoTrack || videoTrack.readyState !== "live")) throw new Error("A live camera track was not created.");

      streamRef.current = stream;
      setLocalStream(stream);
      setMicEnabled(true);
      setCameraEnabled(mode === "video");
      const peer = createPeer(iceData.iceServers, Boolean(iceData.forceRelay));
      peer.addLocalStream(stream);
      for (const candidate of pendingBeforePeerRef.current) await peer.addRemoteIceCandidate(candidate);
      pendingBeforePeerRef.current = [];
      mediaReadyRef.current = true;
      setPhase(remoteReadyRef.current ? "signaling" : "waiting-for-peer");
      await send({ kind: "peer-ready", mediaReady: true });
      readyTimerRef.current = window.setInterval(() => {
        if (phaseRef.current !== "connected" && phaseRef.current !== "ended") {
          void send({ kind: "peer-ready", mediaReady: true }).catch((readyError) => console.warn("[SIGNAL] ready heartbeat failed", readyError));
        }
      }, 1_500);
      statsTimerRef.current = window.setInterval(() => void refreshDiagnostics(), 1_000);
      await maybeCreateOffer();
    } catch (mediaError) {
      acquiredStream?.getTracks().forEach((track) => track.stop());
      console.error("[MEDIA] setup failed", mediaError);
      setError(mediaErrorMessage(mediaError, mode));
      setPhase("failed");
    }
  }, [createPeer, enabled, maybeCreateOffer, mode, refreshDiagnostics, roomId, send]);

  const toggleMic = useCallback(() => {
    setMicEnabled((currentlyEnabled) => {
      const enabledNext = !currentlyEnabled;
      streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = enabledNext; });
      peerRef.current?.toggleMicrophone(enabledNext);
      return enabledNext;
    });
  }, []);

  const toggleCamera = useCallback(() => {
    setCameraEnabled((currentlyEnabled) => {
      const enabledNext = !currentlyEnabled;
      streamRef.current?.getVideoTracks().forEach((track) => { track.enabled = enabledNext; });
      peerRef.current?.toggleCamera(enabledNext);
      return enabledNext;
    });
  }, []);

  const switchCamera = useCallback(async () => {
    const currentTrack = streamRef.current?.getVideoTracks()[0];
    if (!currentTrack) return;
    const facing = currentTrack.getSettings().facingMode === "environment" ? "user" : "environment";
    try {
      const replacement = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: facing } }, audio: false });
      const nextTrack = replacement.getVideoTracks()[0];
      const sender = peerRef.current?.connection.getSenders().find((item) => item.track?.kind === "video");
      await sender?.replaceTrack(nextTrack);
      currentTrack.stop();
      streamRef.current?.removeTrack(currentTrack);
      streamRef.current?.addTrack(nextTrack);
      setLocalStream(new MediaStream(streamRef.current?.getTracks() ?? []));
    } catch (switchError) {
      console.error("[MEDIA] camera switch failed", switchError);
      setError("The other camera is not available on this device.");
    }
  }, []);

  const retryConnection = useCallback(async () => {
    if (!peerRef.current || !mediaReadyRef.current) {
      await startMedia();
      return;
    }
    restartAttemptsRef.current = 0;
    await attemptIceRestart();
  }, [attemptIceRestart, startMedia]);

  const endConnection = useCallback(async (reason: "skip" | "call-ended" | "peer-disconnected") => {
    if (channelRef.current) await send({ kind: reason }).catch(() => undefined);
    await cleanupConnection(true);
    setPhase("ended");
  }, [cleanupConnection, send]);

  const statusMessage: Record<WebRTCPhase, string> = {
    idle: "Ready to start",
    subscribing: "Opening private room...",
    "media-preparing": mode === "video" ? "Preparing camera..." : "Preparing microphone...",
    "waiting-for-peer": "Waiting for the other person...",
    signaling: "Securing connection...",
    "ice-connecting": "Connecting...",
    connected: "Connected",
    reconnecting: "Restoring connection...",
    failed: "Call not connected",
    ended: "Call ended",
  };

  return {
    localStream,
    remoteStream,
    micEnabled,
    cameraEnabled,
    phase,
    statusMessage: statusMessage[phase],
    error,
    diagnostics,
    startMedia,
    retryConnection,
    endConnection,
    toggleMic,
    toggleCamera,
    switchCamera,
  };
}
