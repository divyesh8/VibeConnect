"use client";

import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-white text-[#0c0a13] shadow-[0_12px_40px_rgba(255,255,255,.12)] hover:bg-[#dffffa] hover:-translate-y-0.5",
  secondary:
    "border border-white/12 bg-white/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.08)] hover:bg-white/[0.12]",
  ghost: "text-white/70 hover:bg-white/[0.08] hover:text-white",
  danger: "border border-rose-400/20 bg-rose-400/10 text-rose-200 hover:bg-rose-400/18",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 rounded-full px-4 text-xs",
  md: "h-11 rounded-full px-5 text-sm",
  lg: "h-14 rounded-full px-7 text-[15px]",
  icon: "size-11 rounded-full",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-2 font-bold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:pointer-events-none disabled:opacity-45",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
