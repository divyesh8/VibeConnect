import type { Metadata } from "next";
import { SetupForm } from "@/components/setup-form";

export const metadata: Metadata = {
  title: "Set your vibe",
  description: "Choose a nickname and start a private video connection.",
};

export default function StartPage() {
  return <SetupForm />;
}
