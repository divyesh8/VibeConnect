import type { AnonymousProfile } from "@/types";

const PROFILE_KEY = "vibeconnect:profile";

export function saveLocalProfile(profile: AnonymousProfile) {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }
}

export function getLocalProfile(): AnonymousProfile | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AnonymousProfile;
  } catch {
    window.sessionStorage.removeItem(PROFILE_KEY);
    return null;
  }
}

export function clearLocalProfile() {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(PROFILE_KEY);
}
