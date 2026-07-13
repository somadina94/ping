import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  probeHealthUrl,
  resetMonitorState,
  runMonitorCheck,
  sendDeployStartupAlert,
  stopMonitor,
} from "../src/services/monitor.js";
import { env } from "../src/config/env.js";

const okResponse = () =>
  Promise.resolve(
    new Response(JSON.stringify({ status: "ok", checks: { mongo: "up" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

const downResponse = (status = 503) =>
  Promise.resolve(
    new Response(JSON.stringify({ status: "unavailable", checks: { mongo: "down" } }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

describe("probeHealthUrl", () => {
  it("succeeds when HTTP 2xx and status is ok", async () => {
    const result = await probeHealthUrl(
      "https://example.com/health",
      1000,
      okResponse as unknown as typeof fetch,
    );

    expect(result).toEqual({ ok: true, statusCode: 200 });
  });

  it("fails on non-ok HTTP status", async () => {
    const result = await probeHealthUrl("https://example.com/health", 1000, (() =>
      Promise.resolve(
        new Response("nope", { status: 500 }),
      )) as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("HTTP 500");
  });

  it("fails when JSON status is not ok", async () => {
    const result = await probeHealthUrl("https://example.com/health", 1000, (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ status: "unavailable", checks: { mongo: "down" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )) as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Unexpected status");
  });
});

describe("runMonitorCheck", () => {
  const sendAlert = jest.fn(async () => undefined);

  beforeEach(() => {
    resetMonitorState();
    sendAlert.mockClear();
  });

  afterEach(() => {
    stopMonitor();
    resetMonitorState();
  });

  it("does not alert before the failure threshold", async () => {
    const threshold = env.monitorFailureThreshold;

    for (let i = 0; i < threshold - 1; i += 1) {
      await runMonitorCheck({
        fetchFn: downResponse as unknown as typeof fetch,
        sendAlert,
      });
    }

    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("sends an alert after consecutive failures reach the threshold", async () => {
    const threshold = env.monitorFailureThreshold;

    for (let i = 0; i < threshold; i += 1) {
      await runMonitorCheck({
        fetchFn: downResponse as unknown as typeof fetch,
        sendAlert,
        now: () => 1_000_000,
      });
    }

    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert.mock.calls[0]?.[0]).toMatchObject({
      template: "monitorAlert",
    });
  });

  it("respects alert cooldown while still down", async () => {
    const threshold = env.monitorFailureThreshold;
    let now = 1_000_000;

    for (let i = 0; i < threshold; i += 1) {
      await runMonitorCheck({
        fetchFn: downResponse as unknown as typeof fetch,
        sendAlert,
        now: () => now,
      });
    }

    expect(sendAlert).toHaveBeenCalledTimes(1);

    now += 1000;
    await runMonitorCheck({
      fetchFn: downResponse as unknown as typeof fetch,
      sendAlert,
      now: () => now,
    });

    expect(sendAlert).toHaveBeenCalledTimes(1);

    now += env.monitorAlertCooldownMs;
    await runMonitorCheck({
      fetchFn: downResponse as unknown as typeof fetch,
      sendAlert,
      now: () => now,
    });

    expect(sendAlert).toHaveBeenCalledTimes(2);
  });

  it("sends a recovery email after an alert when the target recovers", async () => {
    const threshold = env.monitorFailureThreshold;

    for (let i = 0; i < threshold; i += 1) {
      await runMonitorCheck({
        fetchFn: downResponse as unknown as typeof fetch,
        sendAlert,
        now: () => 1_000_000,
      });
    }

    await runMonitorCheck({
      fetchFn: okResponse as unknown as typeof fetch,
      sendAlert,
      now: () => 1_000_001,
    });

    expect(sendAlert).toHaveBeenCalledTimes(2);
    expect(sendAlert.mock.calls[1]?.[0]).toMatchObject({
      template: "monitorRecovery",
    });
  });
});

describe("sendDeployStartupAlert", () => {
  const sendAlert = jest.fn(async () => undefined);

  beforeEach(() => {
    resetMonitorState();
    sendAlert.mockClear();
  });

  afterEach(() => {
    stopMonitor();
    resetMonitorState();
  });

  it("sends a deploy alert when the initial probe succeeds", async () => {
    const result = await sendDeployStartupAlert({
      fetchFn: okResponse as unknown as typeof fetch,
      sendAlert,
      now: () => 1_000_000,
    });

    expect(result.ok).toBe(true);
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert.mock.calls[0]?.[0]).toMatchObject({
      template: "monitorDeploy",
      locals: expect.objectContaining({
        probeOk: true,
        monitorUrl: env.monitorUrl,
      }),
    });
  });

  it("sends a deploy alert when the initial probe fails", async () => {
    const result = await sendDeployStartupAlert({
      fetchFn: downResponse as unknown as typeof fetch,
      sendAlert,
      now: () => 1_000_000,
    });

    expect(result.ok).toBe(false);
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert.mock.calls[0]?.[0]).toMatchObject({
      template: "monitorDeploy",
      locals: expect.objectContaining({
        probeOk: false,
      }),
    });
  });
});
