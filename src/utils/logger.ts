import pino from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.nodeEnv === "test" ? "silent" : env.logLevel,
  base: {
    service: "ping",
    environment: env.nodeEnv,
  },
  transport: env.logPretty
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
        },
      }
    : undefined,
});
