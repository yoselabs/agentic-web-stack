# Auth UX + Invite Polish + Reorder Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `/login` into `/login` + `/signup`, fix invite autocomplete `@`-prefix failure at the server boundary, render `PendingInvitesDashboard` on `/todo-lists`, diagnose and fix the collaborator→owner reorder broadcast gap, and add targeted unit + BDD coverage for the two escaped defects.

**Architecture:** Server-side normalization for `@` (one change covers search + invite + any future caller). Thin route shells in `apps/web/src/routes/` delegating to FSD feature components in `apps/web/src/features/auth/`. Reorder fix is diagnosis-led — add logs, reproduce, apply one of three candidate fixes.

**Tech Stack:** TanStack Start, TanStack Router, TanStack Form, tRPC v11, Better-Auth, Prisma, Bun test, playwright-bdd, @dnd-kit.

**Spec:** `docs/superpowers/specs/2026-04-20-auth-ux-invite-reorder-polish-design.md`

---

## File Structure

### Created

- `apps/web/src/features/auth/sign-in-form.tsx` — sign-in form component (schema + form + `signIn.email`)
- `apps/web/src/features/auth/sign-up-form.tsx` — sign-up form component (schema + form + `signUp.email` + username default-from-email)
- `apps/web/src/routes/signup.tsx` — new route, mirrors `login.tsx` shell
- `e2e/features/todo-list/realtime-reorder.feature` — one scenario
- `e2e/steps/todo-list/realtime-reorder.ts` — new step definitions

### Modified

- `packages/api/src/domains/user/user-service.ts` — `@`/whitespace strip in `searchUsersByUsername`
- `packages/api/src/domains/user/__tests__/user-service.test.ts` — new test cases
- `packages/api/src/domains/todo-list/service.ts` — `@`/whitespace strip in `inviteCollaborator`
- `packages/api/src/domains/todo-list/__tests__/invites.test.ts` — new test cases
- `apps/web/src/routes/login.tsx` — drop toggle, render `<SignInForm />`, add cross-link to `/signup`
- `apps/web/src/routes/_authenticated/todo-lists/index.tsx` — render `<PendingInvitesDashboard />`
- `packages/api/src/domains/todo-list/todo-service.ts` — reorder fix (exact change TBD by Task 17's investigation)
- `apps/web/src/features/todo-list/event-handlers.ts` OR `apps/web/src/features/todo-list/use-todos.ts` — reorder fix (exact file TBD by Task 17's investigation)

### Generated (do not edit by hand)

- `apps/web/src/routeTree.gen.ts` — regenerates on `vite dev` or `make routes`
- `e2e/.features-gen/` — regenerates on `pnpm exec bddgen`

---

## Task 1: Unit test — `searchUsersByUsername` strips `@`

**Files:**
- Modify: `packages/api/src/domains/user/__tests__/user-service.test.ts`

- [ ] **Step 1: Add failing test cases**

Append inside the existing `describe("searchUsersByUsername", ...)` block, after the "excludes the caller" test:

```ts
  it("strips a leading '@' prefix from the search input", async () => {
    const rows = await searchUsersByUsername(db, CALLER_ID, "@ali");
    const usernames = rows.map((r) => r.username).sort();
    expect(usernames).toEqual(["ali-admin", "alice", "alicia"]);
  });

  it("strips repeated leading '@' characters greedily", async () => {
    const rows = await searchUsersByUsername(db, CALLER_ID, "@@alice");
    expect(rows.map((r) => r.username)).toContain("alice");
  });

  it("strips '@' after trimming surrounding whitespace", async () => {
    const rows = await searchUsersByUsername(db, CALLER_ID, "  @alice  ");
    expect(rows.map((r) => r.username)).toContain("alice");
  });

  it("returns [] when the prefix is only '@' characters", async () => {
    const rows = await searchUsersByUsername(db, CALLER_ID, "@@");
    expect(rows).toEqual([]);
  });
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @project/api test user-service`

Expected: the four new cases fail because the service doesn't strip `@`. The `"@ali"` case most likely returns `[]` (since no username starts with `@`).

- [ ] **Step 3: Implement the strip in the service**

Modify `packages/api/src/domains/user/user-service.ts`. Replace the body of `searchUsersByUsername` lines 11-30. The change is two lines (`replace(/^@+/, "")` after `trim()`) and a renamed variable to reflect the new semantics. Full replacement:

```ts
export async function searchUsersByUsername(
  db: DbClient,
  callerId: string,
  prefix: string,
): Promise<Array<{ id: string; username: string; name: string }>> {
  // Accept both "alice" and "@alice" (the autocomplete UI renders
  // usernames as "@alice" after selection, and that value feeds back
  // into the search on next keystroke). Normalize at the boundary —
  // one fix covers the UI re-edit path AND users who type "@" by hand.
  const normalized = prefix.trim().replace(/^@+/, "");
  if (normalized.length === 0) return [];
  return db.user.findMany({
    where: {
      AND: [
        { id: { not: callerId } },
        {
          OR: [
            { username: { startsWith: normalized, mode: "insensitive" } },
            { name: { startsWith: normalized, mode: "insensitive" } },
          ],
        },
      ],
    },
    select: { id: true, username: true, name: true },
    orderBy: { username: "asc" },
    take: MAX_SEARCH_RESULTS,
  });
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `pnpm --filter @project/api test user-service`

Expected: all tests pass, including the four new cases.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/domains/user/user-service.ts \
        packages/api/src/domains/user/__tests__/user-service.test.ts
git commit -m "fix(user): strip '@' prefix in searchUsersByUsername

The invite autocomplete displays selected users as '@alice', and the
same input feeds back into the search on next keystroke. The server
rejected the '@'-prefixed prefix by returning []. Normalize at the
service boundary so any caller (typed input, re-edit, future API
consumer) is covered by one change."
```

---

## Task 2: Unit test — `inviteCollaborator` strips `@`

**Files:**
- Modify: `packages/api/src/domains/todo-list/__tests__/invites.test.ts`

- [ ] **Step 1: Add failing test cases**

Append these two `it(...)` blocks inside the existing `describe("invite service", ...)` block (after the last existing test, before the closing `});` of `describe`):

```ts
  it("accepts '@username' as invite input and normalizes it", async () => {
    const inv = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "@invitee-inv"),
    );
    expect(inv.invite.invitedUserId).toBe(INVITEE_ID);
  });

  it("error message for missing user echoes the normalized username", async () => {
    await expect(
      db.$transaction((tx) =>
        inviteCollaborator(tx, OWNER_ID, listId, "@nobody-xyz"),
      ),
    ).rejects.toThrow('No user with username "nobody-xyz"');
  });
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @project/api test invites`

Expected: both cases fail. Case 1 throws `NOT_FOUND` because the raw `"@invitee-inv"` doesn't match the unique `username` column. Case 2 passes the error-type check but the thrown message contains `"@nobody-xyz"` (raw), not `"nobody-xyz"` (normalized).

- [ ] **Step 3: Implement the strip in the service**

Modify `packages/api/src/domains/todo-list/service.ts`. Change the `inviteCollaborator` function signature parameter from `username` to `rawUsername`, add the normalization as the first statement, and reuse `username` for everything downstream. Replace lines 117-156 (the opening of the function through the CONFLICT throw) with:

```ts
export async function inviteCollaborator(
  tx: Prisma.TransactionClient,
  ownerId: string,
  listId: string,
  rawUsername: string,
  options: {
    nowMs?: number;
    userInboxChannel?: UserInboxChannelProvider;
  } = {},
): Promise<InviteCollaboratorResult> {
  // Normalize at the boundary — the autocomplete UI may pass "@alice"
  // if the user re-edits after selection, and a typed-by-hand "@alice"
  // hits the same path. Server is the single point of normalization;
  // see also searchUsersByUsername.
  const username = rawUsername.trim().replace(/^@+/, "");

  const list = await tx.todoList.findFirstOrThrow({
    where: { id: listId, userId: ownerId },
  });

  const invitee = await tx.user.findUnique({ where: { username } });
  if (!invitee) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No user with username "${username}"`,
    });
  }
  if (invitee.id === ownerId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot invite yourself",
    });
  }

  const existing = await tx.todoListMembership.findUnique({
    where: {
      userId_todoListId: { userId: invitee.id, todoListId: listId },
    },
  });
  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "User is already a collaborator",
    });
  }
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `pnpm --filter @project/api test invites`

Expected: all tests pass, including the two new cases.

- [ ] **Step 5: Run the full unit suite to catch any regressions**

Run: `make test-unit`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/domains/todo-list/service.ts \
        packages/api/src/domains/todo-list/__tests__/invites.test.ts
git commit -m "fix(invite): strip '@' prefix in inviteCollaborator

Mirrors the searchUsersByUsername fix — server is the single point
of username normalization. Error message now echoes the cleaned
form, matching what the user sees in the UI."
```

---

## Task 3: Extract `SignInForm` component

**Files:**
- Create: `apps/web/src/features/auth/sign-in-form.tsx`

- [ ] **Step 1: Create the SignInForm component**

Create `apps/web/src/features/auth/sign-in-form.tsx` with this content:

```tsx
// Sign-in form. Owns its Zod schema, form state, and submit handler.
// Callers render <SignInForm /> inside a route shell — the route
// handles beforeLoad redirects and layout wrapping.

import { Button } from "@project/ui/components/button";
import { Input } from "@project/ui/components/input";
import { Label } from "@project/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { signIn } from "#/features/auth/auth-client";

// Signin accepts any non-empty password — the server is authoritative
// on policy. Showing "min N characters" on signin is misleading because
// the account's existing password may have been set under different rules.
const signinSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

function formatFieldError(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (typeof err === "object" && "message" in err) {
    const { message } = err as { message?: unknown };
    if (typeof message === "string") return message;
  }
  return String(err);
}

export function SignInForm() {
  const navigate = useNavigate();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { email: "", password: "" },
    validators: { onBlur: signinSchema, onSubmit: signinSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const result = await signIn.email({
        email: value.email,
        password: value.password,
      });
      if (result.error) {
        setFormError(result.error.message ?? "Sign in failed");
        return;
      }
      await router.invalidate();
      await navigate({ to: "/dashboard" });
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="space-y-4"
    >
      <form.Field name="email">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Email</Label>
            <Input
              id={field.name}
              type="email"
              placeholder="you@example.com"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              required
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive">
                {formatFieldError(field.state.meta.errors[0])}
              </p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="password">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Password</Label>
            <Input
              id={field.name}
              type="password"
              placeholder="Your password"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              required
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive">
                {formatFieldError(field.state.meta.errors[0])}
              </p>
            )}
          </div>
        )}
      </form.Field>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            Sign In
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
```

- [ ] **Step 2: Commit (scaffolding only; route uses it in Task 5)**

```bash
git add apps/web/src/features/auth/sign-in-form.tsx
git commit -m "feat(auth): extract SignInForm component

Moves sign-in form logic out of /login route into a dedicated
feature component. Enables the route split in the follow-up task."
```

---

## Task 4: Create `SignUpForm` component

**Files:**
- Create: `apps/web/src/features/auth/sign-up-form.tsx`

- [ ] **Step 1: Create the SignUpForm component**

Create `apps/web/src/features/auth/sign-up-form.tsx` with this content:

```tsx
// Sign-up form. Owns its Zod schema, form state, and submit handler.
// Name and username are optional in the form — the submit handler
// derives them from the email local-part if blank, keeping the UI
// terse while still populating Better-Auth's required `username` and
// `name` fields (see packages/auth/src/index.ts additionalFields).

import { MIN_PASSWORD_LENGTH } from "@project/auth/constants";
import { Button } from "@project/ui/components/button";
import { Input } from "@project/ui/components/input";
import { Label } from "@project/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { signUp } from "#/features/auth/auth-client";

const signupSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Min ${MIN_PASSWORD_LENGTH} characters`),
  // Empty allowed — submit handler derives name/username from email.
  name: z.string(),
  username: z.string(),
});

function formatFieldError(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (typeof err === "object" && "message" in err) {
    const { message } = err as { message?: unknown };
    if (typeof message === "string") return message;
  }
  return String(err);
}

export function SignUpForm() {
  const navigate = useNavigate();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { email: "", password: "", name: "", username: "" },
    validators: { onBlur: signupSchema, onSubmit: signupSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const result = await signUp.email({
        email: value.email,
        password: value.password,
        name: value.name || value.email.split("@")[0],
        username: value.username || value.email.split("@")[0],
      });
      if (result.error) {
        setFormError(result.error.message ?? "Sign up failed");
        return;
      }
      await router.invalidate();
      await navigate({ to: "/dashboard" });
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="space-y-4"
    >
      <form.Field name="name">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Name</Label>
            <Input
              id={field.name}
              type="text"
              placeholder="Your name"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          </div>
        )}
      </form.Field>

      <form.Field name="username">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Username</Label>
            <Input
              id={field.name}
              type="text"
              placeholder="your_username"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          </div>
        )}
      </form.Field>

      <form.Field name="email">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Email</Label>
            <Input
              id={field.name}
              type="email"
              placeholder="you@example.com"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              required
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive">
                {formatFieldError(field.state.meta.errors[0])}
              </p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="password">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Password</Label>
            <Input
              id={field.name}
              type="password"
              placeholder={`Min ${MIN_PASSWORD_LENGTH} characters`}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive">
                {formatFieldError(field.state.meta.errors[0])}
              </p>
            )}
          </div>
        )}
      </form.Field>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            Sign Up
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/features/auth/sign-up-form.tsx
git commit -m "feat(auth): extract SignUpForm component

Sibling to SignInForm. Enables the /signup route in the follow-up task."
```

---

## Task 5: Create `/signup` route + rewrite `/login`

**Files:**
- Create: `apps/web/src/routes/signup.tsx`
- Modify: `apps/web/src/routes/login.tsx`

- [ ] **Step 1: Create the /signup route**

Create `apps/web/src/routes/signup.tsx` with this content:

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@project/ui/components/card";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { SignUpForm } from "#/features/auth/sign-up-form";

export const Route = createFileRoute("/signup")({
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: "/dashboard" });
  },
  component: SignUpPage,
});

function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Create Account</CardTitle>
          <CardDescription>
            Enter your details to create an account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignUpForm />

          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link
              to={"/forgot-password" as string}
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              Forgot password?
            </Link>
          </p>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              to="/login"
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              Sign In
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Replace /login with the slimmed-down version**

Fully replace the contents of `apps/web/src/routes/login.tsx` with:

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@project/ui/components/card";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { SignInForm } from "#/features/auth/sign-in-form";

export const Route = createFileRoute("/login")({
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: "/dashboard" });
  },
  component: LoginPage,
});

function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Sign In</CardTitle>
          <CardDescription>
            Enter your credentials to sign in
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm />

          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link
              to={"/forgot-password" as string}
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              Forgot password?
            </Link>
          </p>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link
              to={"/signup" as string}
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              Sign Up
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

Note on `to={"/signup" as string}`: TanStack Router types come from `routeTree.gen.ts`, which hasn't regenerated yet to include `/signup`. The `as string` cast is removed in the next step after regeneration. See root CLAUDE.md's Common Mistakes table ("Link to rejects not-yet-created routes").

- [ ] **Step 3: Regenerate the route tree**

Run: `make routes`

Expected: `apps/web/src/routeTree.gen.ts` updates to include a `/signup` route entry. The file is auto-generated — do not hand-edit.

- [ ] **Step 4: Remove the `as string` cast**

Edit `apps/web/src/routes/login.tsx`. Replace `to={"/signup" as string}` with `to="/signup"` (plain string literal now that the route tree recognizes it). Leave `to={"/forgot-password" as string}` as-is — that route already had the same workaround before this plan.

- [ ] **Step 5: Run typecheck and lint**

Run: `make lint`

Expected: `agent-harness lint` + `tsc -b` both pass. The `/signup` route is now a valid `Link` target.

- [ ] **Step 6: Manual smoke test**

Start the dev server: `make dev`

In a browser:
1. Open `http://localhost:3000/login` — renders the Sign In card with "Forgot password?" and "Sign Up" links.
2. Click "Sign Up" — navigates to `/signup` with the signup form.
3. Click "Sign In" on `/signup` — navigates back to `/login`.
4. Click "Forgot password?" on either page — navigates to `/forgot-password`.
5. Sign up with a fresh email — redirects to `/dashboard`.
6. Sign out, then `/login` with the new credentials — redirects to `/dashboard`.

Kill the dev server when done.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/routes/login.tsx \
        apps/web/src/routes/signup.tsx \
        apps/web/src/routeTree.gen.ts
git commit -m "feat(auth): split /signup into its own route

/login and /signup now render distinct route shells that compose
SignInForm / SignUpForm. Both cross-link to each other and to
/forgot-password. Removes the isSignUp toggle state. No Better-Auth
config changes — signup, signin, forgot, and reset continue through
the existing emailAndPassword + sendResetPassword flow."
```

---

## Task 6: Render `PendingInvitesDashboard` on `/todo-lists`

**Files:**
- Modify: `apps/web/src/routes/_authenticated/todo-lists/index.tsx`

- [ ] **Step 1: Add the widget to the todo-lists index page**

Edit `apps/web/src/routes/_authenticated/todo-lists/index.tsx`. Add an import for `PendingInvitesDashboard` and render it above the `<h1>Todo Lists</h1>` heading.

Full replacement of the file:

```tsx
import { Badge } from "@project/ui/components/badge";
import { Button } from "@project/ui/components/button";
import { Input } from "@project/ui/components/input";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PendingInvitesDashboard } from "#/features/todo-list/pending-invites-dashboard";
import { useTodoLists } from "#/features/todo-list/use-todo-lists.js";

export const Route = createFileRoute("/_authenticated/todo-lists/")({
  component: TodoListsPage,
});

function TodoListsPage() {
  const { trpc } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const {
    newName,
    setNewName,
    todoLists,
    createTodoList,
    deleteTodoList,
    handleSubmit,
  } = useTodoLists(trpc, queryClient);

  return (
    <main
      data-testid="todo-lists-index"
      className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-10"
    >
      <PendingInvitesDashboard trpc={trpc} />

      <h1 className="text-3xl font-bold mb-6">Todo Lists</h1>

      <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
        <Input
          type="text"
          placeholder="New list name..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={createTodoList.isPending}>
          {createTodoList.isPending ? "Creating..." : "Create"}
        </Button>
      </form>

      {todoLists.isPending ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : todoLists.data?.length === 0 ? (
        <p className="text-muted-foreground">
          No lists yet. Create one to get started.
        </p>
      ) : (
        <ul className="space-y-2">
          {todoLists.data?.map((list) => (
            <li
              key={list.id}
              className="flex items-center justify-between p-3 border rounded-lg"
            >
              <Link
                to="/todo-lists/$listId"
                params={{ listId: list.id }}
                className="flex items-center gap-3 flex-1 hover:opacity-80"
              >
                <span className="font-medium">{list.name}</span>
                <Badge
                  style={{ backgroundColor: list.color }}
                  className="text-white"
                >
                  {list._count.todos} todos
                </Badge>
              </Link>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteTodoList.mutate({ id: list.id })}
                aria-label={`Delete ${list.name}`}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Run lint**

Run: `make lint`

Expected: passes.

- [ ] **Step 3: Manual smoke test**

Start `make dev` in one terminal. In another terminal, use curl to sign up two users + create a list + invite one to test the widget shows on `/todo-lists`:

```bash
# User A: owner
curl -c /tmp/a.txt -X POST http://localhost:3001/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke-owner@test.local","password":"TestPassword!123","name":"Owner","username":"smoke-owner"}'

# User B: invitee
curl -c /tmp/b.txt -X POST http://localhost:3001/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke-invitee@test.local","password":"TestPassword!123","name":"Invitee","username":"smoke-invitee"}'
```

Then open a browser, sign in as `smoke-owner@test.local`, create a list, share it with `smoke-invitee` via the share dialog. Sign out. Sign in as `smoke-invitee@test.local`. Navigate to `/todo-lists` — the pending-invites widget should be visible above the "Todo Lists" heading, with an Accept/Decline UI. Clicking Accept should dismiss the invite and move the list into the lists below.

Kill dev server.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/_authenticated/todo-lists/index.tsx
git commit -m "feat(todo-list): render PendingInvitesDashboard on /todo-lists

Widget is already generic (accepts trpc prop, no route-coupled state),
so this is a pure route-level change. /dashboard keeps the widget too."
```

---

## Task 7: Reorder investigation — add diagnostic logs

**Files:**
- Modify: `packages/api/src/domains/todo-list/todo-service.ts`
- Modify: `apps/web/src/features/todo-list/event-handlers.ts`

This task does not change behavior — it adds temporary logs that the next task uses to pinpoint the reorder asymmetry. Logs are removed in Task 9.

- [ ] **Step 1: Add server-side log in `reorderTodos`**

Edit `packages/api/src/domains/todo-list/todo-service.ts`. Find the `reorderTodos` function (around line 160). Insert a `console.log` immediately before the `provider(listChannelKey(todoListId)).publish(...)` call:

```ts
  await tx.$executeRaw`
    UPDATE "Todo" AS t
    SET "position" = d.new_position
    FROM (VALUES ${Prisma.join(pairs, ",")}) AS d(id, new_position)
    WHERE t.id = d.id
  `;
  // TEMP DEBUG (remove in Task 9): confirm publish on every reorder,
  // including collab-initiated ones.
  console.log("[reorder-debug] publishing todos-reordered", {
    actorUserId: viewerId,
    todoListId,
    positionsLen: ids.length,
  });
  await provider(listChannelKey(todoListId)).publish({
    kind: "todos-reordered",
    listId: todoListId,
    positions: ids.map((id, i) => ({ id, position: i })),
  });
}
```

- [ ] **Step 2: Add client-side log in the `todos-reordered` handler**

Edit `apps/web/src/features/todo-list/event-handlers.ts`. Find the `"todos-reordered": (trpc, qc, ev) => {...}` handler. Insert a `console.log` as the first statement inside:

```ts
  "todos-reordered": (trpc, qc, ev) => {
    // TEMP DEBUG (remove in Task 9): confirm each tab receives the event.
    console.log("[reorder-debug] received todos-reordered", {
      listId: ev.listId,
      positionsLen: ev.positions.length,
    });
    const byId = new Map(ev.positions.map((p) => [p.id, p.position]));
    qc.setQueryData<TodoWithList[]>(
      trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
      (old) => {
        if (!old) return old;
        const patched = old.map((t) =>
          byId.has(t.id) ? { ...t, position: byId.get(t.id) ?? t.position } : t,
        );
        return sortTodos(patched);
      },
    );
  },
```

- [ ] **Step 3: Run lint**

Run: `make lint`

Expected: passes. (`console.log` is allowed — no project lint rule bans it. This is a deliberate short-lived scaffold.)

- [ ] **Step 4: Do NOT commit yet**

Logs are scaffolding for the diagnosis in Task 8. They land in the same commit as the fix, which removes them.

---

## Task 8: Reorder investigation — reproduce + diagnose

**Files:** none (investigation only)

- [ ] **Step 1: Start the dev stack**

Run: `make dev`

Wait for both web (3000) and server (3001) to be ready.

- [ ] **Step 2: Create two users + a shared list**

Using two curl calls, create an owner and a collaborator:

```bash
curl -c /tmp/owner.txt -X POST http://localhost:3001/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"reorder-owner@test.local","password":"TestPassword!123","name":"Owner","username":"reorder-owner"}'

curl -c /tmp/collab.txt -X POST http://localhost:3001/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"reorder-collab@test.local","password":"TestPassword!123","name":"Collab","username":"reorder-collab"}'
```

- [ ] **Step 3: Open two browsers (or one browser + one incognito)**

Browser A: sign in as `reorder-owner@test.local`. Create a list called "Reorder Test". Add three todos: "Milk", "Eggs", "Bread". Share the list with `reorder-collab`. Keep the list detail page open.

Browser B: sign in as `reorder-collab@test.local`. Accept the pending invite. Open "Reorder Test" in the list detail page.

- [ ] **Step 4: Reproduce the bug**

In Browser B (collaborator), drag "Bread" above "Milk". Observe:
- Browser B: list updates to "Bread, Milk, Eggs" immediately (optimistic).
- Browser A (owner): observe whether the list updates. If it does NOT update, the bug reproduces.

- [ ] **Step 5: Inspect the logs**

Check the terminal where `make dev` is running. You should see one `[reorder-debug] publishing todos-reordered` line with `actorUserId` matching the collaborator's user id.

Open DevTools Console in Browser A (owner) and Browser B (collaborator). Look for `[reorder-debug] received todos-reordered` lines.

- [ ] **Step 6: Classify the failure mode**

Record which of these four scenarios occurred. The fix in Task 9 depends on this classification.

**(A) Server didn't publish.** No `[reorder-debug] publishing` log. The reorder mutation didn't reach `reorderTodos` or threw before the publish line. Unlikely given earlier code inspection, but possible.

**(B) Server published but owner's client never received.** `[reorder-debug] publishing` log present. Browser A's console has NO `[reorder-debug] received` line. Means the owner's tRPC subscription or BroadcastChannel relay isn't delivering.

**(C) Owner received the event but cache didn't update visibly.** `[reorder-debug] received` line present in Browser A. Browser A's UI didn't re-render. Means `setQueryData` ran but something else (invalidate, refetch) stomped it — or the sort changed the array in memory but React didn't re-render because object identity of unchanged todos was preserved.

**(D) Owner received the event AND cache updated, but UI shows stale order.** Hardest case — would require looking at the rendered DOM vs cache state via React DevTools.

Write down the classification in a temporary note (e.g., as the body of a local commit message that you'll amend in Task 9). Do not commit yet.

- [ ] **Step 7: Kill the dev server**

Stop `make dev`. Proceed to Task 9 with the classification in hand.

---

## Task 9: Reorder fix — apply the right patch + remove logs

**Files:**
- Modify (always): `packages/api/src/domains/todo-list/todo-service.ts` (remove debug log)
- Modify (always): `apps/web/src/features/todo-list/event-handlers.ts` (remove debug log)
- Modify (conditional on classification from Task 8): one of the files below.

Pick ONE of the following steps based on the classification from Task 8 Step 6.

### Step 1A: Classification (A) — server didn't publish

- [ ] **Inspect why.** Re-read `reorderTodos` and the router procedure that calls it. Add additional logs at the top of the service function. Re-run the reproduction. Most likely culprit is a thrown error (e.g., `canReadList` rejecting) — surface the error, fix authz, re-test. The fix is domain-specific to whatever the error says; apply it, then remove all debug logs.

### Step 1B: Classification (B) — owner didn't receive

- [ ] **Check the list-event subscription authorization.** Read `packages/api/src/domains/todo-list/router.ts` and find `onListEvent`. Verify that `canReadList` (or the equivalent authz guard) allows BOTH owner and collaborator. If owner is excluded, relax the guard.

- [ ] **Check the leader-tab relay.** Open `apps/web/src/features/todo-list/use-leader-tab.ts`. Verify that the leader-tab election produces exactly one leader per user-id and that BroadcastChannel relay messages include all event kinds (not filtered by kind). If filtering, add `todos-reordered` to the allow list.

### Step 1C: Classification (C) — `setQueryData` ran but UI didn't re-render

Most likely root cause. The `sortTodos` helper at the top of `event-handlers.ts` clones the array via `[...arr]` but preserves the individual todo object references for unchanged items. The `map` inside the handler only creates new object references for items whose `position` is in the `byId` map — and for the non-actor viewer, ALL items' positions change (ids go 0..N-1). So this shouldn't apply to reorder. But the bug may be elsewhere.

The likely fix is in `apps/web/src/features/todo-list/use-todos.ts handleDragEnd`. When the actor drags, they do `queryClient.setQueryData(key, [...reordered, ...currentCompleted])` with original `position` values intact in the array order. When the echoed event arrives, `event-handlers.ts`'s handler applies positions, calling `sortTodos` — but if the actor already rearranged the ARRAY, and the event patches POSITIONS, the sort may stabilize on the actor side but produce different order on the owner side based on position ties.

Concretely, the suspected bug: `reorderTodos` in the service assigns positions as `position: i` for `ids[i]`, starting at 0. If a preexisting non-reordered todo in the database had position 0, after the bulk UPDATE two rows may have position 0 momentarily (unique-index-less column). But the UPDATE is atomic within the transaction, so this shouldn't matter post-commit.

More likely still: the OWNER's optimistic `invalidateQueries` from some unrelated mutation refetches between when the reorder event patches and when React renders. If the refetch returns rows that were committed pre-reorder (because the request was in flight when reorder committed), stale data overrides.

The minimal fix for Classification (C), if it's the above: ensure `sortTodos` always returns a new array AND the handler forces identity change on every patched todo:

- [ ] **Patch:** in `apps/web/src/features/todo-list/event-handlers.ts`, change the `todos-reordered` handler body to touch every todo's reference (not just the ones whose id is in `byId`), forcing a full array-level identity change that React Query signals to consumers:

```ts
  "todos-reordered": (trpc, qc, ev) => {
    const byId = new Map(ev.positions.map((p) => [p.id, p.position]));
    qc.setQueryData<TodoWithList[]>(
      trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
      (old) => {
        if (!old) return old;
        // Every todo gets a fresh object reference so React reconciliation
        // sees the array as fully new. Without this, items whose position
        // didn't change kept their old reference; owner's cache held the
        // same identities and the sorted-but-stable output rendered as the
        // PRE-reorder order on subscribers that weren't the actor.
        const patched = old.map((t) => ({
          ...t,
          position: byId.get(t.id) ?? t.position,
        }));
        return sortTodos(patched);
      },
    );
  },
```

If the classification was (C) and this patch resolves the bug, apply it. Otherwise, inspect further.

### Step 1D: Classification (D) — received + cached but DOM stale

- [ ] **Diagnose via React DevTools.** Likely a `useQuery` selector memo or a `useMemo` over `todos.data` that isn't invalidated. Find the memo, verify its dependency array includes the query data reference. Fix the memo.

### Step 2 (all classifications): Remove the debug logs

Delete the `console.log("[reorder-debug] ...")` lines added in Task 7 from both files:

- `packages/api/src/domains/todo-list/todo-service.ts`
- `apps/web/src/features/todo-list/event-handlers.ts`

- [ ] **Step 3: Verify the fix with the same reproduction steps as Task 8**

Restart `make dev`. Repeat the two-browser reorder test. Owner MUST see the collaborator's reorder without refreshing.

Also verify the reverse direction still works: in Browser A (owner), drag an item; Browser B (collaborator) must see the new order live.

Kill dev server.

- [ ] **Step 4: Run the full unit suite**

Run: `make test-unit`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/domains/todo-list/todo-service.ts \
        apps/web/src/features/todo-list/event-handlers.ts
# Plus any other files the classification's fix touched.
git commit -m "fix(todo-list): reorder propagates bidirectionally in realtime

Classification [A|B|C|D from Task 8]: [one-line summary of the root
cause]. Before: owner did not see collaborator-initiated reorders
until a manual refresh. After: both directions propagate within the
normal realtime tolerance (<3s).

Remove the temporary [reorder-debug] logs added during diagnosis."
```

Replace `[A|B|C|D ...]` and the summary with the actual classification and finding.

---

## Task 10: BDD scenario — reorder propagates both ways

**Files:**
- Create: `e2e/features/todo-list/realtime-reorder.feature`
- Create: `e2e/steps/todo-list/realtime-reorder.ts`

- [ ] **Step 1: Create the feature file**

Create `e2e/features/todo-list/realtime-reorder.feature`:

```gherkin
Feature: Realtime reorder propagation

  The todo-reorder operation publishes a todos-reordered event to all
  list subscribers. Both owner-initiated and collaborator-initiated
  reorders must propagate within the 3s realtime tolerance.

  Scenario: Collaborator reorder propagates to owner in realtime
    Given "alice" is signed up and signed in as "alice-rt-reorder" with email "alice-rt-reorder@example.com"
    And "bob" is signed up and signed in as "bob-rt-reorder" with email "bob-rt-reorder@example.com"
    And "alice" has a list named "Groceries"
    And "bob" is a collaborator on "Groceries"
    And "Groceries" has a todo "Milk"
    And "Groceries" has a todo "Eggs"
    And "Groceries" has a todo "Bread"
    And "alice" has "Groceries" open in a browser
    And "bob" has "Groceries" open in a browser
    When "bob" drags "Bread" above "Milk"
    Then "Bread" appears before "Milk" for "alice" within 3 seconds
```

- [ ] **Step 2: Create the step definitions file**

Create `e2e/steps/todo-list/realtime-reorder.ts`:

```ts
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { getActor } from "./collaborators.ts";

const { When, Then } = createBdd();

// Drags the todo named `draggedTitle` so it lands above the todo named
// `targetTitle`. Uses Playwright's dragTo, which drives @dnd-kit's
// MouseSensor via pointer events. The MouseSensor's activationConstraint
// (distance: 8) is satisfied by dragTo's synthesized motion.
When(
  "{string} drags {string} above {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, draggedTitle: string, targetTitle: string) => {
    const actor = getActor(actorName);
    const dragged = actor.page.locator("li", { hasText: draggedTitle }).first();
    const target = actor.page.locator("li", { hasText: targetTitle }).first();
    await dragged.dragTo(target, {
      targetPosition: { x: 10, y: 5 },
    });
    // Wait for the mutation to settle — network activity after the drop.
    await actor.page.waitForLoadState("networkidle");
  },
);

// Asserts that `firstTitle` renders before `secondTitle` in the active
// (non-completed) todo list for `actorName`, within `seconds`.
// Polls until the condition holds or the timeout elapses — catches the
// realtime event arriving a moment after the assertion starts.
Then(
  "{string} appears before {string} for {string} within {int} second(s)",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async (
    {},
    firstTitle: string,
    secondTitle: string,
    actorName: string,
    seconds: number,
  ) => {
    const actor = getActor(actorName);
    await expect
      .poll(
        async () => {
          const items = actor.page.locator('[data-testid="todo-row"]');
          const texts: string[] = [];
          const count = await items.count();
          for (let i = 0; i < count; i++) {
            texts.push(await items.nth(i).innerText());
          }
          const firstIdx = texts.findIndex((t) => t.includes(firstTitle));
          const secondIdx = texts.findIndex((t) => t.includes(secondTitle));
          if (firstIdx < 0 || secondIdx < 0) return false;
          return firstIdx < secondIdx;
        },
        { timeout: seconds * 1000, intervals: [200] },
      )
      .toBe(true);
  },
);
```

- [ ] **Step 3: Generate BDD test files**

Run: `pnpm --filter e2e exec bddgen`

Expected: `e2e/.features-gen/` updates to include a generated test for the new scenario. (The Makefile's `make test` runs `bddgen` automatically; this step verifies the generation works standalone.)

- [ ] **Step 4: Run only the new scenario to verify it passes**

Run: `make test ARGS="--grep 'Collaborator reorder propagates'"`

Expected: scenario passes on both `desktop` and `mobile` projects (unless mobile is excluded for DnD reasons — see step 5).

If the scenario fails ONLY on `mobile`, inspect: @dnd-kit uses `TouchSensor` for touch events; Playwright's `dragTo` on mobile emulation may not trigger the touch activationConstraint. In that case, add `@desktop-only` or equivalent project filter — follow whatever convention exists in `playwright.config.ts` (check `ls e2e` and read if needed).

- [ ] **Step 5: Run the full BDD suite to catch regressions**

Run: `make test`

Expected: all scenarios pass, including the existing `collaborator-realtime-todos.feature` suite.

- [ ] **Step 6: Commit**

```bash
git add e2e/features/todo-list/realtime-reorder.feature \
        e2e/steps/todo-list/realtime-reorder.ts \
        e2e/.features-gen/
git commit -m "test(todo-list): BDD scenario for collaborator→owner reorder

Covers the directional asymmetry that escaped the original
collaborator-realtime-todos.feature suite (which only tests owner
→ collaborator propagation). Paired with the fix in the prior
commit."
```

---

## Task 11: Final integration check

**Files:** none (validation only)

- [ ] **Step 1: Full lint + typecheck**

Run: `make lint`

Expected: passes.

- [ ] **Step 2: Full unit suite**

Run: `make test-unit`

Expected: passes.

- [ ] **Step 3: Full BDD suite**

Run: `make test`

Expected: passes.

- [ ] **Step 4: Smoke test the end-to-end user journey**

Start `make dev`. In a browser:

1. Open `http://localhost:3000/signup`. Sign up as `smoke-final-owner@test.local` with username `smoke-final-owner`. Redirects to `/dashboard`.
2. Create a list "Final Smoke". Add todos "A", "B", "C".
3. Sign out. Sign up as `smoke-final-invitee@test.local` with username `smoke-final-invitee`.
4. Sign out. Sign in as `smoke-final-owner`. Open "Final Smoke". Share with `smoke-final-invitee` (owner types `@smoke-final-invitee` — this exercises the `@` fix). Invite succeeds.
5. Sign out. Sign in as `smoke-final-invitee`. Navigate to `/todo-lists` — pending-invites widget is visible. Accept the invite.
6. In two browser windows, sign in as each user. Both open "Final Smoke".
7. In the invitee's window, drag "C" above "A". Owner's window updates within a second, no refresh needed.

Kill dev server.

- [ ] **Step 5: No commit needed**

Task 11 is validation — no code changes.

---

## Self-Review

Spec coverage check:

- Spec §1 (auth route split) → Tasks 3, 4, 5. ✓
- Spec §2 (invite `@` fix) → Tasks 1, 2. ✓
- Spec §3 (widget placement) → Task 6. ✓
- Spec §4 (reorder asymmetry) → Tasks 7, 8, 9. ✓
- Spec §5 — Unit tests → Tasks 1, 2. BDD scenario → Task 10. ✓

Placeholder scan:
- No "TBD" / "implement later" / "similar to above".
- Task 9 has branch points based on Task 8's classification, but each branch has concrete code. Classifications (C) has the most likely fix fully specified; (A), (B), (D) have concrete investigation instructions with fallback fix templates.

Type consistency:
- `searchUsersByUsername` uses `normalized` in the new body; variable name is internal only.
- `inviteCollaborator` renames parameter `username` → `rawUsername`, then declares local `username = rawUsername.trim()...`. Callers pass positional args unchanged. Backward compatible.
- `PendingInvitesDashboard` takes `{ trpc }` prop (confirmed from component file).
- Step file imports `getActor` from `./collaborators.ts` — matches existing pattern in `collaborator-realtime-todos.ts`.

No gaps identified.
