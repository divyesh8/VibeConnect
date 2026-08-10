import Link from "next/link";
import { Sparkles } from "lucide-react";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2.5" aria-label="VibeConnect home">
      <span className="relative grid size-9 place-items-center rounded-[13px] border border-white/15 bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,.15)]">
        <span className="absolute inset-1 rounded-[9px] bg-gradient-to-br from-[#72f6df] via-[#b277ff] to-[#ff63bd] opacity-80 blur-[5px] transition group-hover:opacity-100" />
        <Sparkles className="relative size-[17px] text-white" strokeWidth={2.4} />
      </span>
      <span className="font-display text-[17px] font-bold tracking-[-0.04em] text-white">
        vibe<span className="text-white/50">connect</span>
      </span>
    </Link>
  );
}
