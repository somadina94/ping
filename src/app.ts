import express from "express";
import helmet from "helmet";
import ExpressMongoSanitize from "express-mongo-sanitize";
import hpp from "hpp";
import compression from "compression";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { randomUUID } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";

import { env } from "./config/env.js";
import globalErrorHandler from "./controllers/error.controller.js";
import AppError from "./utils/appError.js";
import { logger } from "./utils/logger.js";
import { healthRoutes } from "./routes/index.js";
import type { Request, Response, NextFunction } from "express";

const app = express();

app.set("trust proxy", env.trustProxy);

if (env.nodeEnv === "development") {
  app.use(morgan("dev"));
}

app.use(
  pinoHttp({
    logger,
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const existingId = req.headers["x-request-id"];
      const requestId = Array.isArray(existingId) ? existingId[0] : existingId;
      const id = requestId || randomUUID();
      res.setHeader("x-request-id", id);
      return id;
    },
  }),
);

app.use(helmet());
const corsOptions: cors.CorsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (!origin && env.nodeEnv !== "production") {
      callback(null, true);
      return;
    }

    if (origin && env.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new AppError("Not allowed by CORS", 403));
  },
};
app.use(cors(corsOptions));
app.use(hpp());

const limiter = rateLimit({
  max: env.rateLimitMax,
  windowMs: env.rateLimitWindowMs,
  message: "Too many requests from this IP, please try again in an hour!",
});
app.use("/api", limiter);

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(cookieParser());
// Express 5: `req.query` is getter-only — do not use `express-mongo-sanitize()` middleware
// because it assigns to `req.query`. Sanitize mutable request fields directly.
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    ExpressMongoSanitize.sanitize(req.body as Record<string, unknown>);
  }
  if (req.params && typeof req.params === "object") {
    ExpressMongoSanitize.sanitize(req.params as Record<string, unknown>);
  }
  next();
});

app.use(compression());

app.use((req: Request, _res: Response, next: NextFunction) => {
  req.requestTime = new Date().toISOString();
  next();
});

app.use("/api/v1/health", healthRoutes);

app.use((req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(globalErrorHandler);

export default app;
