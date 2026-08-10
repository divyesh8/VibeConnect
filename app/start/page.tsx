import type { Metadata } from "next";
import { SetupForm } from "@/components/setup-form";

export const metadata: Metadata = {
  title: "Set your vibe",
  description: "Choose a nickname, conversation mode, and interests before getting matched.",
};

export default function StartPage() {
  return <SetupForm />;
}
