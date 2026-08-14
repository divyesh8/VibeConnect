import type { AnonymousProfile } from "@/types";
import { displayNameValidationError } from "@/lib/display-name";

export const GUEST_PROFILE_STORAGE_KEY = "vibeconnect_guest_profile";
const LEGACY_PROFILE_KEY = "vibeconnect:profile";

function isStoredProfile(value: unknown): value is AnonymousProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Record<string, unknown>;
  const username = typeof profile.username === "string" ? profile.username : "";
  return typeof profile.id === "string"
    && typeof profile.sessionId === "string"
    && username === username.trim()
    && displayNameValidationError(username) === null
    && ["male", "female", "other"].includes(String(profile.gender))
    && profile.mode === "video"
    && Array.isArray(profile.interests)
    && profile.interests.every((interest) => typeof interest === "string")
    && typeof profile.createdAt === "string";
}

export function saveLocalProfile(profile: AnonymousProfile) {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(GUEST_PROFILE_STORAGE_KEY, JSON.stringify(profile));
    window.sessionStorage.removeItem(LEGACY_PROFILE_KEY);
  }
}

export function getLocalProfile(): AnonymousProfile | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(GUEST_PROFILE_STORAGE_KEY)
    ?? window.sessionStorage.getItem(LEGACY_PROFILE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isStoredProfile(parsed)) throw new Error("Invalid stored guest profile");
    saveLocalProfile(parsed);
    return parsed;
  } catch {
    window.sessionStorage.removeItem(GUEST_PROFILE_STORAGE_KEY);
    window.sessionStorage.removeItem(LEGACY_PROFILE_KEY);
    return null;
  }
}

export function clearLocalProfile() {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(GUEST_PROFILE_STORAGE_KEY);
    window.sessionStorage.removeItem(LEGACY_PROFILE_KEY);
  }
}
