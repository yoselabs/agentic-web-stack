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
import { Logo } from "./logo";

const navLinks = [
  { to: "/dashboard" as const, label: "Dashboard" },
  { to: "/todo-lists" as const, label: "Todo Lists" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="border-b px-6 py-3 flex items-center justify-between">
      {/* Desktop */}
      <div className="flex items-center gap-6">
        <Logo />
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="text-sm text-muted-foreground hover:text-foreground"
              activeProps={{
                className: "text-sm font-semibold text-foreground",
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="hidden md:block">
        <UserBlock />
      </div>

      {/* Mobile hamburger */}
      <div className="md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent>
            <nav className="flex flex-col gap-4 mt-6">
              {navLinks.map((link) => (
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
              <div className="border-t pt-4 mt-2">
                <UserBlock />
              </div>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
