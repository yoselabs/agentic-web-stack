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
import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useState } from "react";
import { UserBlock } from "#/features/auth/user-block";

export type MobileNavProps = {
  isAuthed: boolean;
  isAdmin: boolean;
  jobsAdminHref: string;
  authedLinks: ReadonlyArray<{ to: string; label: string }>;
};

export function MobileNav({
  isAuthed,
  isAdmin,
  jobsAdminHref,
  authedLinks,
}: MobileNavProps) {
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
        <nav className="flex flex-col gap-4 mt-6">
          {isAuthed &&
            authedLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="text-lg text-muted-foreground hover:text-foreground"
                activeProps={{
                  className: "text-lg font-semibold text-foreground",
                }}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          {isAuthed && isAdmin && (
            <a
              href={jobsAdminHref}
              target="_blank"
              rel="noreferrer"
              className="text-lg text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              Jobs Admin
            </a>
          )}
          <div className="border-t pt-4 mt-2">
            {isAuthed ? (
              <UserBlock />
            ) : (
              <Button asChild className="w-full">
                <Link to="/login" onClick={() => setOpen(false)}>
                  Sign In
                </Link>
              </Button>
            )}
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
