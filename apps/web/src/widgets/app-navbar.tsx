import { env } from "@project/env/client";
import { Button } from "@project/ui/components/button";
import { Link } from "@tanstack/react-router";
import { useAppSession } from "#/features/auth/session-context";
import { UserBlock } from "#/features/auth/user-block";
import { Logo } from "./logo";
import { MobileNav } from "./mobile-nav";
import { Navbar } from "./navbar";

const authedLinks = [
  { to: "/dashboard" as const, label: "Dashboard" },
  { to: "/todo-lists" as const, label: "Todo Lists" },
];

/**
 * Session-aware composition that assembles slot content and renders the
 * slot-typed `<Navbar />` shell. Splitting this out of the shell keeps
 * `Navbar` dumb (no `useSession`), so it can be storybooked / unit-tested
 * with arbitrary slot content.
 */
export function AppNavbar() {
  const { data: session } = useAppSession();
  const isAuthed = !!session;
  const isAdmin =
    isAuthed && (session.user as { role?: string }).role === "admin";
  // No trailing slash — Hono mounts Bull Board's entry route at exactly
  // `/admin/queues`. With a trailing slash the entry handler doesn't match
  // and the request falls through to a 404 (the API subroutes still work
  // because they don't depend on the bare slash).
  const jobsAdminHref = `${env.VITE_API_URL}/admin/queues`;

  const desktopLinks = isAuthed
    ? authedLinks.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className="text-muted-foreground text-sm hover:text-foreground"
          activeProps={{
            className: "text-sm font-semibold text-foreground",
          }}
        >
          {link.label}
        </Link>
      ))
    : null;

  const desktopAdminActions =
    isAuthed && isAdmin ? (
      <a
        href={jobsAdminHref}
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground text-sm hover:text-foreground"
      >
        Jobs Admin
      </a>
    ) : undefined;

  const desktopUser = isAuthed ? (
    <UserBlock />
  ) : (
    <Button asChild size="sm">
      <Link to="/login">Sign In</Link>
    </Button>
  );

  const mobileLinks = isAuthed
    ? authedLinks.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className="text-lg text-muted-foreground hover:text-foreground"
          activeProps={{
            className: "text-lg font-semibold text-foreground",
          }}
        >
          {link.label}
        </Link>
      ))
    : null;

  const mobileAdminActions =
    isAuthed && isAdmin ? (
      <a
        href={jobsAdminHref}
        target="_blank"
        rel="noreferrer"
        className="text-lg text-muted-foreground hover:text-foreground"
      >
        Jobs Admin
      </a>
    ) : undefined;

  const mobileUser = isAuthed ? (
    <UserBlock />
  ) : (
    <Button asChild className="w-full">
      <Link to="/login">Sign In</Link>
    </Button>
  );

  return (
    <Navbar
      slots={{
        logo: <Logo />,
        primaryLinks: desktopLinks,
        adminActions: desktopAdminActions,
        user: desktopUser,
        mobileNav: (
          <MobileNav
            slots={{
              primaryLinks: mobileLinks,
              adminActions: mobileAdminActions,
              user: mobileUser,
            }}
          />
        ),
      }}
    />
  );
}
