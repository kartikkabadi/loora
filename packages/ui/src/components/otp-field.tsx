"use client";

import { OTPField as OTPFieldPrimitive } from "@base-ui/react/otp-field";
import type * as React from "react";
import { cn } from "../lib/utils.ts";
import { Separator } from "./separator.tsx";

export function OTPField({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof OTPFieldPrimitive.Root> & {
  size?: "default" | "lg";
}): React.ReactElement {
  return (
    <OTPFieldPrimitive.Root
      className={cn(
        "flex items-center gap-2 has-disabled:opacity-64 has-disabled:**:data-[slot=otp-field-input]:shadow-none has-disabled:**:data-[slot=otp-field-input]:before:shadow-none!",
        className,
      )}
      data-size={size}
      data-slot="otp-field"
      {...props}
    />
  );
}

export function OTPFieldInput({
  className,
  ...props
}: React.ComponentProps<typeof OTPFieldPrimitive.Input>): React.ReactElement {
  return (
    <OTPFieldPrimitive.Input
      className={cn(
        "relative in-[[data-slot=otp-field][data-size=lg]]:size-10 size-9 min-w-0 rounded-md border border-input bg-transparent text-center in-[[data-slot=otp-field][data-size=lg]]:text-lg text-base text-foreground in-[[data-slot=otp-field][data-size=lg]]:leading-10 leading-9 outline-none ring-ring transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-md)-1px)] focus-visible:z-10 focus-visible:border-ring focus-visible:shadow-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive/36 aria-invalid:shadow-none aria-invalid:focus-visible:border-destructive/64 aria-invalid:focus-visible:ring-destructive/32 sm:in-[[data-slot=otp-field][data-size=lg]]:size-9 sm:size-7 sm:in-[[data-slot=otp-field][data-size=lg]]:text-base sm:text-xs sm:in-[[data-slot=otp-field][data-size=lg]]:leading-9 sm:leading-7 dark:aria-invalid:focus-visible:ring-destructive/24",
        className,
      )}
      data-slot="otp-field-input"
      spellCheck={false}
      {...props}
    />
  );
}

export function OTPFieldSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>): React.ReactElement {
  return (
    <OTPFieldPrimitive.Separator
      render={
        <Separator
          className={cn(
            "rounded-full bg-input data-[orientation=horizontal]:h-0.5 data-[orientation=horizontal]:w-3",
            className,
          )}
          orientation="horizontal"
          {...props}
        />
      }
    />
  );
}

export { OTPFieldPrimitive };
