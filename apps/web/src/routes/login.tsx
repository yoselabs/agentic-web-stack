import { Button } from "@project/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@project/ui/components/card";
import { Input } from "@project/ui/components/input";
import { Label } from "@project/ui/components/label";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { signIn, signUp, useSession } from "#/features/auth/auth-client";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

function LoginPage() {
  const navigate = useNavigate();
  const { trpc } = Route.useRouteContext();
  const { data: session } = useSession();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [debouncedUsername, setDebouncedUsername] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (session) navigate({ to: "/dashboard" });
  }, [session, navigate]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedUsername(username), 300);
    return () => clearTimeout(t);
  }, [username]);

  const usernameFormatValid = useMemo(
    () => USERNAME_REGEX.test(username),
    [username],
  );

  const availability = useQuery({
    ...trpc.user.isUsernameAvailable.queryOptions({
      username: debouncedUsername,
    }),
    enabled:
      isSignUp &&
      debouncedUsername.length >= 3 &&
      USERNAME_REGEX.test(debouncedUsername),
    staleTime: 5_000,
  });

  const usernameHint = !isSignUp
    ? null
    : username.length === 0
      ? "3–20 chars: lowercase letters, digits, underscore"
      : !usernameFormatValid
        ? "Invalid format (3–20 lowercase letters/digits/_)"
        : availability.isLoading
          ? "Checking…"
          : availability.data === false
            ? "Username already taken"
            : availability.data === true
              ? "Available"
              : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (isSignUp) {
      if (!usernameFormatValid) {
        setError("Invalid username format");
        return;
      }
      if (availability.data === false) {
        setError("Username already taken");
        return;
      }
      // The auth-client cast (TS2742 workaround) strips additionalFields
      // inference, so we widen the call signature to include `username` here.
      const result = await (
        signUp.email as (input: {
          email: string;
          password: string;
          name: string;
          username: string;
        }) => ReturnType<typeof signUp.email>
      )({
        email,
        password,
        name: name || email.split("@")[0],
        username,
      });
      if (result.error) {
        setError(result.error.message ?? "Sign up failed");
        return;
      }
    } else {
      const result = await signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "Sign in failed");
        return;
      }
    }
    navigate({ to: "/dashboard" });
  };

  if (session) return null;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            {isSignUp ? "Create Account" : "Sign In"}
          </CardTitle>
          <CardDescription>
            {isSignUp
              ? "Enter your details to create an account"
              : "Enter your credentials to sign in"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="e.g. alice_a"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase())}
                    required
                  />
                  {usernameHint && (
                    <p className="text-xs text-muted-foreground">
                      {usernameHint}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Display Name</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full">
              {isSignUp ? "Sign Up" : "Sign In"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              {isSignUp ? "Sign In" : "Sign Up"}
            </button>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
