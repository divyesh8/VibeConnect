"use client";

import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className={cn("relative z-40 mx-auto flex w-full max-w-[1240px] items-center justify-between px-5 sm:px-8", compact ? "py-5" : "py-6")}>
      <Logo />
      <div className="flex items-center gap-2 sm:gap-3">
        {!compact && (
          <Link href="/#safety" className="hidden items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold text-white/55 transition hover:text-white sm:flex">
            <ShieldCheck className="size-4" />
            Safety first
          </Link>
        )}
        <Button asChild variant="secondary" size="sm">
          <Link href="/start">
            Start a chat <ArrowUpRight className="size-3.5" />
          </Link>
        </Button>
      </div>
    </header>
  );
}
