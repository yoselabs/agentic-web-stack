import { env } from "@project/env/client";
import type { BetterAuthClientOptions } from "better-auth/client";
import {
  inferAdditionalFields,
  magicLinkClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Schema literal mirrors packages/auth/src/index.ts additionalFields.
// `role` is `input: false` server-side so the client signUp surface
// doesn't require it. `username` is required.
const additionalFieldsSchema = {
  user: {
    role: { type: "string" as const, input: false as const },
    username: { type: "string" as const, required: true as const },
  },
};

// Portable type cast: createAuthClient's inferred return type references
// internal pnpm paths that TypeScript cannot name portably under
// project-references mode (TS2883). Cast through BetterAuthClientOptions
// gives a portable surface; the additional-fields plugin still narrows
// signUp.email to require `username`.
type BaseAuthClient = ReturnType<
  typeof createAuthClient<BetterAuthClientOptions>
>;
// magicLinkClient adds `signIn.magicLink({ email, callbackURL, … })`.
// The Better-Auth client's plugin-augmented type pulls in zod internals
// that fail to name-portably under TS project references; we keep the
// portable cast and hand-extend the magic-link surface alongside signUp.
interface MagicLinkInput {
  readonly email: string;
  readonly callbackURL?: string;
  readonly newUserCallbackURL?: string;
}
interface MagicLinkResult {
  readonly data: { status: boolean } | null;
  readonly error: { message?: string; status?: number } | null;
}

type AuthClient = Omit<BaseAuthClient, "signUp" | "signIn"> & {
  signUp: Omit<BaseAuthClient["signUp"], "email"> & {
    email: (
      data: Parameters<BaseAuthClient["signUp"]["email"]>[0] & {
        username: string;
      },
      options?: Parameters<BaseAuthClient["signUp"]["email"]>[1],
    ) => ReturnType<BaseAuthClient["signUp"]["email"]>;
  };
  signIn: BaseAuthClient["signIn"] & {
    magicLink: (input: MagicLinkInput) => Promise<MagicLinkResult>;
  };
};

// magicLinkClient adds `authClient.signIn.magicLink({ email, callbackURL })`
// and exposes the verify-URL surface. The server-side plugin in
// @project/auth sends the email; the client-side plugin is just the
// typed request helper.
export const authClient = createAuthClient({
  baseURL: env.VITE_API_URL,
  plugins: [inferAdditionalFields(additionalFieldsSchema), magicLinkClient()],
}) as unknown as AuthClient;

export const { useSession, signIn, signUp, signOut } = authClient;
