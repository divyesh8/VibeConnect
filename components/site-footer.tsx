import Link from "next/link";
import { Logo } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="relative z-10 mx-auto flex w-full max-w-[1240px] flex-col gap-5 border-t border-white/[0.08] px-5 py-8 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <div className="flex items-center gap-4">
        <Logo />
        <span>Friendly conversations only.</span>
      </div>
      <div className="flex gap-5">
        <Link href="/#safety" className="hover:text-white">Safety</Link>
        <Link href="/profile" className="hover:text-white">My session</Link>
        <span>© {new Date().getFullYear()} VibeConnect</span>
      </div>
    </footer>
  );
}
