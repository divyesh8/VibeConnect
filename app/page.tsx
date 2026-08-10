import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";

export const metadata: Metadata = {
  title: "Talk to someone new",
  description: "Meet strangers. Share stories. Make connections — no account required.",
};

export default function HomePage() {
  return <LandingPage />;
}
