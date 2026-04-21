// Mobile hamburger menu. Pulls `@radix-ui/react-dialog` (via shadcn
// Sheet), which transitively imports `tslib`. The vite SSR config in
// `apps/web/vite.config.ts` lists tslib in `ssr.noExternal` so the
// helpers (`__extends`, etc.) bundle through vite's ESM resolver
// instead of Node's CJS interop. Without that, this module crashes
// the SSR bundle at load.

import { Button } from "@project/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@project/ui/components/sheet";
import { Menu } from "lucide-react";
import { type ReactNode, useState } from "react";

/**
 * Slot contract for the mobile drawer shell. Same discipline as `NavbarSlots`:
 * every affordance the drawer renders is a typed key so a forgotten admin
 * action or user block fails compilation.
 *
 * See ADR-0004 (`docs/adrs/0004-ui-shell-slots.md`).
 */
export type MobileNavSlots = {
  /** Primary navigation links rendered inside the drawer. */
  primaryLinks: ReactNode;
  /** Admin-only links. Omit for non-admin viewers. */
  adminActions?: ReactNode;
  /** User affordance — UserBlock when authed, Sign-In button when not. */
  user: ReactNode;
};

export function MobileNav({ slots }: { slots: MobileNavSlots }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent>
        {/* Close the drawer when any link inside is activated. Captured on
            the container so individual slot contents don't need to know they
            live inside the drawer. Scoped to anchors only so dropdown
            triggers (e.g. UserBlock) don't accidentally dismiss it. */}
        <nav
          className="flex flex-col gap-4 mt-6"
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest("a")) setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            const target = event.target as HTMLElement;
            if (target.closest("a")) setOpen(false);
          }}
        >
          {slots.primaryLinks}
          {slots.adminActions}
          <div className="border-t pt-4 mt-2">{slots.user}</div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
