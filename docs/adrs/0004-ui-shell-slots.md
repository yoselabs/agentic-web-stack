---
title: "ADR-0004 — UI shell components take typed slots, never `children`"
status: accepted
date: 2026-04-21
deciders: [denis]
verified_by:
  - apps/web/src/widgets/navbar.tsx
  - apps/web/src/widgets/mobile-nav.tsx
  - apps/web/src/widgets/app-shell.tsx
---

# ADR-0004 — UI shell components take typed slots, never `children`

## Context and problem statement

In Pitch 5A a notifications-badge widget shipped correctly as a component
but was mounted one layer above the `Navbar` instead of inside it. The
feature spec was prose, the component existed, the tests asserted
visibility — yet the badge never rendered because the shell composition
was wrong. Nothing in the type system, the linter, or the test suite
complained: the `Navbar` accepted `children` freely, so "no badge"
looked identical to "correct composition".

This ADR establishes the enforcement pattern for every top-level UI
shell going forward so the same class of bug cannot recur.

## Decision drivers

- **Documented = checked.** The prevention-foundation design principle
  (`docs/superpowers/specs/2026-04-21-template-prevention-foundation-design.md`
  §1) requires every invariant the template relies on to be enforced by
  types, Grit, a script, or a test harness. A shell's composition is
  exactly such an invariant.
- **Fail at `tsc -b`, not at review time.** The bug survived code review
  because the call site looked plausible. We need the compiler to
  reject the incomplete call.
- **No runtime cost.** Slots are a type-level convention; the runtime
  JSX is unchanged.

## Considered options

1. **Status quo — `children` + prose specs + visibility tests.** Rejected:
   exactly the configuration that produced the Pitch-5A regression.
2. **Required named props per affordance** (`<Navbar logo={...}
   notifications={...} user={...} />`). Viable but clutters the
   prop surface with many siblings; hard to distinguish the slot contract
   from component configuration (e.g. `variant`).
3. **Single required `slots: { key: ReactNode }` prop with a typed
   shape.** **Chosen.** One discriminated object means every affordance
   is a named key; omitting one is a `tsc -b` error; the prop surface
   stays organised (`slots` for composition, top-level props for
   configuration); refactors to add a new affordance are a single
   type-edit + N call-site updates that the compiler lists for you.

## Decision

Every top-level UI shell in `apps/web/src/widgets/` takes a **required**
`slots: Slots` prop where `Slots` is a named type listing each
affordance as a typed key:

```tsx
export type NavbarSlots = {
  logo: ReactNode;
  primaryLinks: ReactNode;
  notifications?: ReactNode; // role-gated → optional
  adminActions?: ReactNode;
  user: ReactNode;
  mobileNav: ReactNode;
};

export function Navbar({ slots }: { slots: NavbarSlots }) {
  return (
    <nav>
      {slots.logo}
      {slots.primaryLinks}
      {slots.notifications}
      {slots.adminActions}
      {slots.user}
      {slots.mobileNav}
    </nav>
  );
}
```

Rules:

1. **No `children`.** Even a shell that logically has "the main
   content" declares it as a typed slot (e.g. `main: ReactNode` in
   `AppShell`), not via `children`. This is the key preservation: an
   anonymous escape hatch defeats the whole pattern.
2. **Required by default.** A slot is non-optional unless it is
   genuinely role-gated (admin-only link, feature-flagged banner). The
   test is "would a viewer in the default state see this?" — if yes,
   required.
3. **Role-gated slots are `?`-marked, not conditionally rendered inside
   the shell.** The shell is dumb; the call site decides visibility by
   omitting the key or supplying `undefined`.
4. **Composition glue lives next to the shell, not inside it.** Where
   session/feature-flag lookups select what to place in a slot, the
   assembler is a sibling component (`app-navbar.tsx` assembles the
   session-aware slot values and renders `<Navbar slots={...} />`).
   This keeps the shell storybookable with arbitrary slot content.

## Consequences

**Positive**

- Dropping a required affordance fails `tsc -b` across every call site.
- Adding a new affordance is a three-step change the compiler
  guarantees is complete: add the key to `Slots`, let `tsc` list the
  broken call sites, fix each.
- Shells are pure presentation — no `useSession`, no conditional
  `isAuthed` branches — which unlocks Storybook enumeration (WS5) and
  unit testing with arbitrary slot fixtures.

**Negative**

- Call sites are visibly more verbose: assembling the `slots` object
  inline is longer than `<Navbar />`. This verbosity is the point — the
  list of slots at the call site is the documentation and the audit
  surface.
- A new shell requires a companion "assembler" component whenever the
  slot content is session- or context-derived. This is one more file
  per shell but is a one-time cost per shell and clarifies the
  separation between composition and presentation.

**Neutral**

- Applies only to top-level shells (`widgets/` layer). Feature-level
  components (`features/`) continue to compose however their owning
  domain chooses; slots are not a universal rule.

## Verification

Enforced by TypeScript at every `<Navbar/>`, `<MobileNav/>`,
`<AppShell/>` call site. Omitting a required slot at the sole current
call site (`apps/web/src/routes/__root.tsx`) produces:

```
apps/web/src/routes/__root.tsx: error TS2741: Property 'main' is
missing in type '{ nav: JSX.Element; }' but required in type
'AppShellSlots'.
```

A `Sidebar` shell does not yet exist in this template. When one is
introduced it must follow the same pattern; the ADR remains the
binding reference.

The `verified_by:` files above each contain a `Slots` type and a
`{ slots }: { slots: Slots }` signature; future `scripts/check-adrs.ts`
(WS1) will confirm the links stay live.
