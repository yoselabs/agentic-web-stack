import { Layer } from "effect";
import { AuthLive } from "./auth-layer.js";
import { DbLive } from "./db-layer.js";
import { LoggerLive } from "./logger-layer.js";

// Composed application Layer. Provides Db, Auth, and Logger services to
// every Effect run via runEffect. Per-request services (CurrentSession)
// are layered on top by the tRPC context per call.
export const AppLayer = Layer.mergeAll(DbLive, AuthLive, LoggerLive);
