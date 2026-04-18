import { Button } from "@project/ui/components/button";
import { useNavigate } from "@tanstack/react-router";
import { signOut, useSession } from "#/features/auth/auth-client";

export function UserBlock() {
  const { data: session } = useSession();
  const navigate = useNavigate();

  if (!session) return null;

  const handleSignOut = async () => {
    await signOut();
    await navigate({ to: "/" });
  };

  return (
    <div className="flex items-center gap-4">
      <span className="text-sm text-muted-foreground">
        {session.user.name ?? session.user.email}
      </span>
      <Button variant="outline" size="sm" onClick={handleSignOut}>
        Sign Out
      </Button>
    </div>
  );
}
