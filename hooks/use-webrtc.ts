"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { leaveRoomChannel, sendSignal, subscribeToRoom, type SignalPayload } from "@/services/realtime";
import type { CommunicationMode, WebRTCDiagnostics, WebRTCPhase, WebRTCTimeline } from "@/types";
import { PeerManager, type PeerMilestone, type PeerSignal } from "@/webrtc/peer-manager";

type IceServerResponse = { iceServers?: RTCIceServer[]; forceRelay?: boolean; turnConfigured?: boolean; error?: string };
type MediaStatus = "idle" | "requesting" | "ready" | "error";
type MediaPermissionStatus = "unknown" | "granted" | "denied";
type SignalProgress = "not-sent" | "sent" | "received";
type SignalDiagnostics = {
  peerReady: SignalProgress;
  offer: SignalProgress;
  answer: SignalProgress;
  localIce: number;
  remoteIce: number;
};

const EMPTY_SIGNAL_DIAGNOSTICS: SignalDiagnostics = {
  peerReady: "not-sent",
  offer: "not-sent",
  answer: "not-sent",
  localIce: 0,
  remoteIce: 0,
};

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
const DIAGNOSTICS_ENABLED = process.env.NODE_ENV === "development";

const PEER_MILESTONES: Record<PeerMilestone, keyof WebRTCTimeline> = {
  "first-local-ice": "firstLocalIce",
  "ice-connected": "iceConnected",
  "peer-connected": "peerConnected",
  "first-remote-audio-track": "firstRemoteAudioTrack",
  "first-remote-video-track": "firstRemoteVideoTrack",
  "first-inbound-video-packet": "firstInboundVideoPacket",
  "first-decoded-video-frame": "firstDecodedVideoFrame",
};

function mediaErrorMessage(error: unknown, mode: CommunicationMode) {
  if (!(error instanceof DOMException)) return error instanceof Error ? error.message : "We could not start your camera or microphone.";
  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return mode === "video"
      ? "Camera or microphone permission was denied. Allow both in your browser site settings, then try again."
      : "Microphone permission was denied. Allow it in your browser site settings, then try again.";
  }
  if (error.name === "NotFoundError") return mode === "video" ? "No working camera or microphone was found." : "No working microphone was found.";
  if (error.name === "NotReadableError") return "Your camera or microphone is already in use by another app.";
  if (error.name === "OverconstrainedError") return "This device cannot provide the requested camera settings.";
  if (error.name === "AbortError") return "Media setup was interrupted. Please try again.";
  return "We could not start your camera or microphone.";
}

async function requestLocalMedia(mode: CommunicationMode) {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: mode === "video" ? {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 24, max: 30 },
      facingMode: "user",
    } : false,
  });
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
  const [phase, setPhase] = useState<WebRTCPhase>(enabled ? "subscribing" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<WebRTCDiagnostics | null>(null);
  const [mediaStatus, setMediaStatus] = useState<MediaStatus>("idle");
  const [mediaPermission, setMediaPermission] = useState<MediaPermissionStatus>("unknown");
  const [realtimeStatus, setRealtimeStatus] = useState<"IDLE" | "CONNECTING" | "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR">("IDLE");
  const [signalDiagnostics, setSignalDiagnostics] = useState<SignalDiagnostics>(EMPTY_SIGNAL_DIAGNOSTICS);
  const [timeline, setTimeline] = useState<WebRTCTimeline>({});

  const streamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<PeerManager | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const signalingPromiseRef = useRef<Promise<RealtimeChannel | null> | null>(null);
  const phaseRef = useRef<WebRTCPhase>(phase);
  const mediaReadyRef = useRef(false);
  const remoteReadyRef = useRef(false);
  const offerStartedRef = useRef(false);
  const connectedPostedRef = useRef(false);
  const turnConfiguredRef = useRef(false);
  const restartAttemptsRef = useRef(0);
  const pendingBeforePeerRef = useRef<RTCIceCandidateInit[]>([]);
  const seenNoncesRef = useRef(new Set<string>());
  const readyTimerRef = useRef<number | null>(null);
  const connectionTimerRef = useRef<number | null>(null);
  const disconnectTimerRef = useRef<number | null>(null);
  const statsTimerRef = useRef<number | null>(null);
  const statsRefreshInFlightRef = useRef(false);
  const statsGenerationRef = useRef(0);
  const mediaStartTokenRef = useRef<symbol | null>(null);
  const lifecycleRef = useRef(0);
  const signalQueueRef = useRef<Promise<void>>(Promise.resolve());
  const timelineOriginRef = useRef<number | null>(null);
  const timelineRef = useRef<WebRTCTimeline>({});
  const onPeerEndedRef = useRef(onPeerEnded);

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

  const resetTimeline = useCallback(() => {
    timelineOriginRef.current = performance.now();
    timelineRef.current = { matched: 0 };
    queueMicrotask(() => setTimeline({ matched: 0 }));
  }, []);

  const markTimeline = useCallback((milestone: keyof WebRTCTimeline) => {
    if (timelineRef.current[milestone] !== undefined) return;
    if (timelineOriginRef.current === null) timelineOriginRef.current = performance.now();
    const elapsed = Math.round(performance.now() - timelineOriginRef.current);
    const next = { ...timelineRef.current, [milestone]: elapsed };
    timelineRef.current = next;
    setTimeline(next);
    if (process.env.NODE_ENV === "development") console.info(`[TIMING] ${milestone}: ${elapsed} ms`);
  }, []);

  const send = useCallback(async (
    signal: PeerSignal | { kind: "peer-ready"; mediaReady: boolean } | { kind: "restart-request" } | { kind: "skip" | "call-ended" | "peer-disconnected" },
  ) => {
    await sendSignal(channelRef.current, signalEnvelope(roomId, userId, signal));
    if (signal.kind === "peer-ready") {
      console.info("[SIGNAL] peer-ready sent", { mediaReady: signal.mediaReady });
      setSignalDiagnostics((current) => ({ ...current, peerReady: "sent" }));
    }
    if (signal.kind === "offer") {
      markTimeline("offerSent");
      setSignalDiagnostics((current) => ({ ...current, offer: "sent" }));
    }
    if (signal.kind === "answer") {
      markTimeline("answerSent");
      setSignalDiagnostics((current) => ({ ...current, answer: "sent" }));
    }
    if (signal.kind === "ice-candidate") setSignalDiagnostics((current) => ({ ...current, localIce: current.localIce + 1 }));
  }, [markTimeline, roomId, userId]);

  const refreshDiagnostics = useCallback(async () => {
    const peer = peerRef.current;
    if (!peer || statsRefreshInFlightRef.current) return;
    const generation = statsGenerationRef.current;
    statsRefreshInFlightRef.current = true;
    try {
      const nextDiagnostics = await peer.getDiagnostics(streamRef.current);
      if (generation === statsGenerationRef.current && peerRef.current === peer) setDiagnostics(nextDiagnostics);
    } catch (statsError) {
      if (process.env.NODE_ENV === "development") console.warn("[WEBRTC] getStats failed", statsError);
    } finally {
      if (generation === statsGenerationRef.current) statsRefreshInFlightRef.current = false;
    }
  }, []);

  const startConnectionTimeout = useCallback(() => {
    clearTimer(connectionTimerRef);
    connectionTimerRef.current = window.setTimeout(() => {
      if (peerRef.current?.connection.connectionState === "connected") return;
      setPhase("failed");
      setError(turnConfiguredRef.current
        ? "We couldn't establish the call. Check your network or try another person."
        : "This deployment has no TURN relay configured, so calls between mobile and Wi-Fi networks may not connect. Configure TURN and try again.");
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
    if (DIAGNOSTICS_ENABLED) void refreshDiagnostics();
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
      onRemoteStream: setRemoteStream,
      onStateChange: syncConnectionState,
      onMilestone: (milestone) => markTimeline(PEER_MILESTONES[milestone]),
      onError: (message, signalError) => {
        console.error("[WEBRTC]", message, signalError);
        setError(message);
      },
    });
    peerRef.current = peer;
    return peer;
  }, [markTimeline, send, syncConnectionState]);

  const maybeCreateOffer = useCallback(async () => {
    if (!initiator || !mediaReadyRef.current || !remoteReadyRef.current || offerStartedRef.current || !peerRef.current) return;
    offerStartedRef.current = true;
    setPhase("signaling");
    try {
      const started = await peerRef.current.createOffer();
      if (started) startConnectionTimeout();
      else offerStartedRef.current = false;
    } catch (offerError) {
      offerStartedRef.current = peerRef.current?.connection.localDescription?.type === "offer";
      console.error("[SIGNAL] offer creation failed", offerError);
      setError("The secure call setup failed before an offer could be sent.");
      setPhase("failed");
    }
  }, [initiator, startConnectionTimeout]);

  const cleanupConnection = useCallback(async (leaveChannel: boolean, updateState = true) => {
    lifecycleRef.current += 1;
    clearTimer(readyTimerRef);
    clearTimer(connectionTimerRef);
    clearTimer(disconnectTimerRef);
    if (statsTimerRef.current) window.clearInterval(statsTimerRef.current);
    statsTimerRef.current = null;
    statsGenerationRef.current += 1;
    statsRefreshInFlightRef.current = false;
    mediaStartTokenRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    mediaReadyRef.current = false;
    remoteReadyRef.current = false;
    offerStartedRef.current = false;
    connectedPostedRef.current = false;
    turnConfiguredRef.current = false;
    restartAttemptsRef.current = 0;
    pendingBeforePeerRef.current = [];
    seenNoncesRef.current.clear();
    signalQueueRef.current = Promise.resolve();
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
      setMicEnabled(true);
      setMediaStatus("idle");
      setMediaPermission("unknown");
      setRealtimeStatus("IDLE");
      setSignalDiagnostics(EMPTY_SIGNAL_DIAGNOSTICS);
    }
  }, [clearTimer]);

  const handleSignal = useCallback(async (signal: SignalPayload) => {
    if (signal.roomId !== roomId || signal.senderId === userId) return;
    if (Math.abs(Date.now() - signal.timestamp) > 2 * 60_000 || seenNoncesRef.current.has(signal.nonce)) return;
    seenNoncesRef.current.add(signal.nonce);
    if (seenNoncesRef.current.size > 512) seenNoncesRef.current.clear();

    try {
      if (signal.kind === "peer-ready") {
        console.info("[SIGNAL] peer-ready received", { mediaReady: signal.mediaReady });
        setSignalDiagnostics((current) => ({ ...current, peerReady: "received" }));
        if (signal.mediaReady) {
          remoteReadyRef.current = true;
          if (mediaReadyRef.current && phaseRef.current === "waiting-for-peer") setPhase("signaling");
          const recoveredPendingOffer = initiator && offerStartedRef.current
            ? await peerRef.current?.resendPendingOffer() ?? false
            : false;
          if (!recoveredPendingOffer) await maybeCreateOffer();
        }
        return;
      }
      if (signal.kind === "ice-candidate") {
        markTimeline("firstRemoteIce");
        setSignalDiagnostics((current) => ({ ...current, remoteIce: current.remoteIce + 1 }));
        if (peerRef.current) await peerRef.current.addRemoteIceCandidate(signal.candidate);
        else pendingBeforePeerRef.current.push(signal.candidate);
        return;
      }
      if (signal.kind === "offer") {
        markTimeline("offerReceived");
        setSignalDiagnostics((current) => ({ ...current, offer: "received" }));
        if (initiator || !peerRef.current || !mediaReadyRef.current) return;
        setPhase("signaling");
        startConnectionTimeout();
        await peerRef.current.acceptOffer(signal.sdp);
        setPhase("ice-connecting");
        return;
      }
      if (signal.kind === "answer") {
        markTimeline("answerReceived");
        setSignalDiagnostics((current) => ({ ...current, answer: "received" }));
        if (!initiator || !peerRef.current) return;
        offerStartedRef.current = true;
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
        if (process.env.NODE_ENV === "development") console.info("[WEBRTC] Partner disconnected:", signal.kind);
        await cleanupConnection(true);
        setPhase("ended");
        onPeerEndedRef.current?.(signal.kind);
      }
    } catch (signalError) {
      console.error(`[SIGNAL] ${signal.kind} handling failed`, signalError);
      setError("The secure signaling exchange failed. Please retry the call.");
      setPhase("failed");
    }
  }, [cleanupConnection, initiator, markTimeline, maybeCreateOffer, roomId, startConnectionTimeout, userId]);

  const enqueueSignal = useCallback((signal: SignalPayload) => {
    const lifecycle = lifecycleRef.current;
    const queued = signalQueueRef.current.then(() => {
      if (lifecycle === lifecycleRef.current) return handleSignal(signal);
    });
    signalQueueRef.current = queued.catch((queueError) => {
      console.error("[SIGNAL] serialized signal processing failed", queueError);
    });
  }, [handleSignal]);

  useEffect(() => {
    if (!enabled || mode === "text" || !roomId || !userId) {
      queueMicrotask(() => setPhase("idle"));
      return;
    }
    lifecycleRef.current += 1;
    resetTimeline();
    let active = true;
    queueMicrotask(() => setPhase("subscribing"));
    queueMicrotask(() => setRealtimeStatus("CONNECTING"));
    const subscription = subscribeToRoom(roomId, {
      onSignal: enqueueSignal,
      onStatus: (status) => {
        if (active) setRealtimeStatus(status);
      },
    });
    signalingPromiseRef.current = subscription;
    void subscription
      .then((channel) => {
        if (!active) {
          void leaveRoomChannel(channel);
          return;
        }
        channelRef.current = channel;
        markTimeline("signalingSubscribed");
        setRealtimeStatus("SUBSCRIBED");
        setPhase("idle");
        return send({ kind: "peer-ready", mediaReady: false });
      })
      .catch((subscriptionError) => {
        console.error("[SIGNAL] private room subscription failed", subscriptionError);
        if (active) {
          const details = subscriptionError instanceof Error ? subscriptionError.message : "Unknown Supabase Realtime error";
          setError(`The private signaling channel could not be opened: ${details}`);
          setPhase("failed");
        }
      });

    return () => {
      active = false;
      void cleanupConnection(true, false);
    };
  }, [cleanupConnection, enabled, enqueueSignal, markTimeline, mode, resetTimeline, roomId, send, userId]);

  const startMedia = useCallback(async () => {
    console.info("[MEDIA] Enable button clicked");
    if (!enabled || mode === "text") return;
    console.info("[MEDIA] location:", window.location.href);
    console.info("[MEDIA] secure context:", window.isSecureContext);
    console.info("[MEDIA] mediaDevices:", Boolean(navigator.mediaDevices));
    if (!window.isSecureContext) {
      setMediaStatus("error");
      setError("Camera and microphone require HTTPS.");
      setPhase("failed");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaStatus("error");
      setError("This browser does not support live camera or microphone access.");
      setPhase("failed");
      return;
    }
    if (mediaStartTokenRef.current) return;
    const mediaStartToken = Symbol("media-start");
    mediaStartTokenRef.current = mediaStartToken;
    const lifecycle = lifecycleRef.current;
    try {
      setError(null);
      let stream = streamRef.current;
      if (!stream) {
      setMediaStatus("requesting");
      setPhase("media-preparing");
      console.info("[MEDIA] requesting camera + microphone");
      try {
        stream = await requestLocalMedia(mode);
        if (lifecycle !== lifecycleRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const audioTrack = stream.getAudioTracks()[0];
        const videoTrack = stream.getVideoTracks()[0];
        if (!audioTrack || audioTrack.readyState !== "live") throw new Error("A live microphone track was not created.");
        if (mode === "video" && (!videoTrack || videoTrack.readyState !== "live")) throw new Error("A live camera track was not created.");

        console.info("[MEDIA] getUserMedia SUCCESS");
        if (process.env.NODE_ENV === "development") {
          console.info("[MEDIA] Local audio tracks:", stream.getAudioTracks().map((track) => ({ enabled: track.enabled, muted: track.muted, readyState: track.readyState })));
          console.info("[MEDIA] Local video tracks:", stream.getVideoTracks().map((track) => ({ enabled: track.enabled, muted: track.muted, readyState: track.readyState })));
        }
        console.info("[MEDIA] tracks:", stream.getTracks().map((track) => ({
          id: track.id,
          kind: track.kind,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        })));
        streamRef.current = stream;
        mediaReadyRef.current = true;
        markTimeline("localMediaReady");
        setLocalStream(stream);
        setMicEnabled(true);
        setMediaPermission("granted");
        setMediaStatus("ready");
      } catch (mediaError) {
        if (lifecycle !== lifecycleRef.current) return;
        stream?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaReadyRef.current = false;
        console.error("[MEDIA] getUserMedia FAILED:", mediaError);
        console.error("[MEDIA] error name:", mediaError instanceof Error ? mediaError.name : "Unknown");
        console.error("[MEDIA] error message:", mediaError instanceof Error ? mediaError.message : String(mediaError));
        if (mediaError instanceof DOMException && (mediaError.name === "NotAllowedError" || mediaError.name === "SecurityError")) {
          setMediaPermission("denied");
        }
        setMediaStatus("error");
        setError(mediaErrorMessage(mediaError, mode));
        setPhase("failed");
        return;
      }
      }

      // Local preview is live at this point. Signaling and ICE setup are intentionally independent.
      try {
        const [signalingChannel, iceResponse] = await Promise.all([
          signalingPromiseRef.current,
          fetch(`/api/webrtc/ice-servers?roomId=${encodeURIComponent(roomId)}`, { cache: "no-store" }),
        ]);
        if (lifecycle !== lifecycleRef.current) return;
        if (!signalingChannel || !channelRef.current) throw new Error("The private signaling channel is not ready yet. Try again in a moment.");
        const iceData = await iceResponse.json() as IceServerResponse;
        if (!iceResponse.ok || !iceData.iceServers?.length) throw new Error(iceData.error ?? "WebRTC network configuration is unavailable.");
        turnConfiguredRef.current = Boolean(iceData.turnConfigured);

        const peer = createPeer(iceData.iceServers, Boolean(iceData.forceRelay));
        if (!peer.connection.getSenders().some((sender) => sender.track)) await peer.addLocalStream(stream, mode === "video");
        for (const candidate of pendingBeforePeerRef.current) await peer.addRemoteIceCandidate(candidate);
        pendingBeforePeerRef.current = [];
        setPhase(remoteReadyRef.current ? "signaling" : "waiting-for-peer");
        await send({ kind: "peer-ready", mediaReady: true });
        if (readyTimerRef.current) window.clearInterval(readyTimerRef.current);
        readyTimerRef.current = window.setInterval(() => {
          if (phaseRef.current !== "connected" && phaseRef.current !== "ended") {
            void send({ kind: "peer-ready", mediaReady: true }).catch((readyError) => console.warn("[SIGNAL] ready heartbeat failed", readyError));
          }
        }, 1_500);
        if (DIAGNOSTICS_ENABLED) {
          void refreshDiagnostics();
          if (statsTimerRef.current) window.clearInterval(statsTimerRef.current);
          statsTimerRef.current = window.setInterval(() => void refreshDiagnostics(), 1_000);
        }
        await maybeCreateOffer();
      } catch (connectionError) {
        if (lifecycle !== lifecycleRef.current) return;
        console.error("[WEBRTC] setup failed after local media became ready", connectionError);
        setError(connectionError instanceof Error ? connectionError.message : "The secure call setup failed.");
        setPhase("failed");
      }
    } finally {
      if (mediaStartTokenRef.current === mediaStartToken) mediaStartTokenRef.current = null;
    }
  }, [createPeer, enabled, markTimeline, maybeCreateOffer, mode, refreshDiagnostics, roomId, send]);

  const toggleMic = useCallback(() => {
    setMicEnabled((currentlyEnabled) => {
      const enabledNext = !currentlyEnabled;
      streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = enabledNext; });
      peerRef.current?.toggleMicrophone(enabledNext);
      if (process.env.NODE_ENV === "development") console.info(`[MEDIA] microphone ${enabledNext ? "unmuted" : "muted"}`);
      return enabledNext;
    });
  }, []);

  const switchCamera = useCallback(async () => {
    const currentTrack = streamRef.current?.getVideoTracks()[0];
    if (!currentTrack) return;
    const facing = currentTrack.getSettings().facingMode === "environment" ? "user" : "environment";
    let replacement: MediaStream | null = null;
    try {
      replacement = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24, max: 30 },
          facingMode: { ideal: facing },
        },
        audio: false,
      });
      const nextTrack = replacement.getVideoTracks()[0];
      if (!nextTrack || !peerRef.current) throw new Error("The replacement camera track is unavailable.");
      nextTrack.enabled = true;
      await peerRef.current.replaceVideoTrack(nextTrack);
      currentTrack.stop();
      streamRef.current?.removeTrack(currentTrack);
      streamRef.current?.addTrack(nextTrack);
      setLocalStream(new MediaStream(streamRef.current?.getTracks() ?? []));
    } catch (switchError) {
      replacement?.getTracks().forEach((track) => track.stop());
      console.error("[MEDIA] camera switch failed", switchError);
      setError("The other camera is not available on this device.");
    }
  }, []);

  const markFirstRemoteVideoFrame = useCallback(() => {
    markTimeline("firstRemoteVideoFrame");
  }, [markTimeline]);

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
    phase,
    statusMessage: statusMessage[phase],
    error,
    diagnostics,
    mediaStatus,
    mediaPermission,
    realtimeStatus,
    signalDiagnostics,
    timeline,
    secureContext: typeof window === "undefined" ? false : window.isSecureContext,
    roomId,
    role: initiator ? "initiator" as const : "receiver" as const,
    startMedia,
    retryConnection,
    endConnection,
    toggleMic,
    switchCamera,
    markFirstRemoteVideoFrame,
  };
}
