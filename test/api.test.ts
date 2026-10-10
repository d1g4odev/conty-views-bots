import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { fixedClock } from "../src/clock.ts";
import { START, between, buildSeries } from "./fixtures.ts";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const startMs = Date.parse(START);
const hoursAfterStart = (hours: number) => new Date(startMs + hours * 3_600_000).toISOString();

describe("API", () => {
  it("classifies a series and returns reason and signals used", async () => {
    app = buildApp({ clock: fixedClock(hoursAfterStart(200)) });
    const response = await app.inject({ method: "POST", url: "/v1/classify", payload: buildSeries({ base: 300, bot: between(80, 92, 1500) }) });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.classification).toBe("suspicious");
    expect(body.reason).toEqual(expect.any(String));
    expect(body.signalsUsed).toEqual(expect.arrayContaining(["engagement_decoupling", "flat_plateau"]));
    expect(body.signals).toHaveLength(5);
    expect(body.analyzedAt).toBe(hoursAfterStart(200));
    expect(body.spike.startAt).toBe(hoursAfterStart(80));
  });

  it("uses the injected clock to ignore hours that are not complete yet", async () => {
    const clock = fixedClock(hoursAfterStart(100.5));
    app = buildApp({ clock });
    const payload = buildSeries({ base: 300 });
    const first = (await app.inject({ method: "POST", url: "/v1/classify", payload })).json();
    expect(first.analyzedHours).toBe(100);
    expect(first.ignoredIncompleteHours).toBe(68);

    clock.advanceHours(10);
    const second = (await app.inject({ method: "POST", url: "/v1/classify", payload })).json();
    expect(second.analyzedHours).toBe(110);
    expect(second.analyzedAt).toBe(hoursAfterStart(110.5));
  });

  it("rejects malformed bodies with 400", async () => {
    app = buildApp({ clock: fixedClock(hoursAfterStart(200)) });
    const missing = await app.inject({ method: "POST", url: "/v1/classify", payload: { views: [1, 2, 3] } });
    expect(missing.statusCode).toBe(400);
    const negative = await app.inject({ method: "POST", url: "/v1/classify", payload: { startAt: START, views: [1, -2] } });
    expect(negative.statusCode).toBe(400);
  });

  it("rejects semantically invalid series with 422", async () => {
    app = buildApp({ clock: fixedClock(hoursAfterStart(200)) });
    const response = await app.inject({
      method: "POST",
      url: "/v1/classify",
      payload: { startAt: "2026-03-02T03:15:00.000Z", views: [1, 2, 3] },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe("invalid_series");
  });

  it("publishes the criteria, including what it does not detect", async () => {
    app = buildApp({ clock: fixedClock(hoursAfterStart(200)) });
    const body = (await app.inject({ method: "GET", url: "/v1/criteria" })).json();
    expect(body.signals.map((signal: { id: string }) => signal.id)).toEqual([
      "engagement_decoupling",
      "flat_plateau",
      "rhythm_mismatch",
      "abrupt_onset",
      "abrupt_stop",
    ]);
    expect(body.notDetected.length).toBeGreaterThan(3);
    expect(body.decisionRules.length).toBeGreaterThan(3);
  });

  it("reports health with the controlled clock", async () => {
    app = buildApp({ clock: fixedClock("2026-10-10T12:00:00.000Z") });
    const body = (await app.inject({ method: "GET", url: "/health" })).json();
    expect(body).toEqual({ status: "ok", now: "2026-10-10T12:00:00.000Z" });
  });
});
