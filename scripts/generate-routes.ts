import path from "node:path";
import { Generator, getConfig } from "@tanstack/router-generator";

const webRoot = path.resolve(import.meta.dirname, "../apps/web");
const config = getConfig({}, webRoot);
const generator = new Generator({ config, root: webRoot });
await generator.run();
console.log("Route tree generated.");
