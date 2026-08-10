import type { Metadata } from "next";
import { TemporaryProfile } from "@/components/temporary-profile";

export const metadata: Metadata = {
  title: "Your temporary profile",
  description: "View or reset the anonymous profile stored for this session.",
};

export default function ProfilePage() {
  return <TemporaryProfile />;
}
