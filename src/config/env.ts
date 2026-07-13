import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { z } from "zod";

/** Always load the project `.env` regardless of process cwd. */
const envDir = path.dirname(fileURLToPath(import.meta.url));
const dotenvResult = dotenv.config({
  path: path.resolve(envDir, "../../.env"),
  quiet: true,
});

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().trim().optional());

const numberFromEnv = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? fallback : Number(value)),
    z.number().int().positive(),
  );

const booleanFromEnv = (fallback: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") return fallback;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.toLowerCase() === "true";
    return value;
  }, z.boolean());

const rawEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("development"),
  PORT: numberFromEnv(3000),
  DATABASE: optionalString,
  DATABASE_PASSWORD: optionalString,
  JWT_SECRET: optionalString,
  JWT_EXPIRES_IN: z.string().trim().default("90d"),
  JWT_COOKIE_EXPIRES_IN: numberFromEnv(90),
  API_URL: z.string().trim().url().default("http://localhost:3000"),
  FRONTEND_URL: z.string().trim().url().default("http://localhost:3000"),
  CORS_ORIGINS: optionalString,
  TRUST_PROXY: booleanFromEnv(false),
  RATE_LIMIT_WINDOW_MS: numberFromEnv(60 * 60 * 1000),
  RATE_LIMIT_MAX: numberFromEnv(1000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  /** Requires devDependency `pino-pretty`; keep false in production Docker images. */
  LOG_PRETTY: booleanFromEnv(false),
  COMPANY_NAME: z.string().trim().default("PING"),
  EMAIL_HOST: optionalString,
  EMAIL_PORT: numberFromEnv(587),
  EMAIL_SECURE: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  EMAIL_REQUIRE_TLS: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  EMAIL_TLS_REJECT_UNAUTHORIZED: z.preprocess(
    emptyToUndefined,
    z.string().trim().optional(),
  ),
  EMAIL_ADDRESS: optionalString,
  EMAIL_PASSWORD: optionalString,
  EMAIL_FROM: optionalString,
  MONITOR_ENABLED: booleanFromEnv(true),
  MONITOR_URL: z.string().trim().url().default("https://api.jahbyte.com/api/v1/health"),
  /** Cron expression; default is every quarter-hour (:00, :15, :30, :45). */
  MONITOR_CRON: z.string().trim().default("*/2 * * * *"),
  MONITOR_CRON_TIMEZONE: optionalString,
  MONITOR_TIMEOUT_MS: numberFromEnv(10_000),
  MONITOR_FAILURE_THRESHOLD: numberFromEnv(3),
  MONITOR_ALERT_COOLDOWN_MS: numberFromEnv(900_000),
  ALERT_EMAIL: optionalString,
});

const rawEnv = rawEnvSchema.safeParse(process.env);

if (!rawEnv.success) {
  console.error("Invalid environment configuration");
  console.error(z.prettifyError(rawEnv.error));
  process.exit(1);
}

const parsed = rawEnv.data;
const isProductionLike =
  parsed.NODE_ENV === "production" || parsed.NODE_ENV === "staging";
const productionErrors: string[] = [];
const trackedEnvKeys = Object.keys(rawEnvSchema.shape);

if (parsed.NODE_ENV !== "production") {
  const configuredEnvCount = trackedEnvKeys.filter((key) => {
    const value = process.env[key];
    return value !== undefined && value.trim() !== "";
  }).length;
  const parsedFileCount = dotenvResult.parsed
    ? Object.keys(dotenvResult.parsed).length
    : 0;

  console.log(
    `Loaded ${configuredEnvCount} configured env vars (${parsedFileCount} from .env file)`,
  );
}

if (isProductionLike && !parsed.DATABASE) {
  productionErrors.push("DATABASE is required in production/staging.");
}

if (isProductionLike && (!parsed.JWT_SECRET || parsed.JWT_SECRET.length < 32)) {
  productionErrors.push(
    "JWT_SECRET must be at least 32 characters in production/staging.",
  );
}

if (isProductionLike && parsed.FRONTEND_URL.includes("localhost")) {
  productionErrors.push(
    "FRONTEND_URL must not point at localhost in production/staging.",
  );
}

if (parsed.MONITOR_ENABLED && !parsed.ALERT_EMAIL && parsed.NODE_ENV !== "test") {
  productionErrors.push("ALERT_EMAIL is required when MONITOR_ENABLED is true.");
}

if (productionErrors.length > 0) {
  console.error("Invalid environment configuration");
  for (const error of productionErrors) console.error(`- ${error}`);
  process.exit(1);
}

const parseOptionalBoolean = (value: string | undefined, fallback?: boolean) => {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
};

const corsOrigins = (parsed.CORS_ORIGINS ?? parsed.FRONTEND_URL)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const env = {
  nodeEnv: parsed.NODE_ENV,
  port: parsed.PORT,

  database: parsed.DATABASE ?? "mongodb://localhost:27017/ping",
  databasePassword: parsed.DATABASE_PASSWORD ?? "",

  jwtSecret: parsed.JWT_SECRET ?? "development-jwt-secret-change-me",
  jwtExpiresIn: parsed.JWT_EXPIRES_IN,
  jwtCookieExpiresIn: parsed.JWT_COOKIE_EXPIRES_IN,

  apiUrl: parsed.API_URL,
  frontendUrl: parsed.FRONTEND_URL,
  corsOrigins,
  trustProxy: parsed.TRUST_PROXY,
  rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
  rateLimitMax: parsed.RATE_LIMIT_MAX,
  logLevel: parsed.LOG_LEVEL,
  logPretty: parsed.LOG_PRETTY,
  companyName: parsed.COMPANY_NAME,

  emailHost: parsed.EMAIL_HOST ?? "",
  emailPort: parsed.EMAIL_PORT,
  emailSecure: parseOptionalBoolean(parsed.EMAIL_SECURE),
  emailRequireTls: parseOptionalBoolean(parsed.EMAIL_REQUIRE_TLS, false),
  emailTlsRejectUnauthorized: parseOptionalBoolean(
    parsed.EMAIL_TLS_REJECT_UNAUTHORIZED,
    true,
  ),
  emailAddress: parsed.EMAIL_ADDRESS ?? "",
  emailPassword: parsed.EMAIL_PASSWORD ?? "",
  emailFrom: parsed.EMAIL_FROM,

  monitorEnabled: parsed.MONITOR_ENABLED,
  monitorUrl: parsed.MONITOR_URL,
  monitorCron: parsed.MONITOR_CRON,
  monitorCronTimezone: parsed.MONITOR_CRON_TIMEZONE ?? "",
  monitorTimeoutMs: parsed.MONITOR_TIMEOUT_MS,
  monitorFailureThreshold: parsed.MONITOR_FAILURE_THRESHOLD,
  monitorAlertCooldownMs: parsed.MONITOR_ALERT_COOLDOWN_MS,
  alertEmail: parsed.ALERT_EMAIL ?? "",
} as const;
