import { router } from "./trpc.js";

// ADR-0012 — composed app router. Domains added per Phase 3 / Phase 4
// capability walk; todo-list lands first (step 5 of the Phase 3 plan).
export const appRouter = router({});

export type AppRouter = typeof appRouter;
