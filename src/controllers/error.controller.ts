import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import AppError from "../utils/appError.js";
import { logger } from "../utils/logger.js";

type ErrorWithDetails = Error & {
  statusCode?: number;
  status?: string;
  isOperational?: boolean;
  keyValue?: Record<string, unknown>;
  errorResponse?: { code?: number };
  path?: string;
  value?: unknown;
};

const normalizeError = (err: unknown): ErrorWithDetails => {
  if (err instanceof Error) return err;
  return new Error(String(err));
};

const handleDuplicateFieldDB = (err: ErrorWithDetails) => {
  const [key = "field"] = Object.keys(err.keyValue ?? {});
  const [value = "value"] = Object.values(err.keyValue ?? {});
  const message = `A record with ${key}:${String(value)} already exists`;

  return new AppError(message, 400);
};

const handleValidationErrorDB = (err: ErrorWithDetails) =>
  new AppError(err.message, 400);

const handleCastErrorDB = (err: ErrorWithDetails) =>
  new AppError(`Invalid ${err.path ?? "field"}: ${String(err.value)}`, 400);

const handleJsonWebTokenError = () =>
  new AppError("Invalid token! Please login again.", 401);

const handleJwtTokenExpiredError = () =>
  new AppError("Session timeout, please login again", 401);

const sendErrorDev = (err: ErrorWithDetails, res: Response) => {
  const statusCode = err.statusCode ?? 500;

  res.status(statusCode).json({
    status: err.status,
    error: err,
    message: err.message,
    stack: err.stack,
  });
};

const sendErrorProd = (err: ErrorWithDetails, res: Response) => {
  const statusCode = err.statusCode ?? 500;

  if (err.isOperational) {
    res.status(statusCode).json({
      status: err.status,
      message: err.message,
    });
  } else {
    res.status(500).json({
      status: "error",
      message: "Something went wrong!",
    });
  }
};

export default (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const originalError = normalizeError(err);
  originalError.statusCode = originalError.statusCode || 500;
  originalError.status = originalError.status || "error";

  req.log?.error({ err: originalError }, originalError.message);
  if (originalError.statusCode >= 500) {
    logger.error({ err: originalError }, "Unhandled application error");
  }

  if (env.nodeEnv === "development" || env.nodeEnv === "test") {
    sendErrorDev(originalError, res);
    return;
  }

  let error = Object.create(
    Object.getPrototypeOf(originalError),
    Object.getOwnPropertyDescriptors(originalError),
  ) as ErrorWithDetails;

  if (error.name === "CastError") error = handleCastErrorDB(error);
  if (error.name === "ValidationError") error = handleValidationErrorDB(error);
  if (error.errorResponse?.code === 11000 || error.keyValue)
    error = handleDuplicateFieldDB(error);
  if (error.name === "JsonWebTokenError") error = handleJsonWebTokenError();
  if (error.name === "TokenExpiredError") error = handleJwtTokenExpiredError();

  sendErrorProd(error, res);
};
