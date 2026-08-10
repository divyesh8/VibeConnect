"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CommunicationMode } from "@/types";

export function useWebRTC(mode: CommunicationMode) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(mode === "video");
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
    } catch (error) {
      setPermissionError(error instanceof DOMException && error.name === "NotAllowedError" ? "Camera or microphone access was blocked." : "We could not start your camera or microphone.");
    }
  }, [mode]);

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
    currentTrack.stop();
    streamRef.current?.removeTrack(currentTrack);
    streamRef.current?.addTrack(nextTrack);
    setLocalStream(new MediaStream(streamRef.current?.getTracks()));
  }, []);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  return { localStream, remoteStream, micEnabled, cameraEnabled, permissionError, startMedia, toggleMic, toggleCamera, switchCamera };
}
