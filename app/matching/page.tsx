import type { Metadata } from "next";
import { MatchingExperience } from "@/components/matching-experience";

export const metadata: Metadata = {
  title: "Finding your vibe",
  description: "VibeConnect is looking for someone compatible to chat with.",
};

export default function MatchingPage() {
  return <MatchingExperience />;
}
