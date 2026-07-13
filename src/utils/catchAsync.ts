import type { Request, Response, NextFunction } from "express";

const catchAsync =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      if (err instanceof Error) {
        next(err);
      } else {
        next(new Error(String(err)));
      }
    });
  };

export default catchAsync;
