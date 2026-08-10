import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "VibeConnect — Talk to someone new",
    template: "%s · VibeConnect",
  },
  description:
    "A safer, friendlier way to meet someone new through anonymous text, voice, and video conversations.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "VibeConnect — Talk to someone new",
    description: "Meet strangers. Share stories. Make connections.",
    type: "website",
    images: [{ url: "/og.png", width: 1792, height: 1024, alt: "VibeConnect — Talk to someone new" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "VibeConnect — Talk to someone new",
    description: "Meet strangers. Share stories. Make connections.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${spaceGrotesk.variable}`}>
        {children}
      </body>
    </html>
  );
}
