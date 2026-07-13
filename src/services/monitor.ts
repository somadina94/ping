import cron, { type ScheduledTask } from "node-cron";
import { env } from "../config/env.js";
import { isEmailConfigured, sendTemplatedMail } from "../utils/email.js";
import { logger } from "../utils/logger.js";

export type ProbeResult = {
  ok: boolean;
  reason?: string;
  statusCode?: number;
};

type MonitorMailTemplate = "monitorAlert" | "monitorRecovery" | "monitorDeploy";

type MonitorDeps = {
  fetchFn?: typeof fetch;
  sendAlert?: (params: {
    template: MonitorMailTemplate;
    subject: string;
    locals: Record<string, unknown>;
  }) => Promise<void>;
  now?: () => number;
};

let cronTask: ScheduledTask | undefined;
let consecutiveFailures = 0;
let lastAlertSentAt = 0;
let alertedWhileDown = false;
let checkInFlight = false;

export function resetMonitorState(): void {
  consecutiveFailures = 0;
  lastAlertSentAt = 0;
  alertedWhileDown = false;
  checkInFlight = false;
}

export async function probeHealthUrl(
  url: string,
  timeoutMs: number,
  fetchFn: typeof fetch = fetch,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return {
        ok: false,
        reason: `HTTP ${response.status}`,
        statusCode: response.status,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        ok: false,
        reason: "Invalid JSON response",
        statusCode: response.status,
      };
    }

    const status =
      body && typeof body === "object" && "status" in body
        ? (body as { status: unknown }).status
        : undefined;

    if (status !== "ok") {
      return {
        ok: false,
        reason: `Unexpected status: ${String(status)}`,
        statusCode: response.status,
      };
    }

    return { ok: true, statusCode: response.status };
  } catch (err) {
    const reason =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Timed out after ${timeoutMs}ms`
          : err.message
        : "Unknown probe error";
    return { ok: false, reason };
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultSendAlert(params: {
  template: MonitorMailTemplate;
  subject: string;
  locals: Record<string, unknown>;
}): Promise<void> {
  if (!isEmailConfigured()) {
    logger.warn(
      "Monitor alert skipped: SMTP is not configured (EMAIL_HOST, EMAIL_ADDRESS, EMAIL_PASSWORD)",
    );
    return;
  }

  if (!env.alertEmail) {
    logger.warn("Monitor alert skipped: ALERT_EMAIL is not set");
    return;
  }

  try {
    await sendTemplatedMail({
      to: env.alertEmail,
      subject: params.subject,
      template: params.template,
      locals: params.locals,
    });
  } catch (err) {
    logger.error({ err, template: params.template }, "Failed to send monitor email");
    throw err;
  }
}

export async function runMonitorCheck(deps: MonitorDeps = {}): Promise<void> {
  if (checkInFlight) return;
  checkInFlight = true;

  const fetchFn = deps.fetchFn ?? fetch;
  const sendAlert = deps.sendAlert ?? defaultSendAlert;
  const now = deps.now ?? Date.now;

  try {
    const result = await probeHealthUrl(env.monitorUrl, env.monitorTimeoutMs, fetchFn);

    if (result.ok) {
      if (alertedWhileDown) {
        await sendAlert({
          template: "monitorRecovery",
          subject: `[PING] VPS recovered: ${env.monitorUrl}`,
          locals: {
            monitorUrl: env.monitorUrl,
            checkedAt: new Date(now()).toISOString(),
          },
        });
        logger.info(
          { url: env.monitorUrl },
          "Monitor target recovered; recovery email sent",
        );
      } else if (consecutiveFailures > 0) {
        logger.info(
          { url: env.monitorUrl },
          "Monitor target recovered before alert threshold",
        );
      }

      consecutiveFailures = 0;
      alertedWhileDown = false;
      return;
    }

    consecutiveFailures += 1;
    logger.warn(
      {
        url: env.monitorUrl,
        reason: result.reason,
        consecutiveFailures,
        threshold: env.monitorFailureThreshold,
      },
      "Monitor probe failed",
    );

    if (consecutiveFailures < env.monitorFailureThreshold) return;

    const timestamp = now();
    const cooledDown = timestamp - lastAlertSentAt >= env.monitorAlertCooldownMs;
    if (alertedWhileDown && !cooledDown) return;

    await sendAlert({
      template: "monitorAlert",
      subject: `[PING] VPS down: ${env.monitorUrl}`,
      locals: {
        monitorUrl: env.monitorUrl,
        reason: result.reason,
        failureCount: consecutiveFailures,
        checkedAt: new Date(timestamp).toISOString(),
      },
    });

    lastAlertSentAt = timestamp;
    alertedWhileDown = true;
    logger.error(
      { url: env.monitorUrl, reason: result.reason },
      "Monitor alert email sent",
    );
  } finally {
    checkInFlight = false;
  }
}

/** Immediate probe + email on every process start (including each deploy). */
export async function sendDeployStartupAlert(
  deps: MonitorDeps = {},
): Promise<ProbeResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const sendAlert = deps.sendAlert ?? defaultSendAlert;
  const now = deps.now ?? Date.now;

  const result = await probeHealthUrl(env.monitorUrl, env.monitorTimeoutMs, fetchFn);
  const checkedAt = new Date(now()).toISOString();

  await sendAlert({
    template: "monitorDeploy",
    subject: `[PING] Deployed — monitor ${result.ok ? "OK" : "FAIL"}: ${env.monitorUrl}`,
    locals: {
      monitorUrl: env.monitorUrl,
      probeOk: result.ok,
      reason: result.reason,
      checkedAt,
      cron: env.monitorCron,
    },
  });

  if (result.ok) {
    consecutiveFailures = 0;
    alertedWhileDown = false;
  } else {
    consecutiveFailures = 1;
  }

  logger.info(
    { url: env.monitorUrl, ok: result.ok, reason: result.reason },
    "Deploy startup alert sent",
  );

  return result;
}

export function startMonitor(deps: MonitorDeps = {}): void {
  if (!env.monitorEnabled) {
    logger.info("VPS health monitor is disabled (MONITOR_ENABLED=false)");
    return;
  }

  if (!env.alertEmail) {
    logger.warn(
      "VPS health monitor enabled but ALERT_EMAIL is empty; alerts will be skipped",
    );
  }

  if (!cron.validate(env.monitorCron)) {
    logger.error(
      { cron: env.monitorCron },
      "Invalid MONITOR_CRON expression; monitor not started",
    );
    return;
  }

  stopMonitor();
  resetMonitorState();

  logger.info(
    {
      url: env.monitorUrl,
      cron: env.monitorCron,
      timezone: env.monitorCronTimezone || "system",
      failureThreshold: env.monitorFailureThreshold,
    },
    "Starting VPS health monitor",
  );

  void sendDeployStartupAlert(deps).catch((err) => {
    logger.error({ err }, "Deploy startup alert failed");
  });

  cronTask = cron.schedule(
    env.monitorCron,
    () => {
      void runMonitorCheck(deps).catch((err) => {
        logger.error({ err }, "Monitor check failed");
      });
    },
    env.monitorCronTimezone ? { timezone: env.monitorCronTimezone } : undefined,
  );
}

export function stopMonitor(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = undefined;
  }
}
