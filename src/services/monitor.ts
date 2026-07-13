import { env } from "../config/env.js";
import { isEmailConfigured, sendTemplatedMail } from "../utils/email.js";
import { logger } from "../utils/logger.js";

export type ProbeResult = {
  ok: boolean;
  reason?: string;
  statusCode?: number;
};

type MonitorDeps = {
  fetchFn?: typeof fetch;
  sendAlert?: (params: {
    template: "monitorAlert" | "monitorRecovery";
    subject: string;
    locals: Record<string, unknown>;
  }) => Promise<void>;
  now?: () => number;
};

let intervalId: ReturnType<typeof setInterval> | undefined;
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
  template: "monitorAlert" | "monitorRecovery";
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

  await sendTemplatedMail({
    to: env.alertEmail,
    subject: params.subject,
    template: params.template,
    locals: params.locals,
  });
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

  resetMonitorState();

  logger.info(
    {
      url: env.monitorUrl,
      intervalMs: env.monitorIntervalMs,
      failureThreshold: env.monitorFailureThreshold,
    },
    "Starting VPS health monitor",
  );

  void runMonitorCheck(deps);
  intervalId = setInterval(() => {
    void runMonitorCheck(deps);
  }, env.monitorIntervalMs);

  if (typeof intervalId.unref === "function") {
    intervalId.unref();
  }
}

export function stopMonitor(): void {
  if (intervalId !== undefined) {
    clearInterval(intervalId);
    intervalId = undefined;
  }
}
