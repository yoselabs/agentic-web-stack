import { Button } from "@project/ui/components/button";
import { useNavigate } from "@tanstack/react-router";
import { signOut } from "#/features/auth/auth-client";
import { useAppSession } from "#/features/auth/session-context";

export function UserBlock() {
  const { data: session } = useAppSession();
  const navigate = useNavigate();

  if (!session) return null;

  const handleSignOut = async () => {
    await signOut();
    await navigate({ to: "/" });
  };

  return (
    <div className="flex items-center gap-4">
      <span className="text-muted-foreground text-sm">
        {session.user.name ?? session.user.email}
      </span>
      <Button variant="outline" size="sm" onClick={handleSignOut}>
        Sign Out
      </Button>
    </div>
  );
}
