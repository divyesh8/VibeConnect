"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { leaveRoomChannel, sendSignal, subscribeToRoom, type SignalPayload } from "@/services/realtime";
import type { CommunicationMode } from "@/types";
import { PeerManager, type PeerSignal } from "@/webrtc/peer-manager";

export function useWebRTC(mode: CommunicationMode, roomId: string, userId: string) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(mode === "video");
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<PeerManager | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const startMedia = useCallback(async () => {
    if (mode === "text" || streamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionError("This browser does not support live media.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: mode === "video" ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      });
      streamRef.current = stream;
      setLocalStream(stream);
      setPermissionError(null);

      const emit = (signal: PeerSignal) => void sendSignal(channelRef.current, { ...signal, senderId: userId } as SignalPayload);
      const peer = new PeerManager(emit, setRemoteStream);
      peer.addLocalStream(stream);
      peerRef.current = peer;

      const channel = await subscribeToRoom(roomId, {
        onSignal: async (signal) => {
          if (signal.senderId === userId || !peerRef.current) return;
          if (signal.kind === "offer") await peerRef.current.acceptOffer(signal.sdp);
          if (signal.kind === "answer") await peerRef.current.acceptAnswer(signal.sdp);
          if (signal.kind === "ice") await peerRef.current.addIceCandidate(signal.candidate);
        },
      });
      channelRef.current = channel;

      const roomResponse = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
      const room = roomResponse.ok ? await roomResponse.json() as { initiator: boolean } : { initiator: false };
      if (room.initiator) await peer.createOffer();
    } catch (error) {
      setPermissionError(error instanceof DOMException && error.name === "NotAllowedError" ? "Camera or microphone access was blocked." : "We could not start your camera or microphone.");
    }
  }, [mode, roomId, userId]);

  const toggleMic = useCallback(() => {
    setMicEnabled((enabled) => {
      streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !enabled; });
      return !enabled;
    });
  }, []);

  const toggleCamera = useCallback(() => {
    setCameraEnabled((enabled) => {
      streamRef.current?.getVideoTracks().forEach((track) => { track.enabled = !enabled; });
      return !enabled;
    });
  }, []);

  const switchCamera = useCallback(async () => {
    const currentTrack = streamRef.current?.getVideoTracks()[0];
    if (!currentTrack) return;
    const facing = currentTrack.getSettings().facingMode === "environment" ? "user" : "environment";
    const replacement = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: facing } }, audio: false });
    const nextTrack = replacement.getVideoTracks()[0];
    const sender = peerRef.current?.connection.getSenders().find((item) => item.track?.kind === "video");
    await sender?.replaceTrack(nextTrack);
    currentTrack.stop();
    streamRef.current?.removeTrack(currentTrack);
    streamRef.current?.addTrack(nextTrack);
    setLocalStream(new MediaStream(streamRef.current?.getTracks() ?? []));
  }, []);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    peerRef.current?.close();
    leaveRoomChannel(channelRef.current);
    streamRef.current = null;
  }, []);

  return { localStream, remoteStream, micEnabled, cameraEnabled, permissionError, startMedia, toggleMic, toggleCamera, switchCamera };
}
