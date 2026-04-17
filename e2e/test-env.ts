import { testDbEnv } from "../scripts/test-db.ts";

const env = testDbEnv("e2e");
export const TEST_PORT = env.TEST_PORT;
export const TEST_CONTAINER = env.TEST_CONTAINER;
export const TEST_DATABASE_URL = env.TEST_DATABASE_URL;
export const PROJECT_ROOT = env.PROJECT_ROOT;
