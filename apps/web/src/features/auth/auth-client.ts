import { env } from "@project/env/client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: env.VITE_API_URL,
});

export const { signIn, signUp, signOut, useSession } = authClient;
