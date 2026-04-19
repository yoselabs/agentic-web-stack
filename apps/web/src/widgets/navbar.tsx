import { env } from "@project/env/client";
import { Button } from "@project/ui/components/button";
import { Link } from "@tanstack/react-router";
import { useSession } from "#/features/auth/auth-client";
import { UserBlock } from "#/features/auth/user-block";
import { Logo } from "./logo";
import { MobileNav } from "./mobile-nav";

const authedLinks = [
  { to: "/dashboard" as const, label: "Dashboard" },
  { to: "/todo-lists" as const, label: "Todo Lists" },
];

export function Navbar() {
  const { data: session } = useSession();
  const isAuthed = !!session;
  const isAdmin =
    isAuthed && (session.user as { role?: string }).role === "admin";
  const jobsAdminHref = `${env.VITE_API_URL}/admin/queues/`;

  return (
    <nav className="border-b px-6 py-3 flex items-center justify-between">
      {/* Desktop */}
      <div className="flex items-center gap-6">
        <Logo />
        {isAuthed && (
          <div className="hidden md:flex items-center gap-6">
            {authedLinks.map((link) => (
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
        )}
      </div>

      <div className="hidden md:flex items-center gap-4">
        {isAuthed ? (
          <>
            {isAdmin && (
              <a
                href={jobsAdminHref}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Jobs Admin
              </a>
            )}
            <UserBlock />
          </>
        ) : (
          <Button asChild size="sm">
            <Link to="/login">Sign In</Link>
          </Button>
        )}
      </div>

      <div className="md:hidden">
        <MobileNav
          isAuthed={isAuthed}
          isAdmin={isAdmin}
          jobsAdminHref={jobsAdminHref}
          authedLinks={authedLinks}
        />
      </div>
    </nav>
  );
}
