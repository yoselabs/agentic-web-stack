// Stub. Real Mailer Live implementation lands in Day 4 commit 2.
// MailerService is declared in ./email-contract.ts; re-exported here
// so consumers can `import { MailerService } from "@project/email/service"`
// against either the stub-class form (now) or the live form (commit 2+).
// biome-ignore lint/performance/noBarrelFile: email-service.ts is the composition entry point for @project/email/service — re-exports MailerService from the contract as a deliberate subpath entry, not a barrel
export { MailerService } from "./email-contract.ts";
