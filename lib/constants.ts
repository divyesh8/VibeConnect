import type { Gender } from "@/types";

export const GENDERS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

export const COMMUNITY_RULES = [
  "Be kind — there is a real person on the other side.",
  "No harassment, hate, threats, or sexual content.",
  "Never share private information you want to keep private.",
];
