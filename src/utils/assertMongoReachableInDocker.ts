import fs from "fs";
import { logger } from "./logger.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Inside Docker, `localhost` in DATABASE points at the container, not the host.
 * Fail fast with an actionable message instead of MongooseServerSelectionError.
 */
export function assertMongoReachableInDocker(databaseUri: string): void {
  if (!fs.existsSync("/.dockerenv")) return;

  let hostname: string;
  try {
    const normalized = databaseUri.replace(/^mongodb(\+srv)?:\/\//i, "http://");
    hostname = new URL(normalized).hostname.toLowerCase();
  } catch {
    return;
  }

  if (!LOOPBACK_HOSTS.has(hostname)) return;

  logger.fatal(
    [
      `DATABASE host "${hostname}" is loopback, but this process runs inside Docker.`,
      "localhost inside a container is not MongoDB on your machine.",
      "",
      "Use one of:",
      "  • Mongo on host (Docker Desktop): mongodb://host.docker.internal:27017/<dbname>",
      "  • Mongo in Compose: mongodb://mongo:27017/<dbname>  → npm run docker:dev",
      "  • Remote / Atlas: mongodb+srv://...",
      "",
      "Quick test after `docker build -t ping:test .`:",
      "  npm run docker:run:host-mongo",
    ].join("\n"),
  );
  process.exit(1);
}
