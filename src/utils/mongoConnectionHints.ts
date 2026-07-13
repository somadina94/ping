import fs from "fs";
import mongoose from "mongoose";
import { logger } from "./logger.js";

/** Extra context when Mongoose cannot reach MongoDB from inside Docker. */
export function logMongoConnectionHints(err: unknown, databaseUri: string): void {
  if (!(err instanceof mongoose.Error.MongooseServerSelectionError)) return;
  if (!fs.existsSync("/.dockerenv")) return;

  const uriLower = databaseUri.toLowerCase();
  const targetsDockerHostAlias = uriLower.includes("host.docker.internal");

  logger.fatal(
    [
      "MongoDB server selection failed inside Docker.",
      "",
      "Development — use the bundled MongoDB image and volume:",
      "  npm run docker:dev",
      "",
      "Production — use your real cluster URI on the server (.env or secrets):",
      "  DATABASE=mongodb+srv://USER:<password>@cluster.mongodb.net/dbname",
      "  DATABASE_PASSWORD=...   # optional if you use <password> placeholder",
      "",
      targetsDockerHostAlias
        ? "`host.docker.internal` only works when MongoDB is running on your machine and accepting connections on that port. For Docker-only Mongo, use npm run docker:dev."
        : "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  );
}
