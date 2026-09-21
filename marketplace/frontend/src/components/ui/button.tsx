import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center rounded-control text-sm font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/35 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
    "disabled:pointer-events-none disabled:opacity-50",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-primary px-4 py-2 text-primary-foreground hover:bg-primary-hover",
        secondary: "bg-surface-muted px-4 py-2 text-foreground hover:bg-brand-cream",
        outline:
          "border border-border-strong bg-surface px-4 py-2 text-foreground hover:bg-surface-muted",
        ghost: "px-3 py-2 text-foreground-muted hover:bg-surface-muted hover:text-foreground",
        destructive: "bg-negative px-4 py-2 text-white hover:bg-negative/90",
      },
      size: {
        default: "h-11 sm:h-10",
        sm: "h-11 sm:h-9",
        lg: "h-11",
        icon: "h-11 w-11 px-0 py-0 sm:h-10 sm:w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

/** Shared application button. Existing default/outline/ghost contracts remain backward compatible. */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
