import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DATASET_HOURS, SCENARIOS, generateDataset, generateSample } from "../src/dataset/generator.ts";
import { createRandom } from "../src/dataset/random.ts";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("synthetic dataset", () => {
  it("is reproducible for the same seed", () => {
    expect(digest(generateDataset({ seed: 1, perScenario: 5 }))).toBe(digest(generateDataset({ seed: 1, perScenario: 5 })));
  });

  it("changes with the seed", () => {
    expect(digest(generateDataset({ seed: 1, perScenario: 5 }))).not.toBe(digest(generateDataset({ seed: 2, perScenario: 5 })));
  });

  it("does not depend on generation order", () => {
    const scenario = SCENARIOS.find((item) => item.id === "bought_drip")!;
    const fromDataset = generateDataset({ seed: 9, perScenario: 4 }).find((sample) => sample.id === "bought_drip-0003");
    expect(fromDataset).toEqual(generateSample(scenario, 3, 9));
  });

  it("covers legit and suspicious scenarios with well-formed series", () => {
    const samples = generateDataset({ seed: 3, perScenario: 3 });
    expect(samples).toHaveLength(SCENARIOS.length * 3);
    expect(new Set(samples.map((sample) => sample.label))).toEqual(new Set(["legit", "suspicious"]));
    for (const sample of samples) {
      expect(sample.input.views).toHaveLength(DATASET_HOURS);
      expect(sample.input.views.every((value) => Number.isInteger(value) && value >= 0)).toBe(true);
      if (sample.input.likes) expect(sample.input.likes).toHaveLength(DATASET_HOURS);
    }
    expect(samples.some((sample) => !sample.input.likes)).toBe(true);
  });

  it("uses a seeded generator with sane distributions", () => {
    const random = createRandom(42);
    const draws = Array.from({ length: 20_000 }, () => random.poisson(12));
    const average = draws.reduce((total, value) => total + value, 0) / draws.length;
    expect(average).toBeGreaterThan(11.8);
    expect(average).toBeLessThan(12.2);
    expect(createRandom(42).next()).toBe(createRandom(42).next());
  });
});
