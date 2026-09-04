import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        // Browser autofill is OFF BY DEFAULT for every input in the app.
        //
        // Chrome's saved-form-data dropdown fires on almost anything — it covered search bars,
        // filter boxes and money fields with a list of things typed on unrelated pages. This app is
        // ~274 inputs and only a handful are credentials, so the sane default is off and the few
        // fields that WANT autofill declare it.
        //
        // spellCheck/autoCorrect/autoCapitalize off too: player names, team names and abbreviations
        // are not dictionary words, and iOS auto-capitalising a search box is its own annoyance.
        //
        // ⚠ {...props} SPREADS AFTER these, so any explicit autoComplete wins — see Auth.tsx, which
        // sets email/current-password/new-password so password managers still work on login.
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
