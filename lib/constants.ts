import type { CommunicationMode, Gender } from "@/types";

export const INTERESTS = [
  "Gaming",
  "Movies",
  "Music",
  "Anime",
  "Technology",
  "Fitness",
  "Travel",
  "Random",
] as const;

export const GENDERS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

export const MODES: {
  value: CommunicationMode;
  label: string;
  description: string;
}[] = [
  { value: "text", label: "Text chat", description: "Type it out" },
  { value: "voice", label: "Voice chat", description: "Talk, no camera" },
  { value: "video", label: "Video call", description: "Face to face" },
];

export const COMMUNITY_RULES = [
  "Be kind — there is a real person on the other side.",
  "No harassment, hate, threats, or sexual content.",
  "Never share private information you want to keep private.",
];
