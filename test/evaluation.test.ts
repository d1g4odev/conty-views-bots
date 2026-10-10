import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_DATASET } from "../src/dataset/generator.ts";
import {
  FALSE_POSITIVE_LINE_PATTERN,
  SUMMARY_BLOCK_PATTERN,
  evaluate,
  falsePositiveLine,
  percent,
  summary,
  wilsonUpper,
} from "../src/evaluation/evaluate.ts";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const report = evaluate(DEFAULT_DATASET);

describe("evaluation", () => {
  it("README states exactly the false-positive rate the evaluation measures", () => {
    const line = readme.match(FALSE_POSITIVE_LINE_PATTERN)?.[0];
    expect(line, "README precisa da linha 'Taxa de falso positivo esperada'; rode npm run evaluate -- --write-readme").toBeDefined();
    expect(line).toBe(falsePositiveLine(report));
    expect(line).toContain(`**${percent(report.falsePositiveRate)}**`);
  });

  it("README table matches the measured counts", () => {
    for (const scenario of report.scenarios) {
      const { organic, inconclusive, suspicious } = scenario.counts;
      expect(readme).toContain(`| ${scenario.scenario} | ${scenario.label} | ${scenario.total} | ${organic} | ${inconclusive} | ${suspicious} |`);
    }
  });

  it("README metrics block is exactly what the evaluate command writes", () => {
    expect(SUMMARY_BLOCK_PATTERN.test(readme)).toBe(true);
    expect(readme.replace(SUMMARY_BLOCK_PATTERN, `${summary(report)}\n`)).toBe(readme);
  });

  it("keeps false positives low and catches the obvious purchases", () => {
    expect(report.falsePositiveRate).toBeLessThan(0.02);
    const caught = (id: string) => report.scenarios.find((item) => item.scenario === id)!.counts.suspicious / DEFAULT_DATASET.perScenario;
    expect(caught("bought_plateau")).toBeGreaterThan(0.95);
    expect(caught("bought_burst")).toBeGreaterThan(0.95);
    expect(caught("organic_steady")).toBe(0);
  });

  it("documents the known blind spot: views bought together with proportional likes", () => {
    const blind = report.scenarios.find((item) => item.scenario === "bought_with_likes")!;
    expect(blind.counts.suspicious / blind.total).toBeLessThan(0.05);
    expect(blind.counts.inconclusive / blind.total).toBeGreaterThan(0.9);
  });

  it("computes a Wilson upper bound that is above the point estimate", () => {
    expect(wilsonUpper(0, 1000)).toBeGreaterThan(0);
    expect(wilsonUpper(0, 1000)).toBeLessThan(0.005);
    expect(wilsonUpper(6, 1200)).toBeGreaterThan(6 / 1200);
  });
});
