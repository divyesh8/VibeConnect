"use client";

import { createContext, useCallback, useContext, useMemo, useState, useEffect } from "react";
import { clearLocalProfile, getLocalProfile, saveLocalProfile } from "@/lib/session";
import type { AnonymousProfile } from "@/types";

type GuestProfileUpdate = Partial<Pick<AnonymousProfile, "username" | "gender" | "mode" | "interests">>;

type GuestProfileContextValue = {
  profile: AnonymousProfile | null;
  isLoaded: boolean;
  isProfileComplete: boolean;
  setProfile: (profile: AnonymousProfile) => void;
  updateProfile: (update: GuestProfileUpdate) => void;
  clearProfile: () => void;
};

const GuestProfileContext = createContext<GuestProfileContextValue | null>(null);

export function GuestProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfileState] = useState<AnonymousProfile | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setProfileState(getLocalProfile());
      setIsLoaded(true);
    });
    return () => { active = false; };
  }, []);

  const setProfile = useCallback((nextProfile: AnonymousProfile) => {
    saveLocalProfile(nextProfile);
    setProfileState(nextProfile);
  }, []);

  const updateProfile = useCallback((update: GuestProfileUpdate) => {
    setProfileState((current) => {
      if (!current) return current;
      const nextProfile = { ...current, ...update };
      saveLocalProfile(nextProfile);
      return nextProfile;
    });
  }, []);

  const clearProfile = useCallback(() => {
    clearLocalProfile();
    setProfileState(null);
  }, []);

  const value = useMemo<GuestProfileContextValue>(() => ({
    profile,
    isLoaded,
    isProfileComplete: Boolean(profile?.username && profile.gender),
    setProfile,
    updateProfile,
    clearProfile,
  }), [clearProfile, isLoaded, profile, setProfile, updateProfile]);

  return <GuestProfileContext.Provider value={value}>{children}</GuestProfileContext.Provider>;
}

export function useGuestProfile() {
  const context = useContext(GuestProfileContext);
  if (!context) throw new Error("useGuestProfile must be used within GuestProfileProvider");
  return context;
}
