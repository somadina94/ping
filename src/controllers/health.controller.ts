import type { Request, Response } from "express";
import mongoose from "mongoose";
import catchAsync from "../utils/catchAsync.js";

export const liveCheck = catchAsync(async (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    checks: {
      process: "up",
    },
  });
});

export const readyCheck = catchAsync(async (_req: Request, res: Response) => {
  const isMongoReady = mongoose.connection.readyState === 1;

  res.status(isMongoReady ? 200 : 503).json({
    status: isMongoReady ? "ok" : "unavailable",
    checks: {
      mongo: isMongoReady ? "up" : "down",
    },
  });
});
