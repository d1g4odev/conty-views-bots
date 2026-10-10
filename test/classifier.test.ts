import { describe, expect, it } from "vitest";
import { classify } from "../src/domain/classifier.ts";
import { InvalidSeriesError, type ClassificationResult, type SignalId } from "../src/domain/types.ts";
import { NOW, START, between, buildSeries } from "./fixtures.ts";

const status = (result: ClassificationResult, id: SignalId) => result.signals.find((signal) => signal.id === id)?.status;

describe("classify", () => {
  it("treats a steady audience as organic with no spike", () => {
    const result = classify(buildSeries({ base: 400 }), NOW);
    expect(result.classification).toBe("organic");
    expect(result.spike).toBeNull();
    expect(result.reason).toMatch(/Nenhum pico significativo/);
  });

  it("separates a plausible organic spike from a bought spike of similar size", () => {
    const organic = classify(
      buildSeries({ base: 300, human: (hour) => (hour >= 80 ? 3000 * Math.exp(-(hour - 80) / 6) : 0) }),
      NOW,
    );
    const bought = classify(buildSeries({ base: 300, bot: between(80, 92, 1500) }), NOW);

    expect(organic.spike?.excessViews).toBeGreaterThan(5000);
    expect(bought.spike?.excessViews).toBeGreaterThan(5000);

    expect(organic.classification).toBe("organic");
    expect(status(organic, "abrupt_onset")).toBe("fired");
    expect(status(organic, "engagement_decoupling")).toBe("clear");
    expect(status(organic, "flat_plateau")).not.toBe("fired");
    expect(status(organic, "abrupt_stop")).not.toBe("fired");

    expect(bought.classification).toBe("suspicious");
    expect(status(bought, "engagement_decoupling")).toBe("fired");
    expect(status(bought, "flat_plateau")).toBe("fired");
    expect(status(bought, "abrupt_stop")).toBe("fired");
    expect(bought.reason).toMatch(/Padrão de views compradas/);
    expect(bought.reason).toMatch(/engajamento desacoplado/);
  });

  it("flags a day-and-night drip through rhythm and engagement", () => {
    const result = classify(buildSeries({ base: 300, bot: between(60, 108, 450) }), NOW);
    expect(result.classification).toBe("suspicious");
    expect(status(result, "rhythm_mismatch")).toBe("fired");
    expect(status(result, "engagement_decoupling")).toBe("fired");
  });

  it("prefers not to accuse when the shape is odd but engagement follows the spike", () => {
    const result = classify(buildSeries({ base: 300, bot: between(80, 92, 1500), botLikeRate: 0.05 }), NOW);
    expect(status(result, "flat_plateau")).toBe("fired");
    expect(status(result, "abrupt_onset")).toBe("fired");
    expect(status(result, "engagement_decoupling")).toBe("clear");
    expect(result.score).toBeGreaterThanOrEqual(4);
    expect(result.classification).toBe("inconclusive");
    expect(result.reason).toMatch(/Prefiro não acusar/);
  });

  it("does not accuse a short burst when there is no engagement data", () => {
    const result = classify(buildSeries({ base: 300, bot: between(90, 92, 9000), withLikes: false }), NOW);
    expect(status(result, "engagement_decoupling")).toBe("unavailable");
    expect(status(result, "abrupt_onset")).toBe("fired");
    expect(status(result, "abrupt_stop")).toBe("fired");
    expect(result.classification).toBe("inconclusive");
    expect(result.signalsUsed).not.toContain("engagement_decoupling");
  });

  it("catches the same burst once likes show nobody engaged", () => {
    const result = classify(buildSeries({ base: 300, bot: between(90, 92, 9000) }), NOW);
    expect(result.classification).toBe("suspicious");
    expect(result.signalsUsed).toContain("engagement_decoupling");
  });

  it("does not accuse tiny spikes even when shape signals fire", () => {
    const result = classify(buildSeries({ base: 4, bot: between(80, 92, 20), withLikes: false }), NOW);
    expect(result.classification).not.toBe("suspicious");
  });

  it("returns inconclusive when the history is too short", () => {
    const result = classify(buildSeries({ base: 300, hours: 30 }), NOW);
    expect(result.classification).toBe("inconclusive");
    expect(result.reason).toMatch(/Histórico insuficiente/);
  });

  it("drops the hour that is still in progress instead of reading it as an abrupt stop", () => {
    const input = buildSeries({ base: 300, human: (hour) => (hour >= 120 ? 2000 * Math.exp(-(hour - 120) / 30) : 0), hours: 140 });
    input.views[139] = Math.round(input.views[139]! * 0.1);
    input.likes![139] = 0;
    const startMs = Date.parse(START);
    const midLastHour = new Date(startMs + 139.1 * 3_600_000);
    const result = classify(input, midLastHour);
    expect(result.analyzedHours).toBe(139);
    expect(result.ignoredIncompleteHours).toBe(1);
    expect(status(result, "abrupt_stop")).toBe("unavailable");
  });

  it("explains every signal with a value and threshold", () => {
    const result = classify(buildSeries({ base: 300, bot: between(80, 92, 1500) }), NOW);
    for (const signal of result.signals) {
      expect(signal.label.length).toBeGreaterThan(0);
      expect(signal.threshold.length).toBeGreaterThan(0);
      expect(signal.detail.length).toBeGreaterThan(0);
      if (signal.status === "unavailable") expect(signal.value).toBeNull();
      else expect(signal.value).not.toBeNull();
    }
    expect(result.signalsUsed).toEqual(result.signals.filter((signal) => signal.status !== "unavailable").map((signal) => signal.id));
  });

  it("is deterministic", () => {
    const input = buildSeries({ base: 300, bot: between(80, 92, 1500) });
    expect(classify(input, NOW)).toEqual(classify(input, NOW));
  });

  it("rejects inconsistent input", () => {
    const valid = buildSeries({ base: 100 });
    expect(() => classify({ ...valid, startAt: "2026-03-02T03:30:00.000Z" }, NOW)).toThrow(InvalidSeriesError);
    expect(() => classify({ ...valid, likes: [1, 2, 3] }, NOW)).toThrow(/mesmo tamanho/);
    expect(() => classify({ ...valid, views: [1.5, ...valid.views.slice(1)] }, NOW)).toThrow(/inteiros/);
    expect(() => classify(valid, new Date("2026-01-01T00:00:00Z"))).toThrow(/futuro/);
  });
});
