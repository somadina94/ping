import type { Server } from "http";
import mongoose from "mongoose";
import { env } from "./config/env.js";
import { assertMongoReachableInDocker } from "./utils/assertMongoReachableInDocker.js";
import { logMongoConnectionHints } from "./utils/mongoConnectionHints.js";
import { logger } from "./utils/logger.js";
import { startMonitor, stopMonitor } from "./services/monitor.js";
import app from "./app.js";

const port = env.port;

let databaseUri = env.database;
if (env.databasePassword) {
  databaseUri = databaseUri
    .replace(/<password>/gi, env.databasePassword)
    .replace(/<PASSWORD>/gi, env.databasePassword);
}

assertMongoReachableInDocker(databaseUri);

let server: Server | undefined;

const connectDB = async () => {
  await mongoose.connect(databaseUri);
  if (mongoose.connection.readyState === 1) {
    logger.info("MongoDB connected");
  }
};

const closeServer = async (signal: string, exitCode = 0) => {
  logger.info({ signal }, "Shutting down gracefully");
  stopMonitor();

  await new Promise<void>((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    server.close(() => resolve());
  });

  await mongoose.connection.close(false);
  process.exit(exitCode);
};

const startServer = async () => {
  try {
    await connectDB();
    server = app.listen(port, () => {
      logger.info({ port }, "PING API listening");
      startMonitor();
    });
  } catch (err) {
    logMongoConnectionHints(err, databaseUri);
    logger.fatal({ err }, "Failed to start server");
    process.exit(1);
  }
};

void startServer();

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "UNHANDLED REJECTION");
  void closeServer("unhandledRejection", 1);
});

process.on("SIGTERM", () => {
  void closeServer("SIGTERM");
});

process.on("SIGINT", () => {
  void closeServer("SIGINT");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "UNCAUGHT EXCEPTION");
  void closeServer("uncaughtException", 1);
});
