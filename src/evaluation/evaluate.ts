import { classify } from "../domain/classifier.ts";
import type { Classification } from "../domain/types.ts";
import {
  DEFAULT_DATASET,
  EVALUATION_NOW,
  SCENARIOS,
  generateDataset,
  type DatasetOptions,
  type Label,
  type ScenarioId,
} from "../dataset/generator.ts";

export type Counts = Record<Classification, number>;

export interface ScenarioReport {
  scenario: ScenarioId;
  label: Label;
  total: number;
  counts: Counts;
}

export interface EvaluationReport {
  seed: number;
  perScenario: number;
  legitTotal: number;
  suspiciousTotal: number;
  falsePositiveRate: number;
  falsePositiveUpper95: number;
  detectionRate: number;
  legitInconclusiveRate: number;
  suspiciousInconclusiveRate: number;
  scenarios: ScenarioReport[];
}

const emptyCounts = (): Counts => ({ organic: 0, suspicious: 0, inconclusive: 0 });

export function evaluate(options: DatasetOptions = DEFAULT_DATASET): EvaluationReport {
  const now = new Date(EVALUATION_NOW);
  const byScenario = new Map<ScenarioId, Counts>(SCENARIOS.map((scenario) => [scenario.id, emptyCounts()]));
  for (const sample of generateDataset(options)) {
    byScenario.get(sample.scenario)![classify(sample.input, now).classification]++;
  }
  const scenarios = SCENARIOS.map((scenario) => {
    const counts = byScenario.get(scenario.id)!;
    return { scenario: scenario.id, label: scenario.label, total: counts.organic + counts.suspicious + counts.inconclusive, counts };
  });
  const aggregate = (label: Label): { total: number; counts: Counts } => {
    const counts = emptyCounts();
    let total = 0;
    for (const report of scenarios.filter((item) => item.label === label)) {
      total += report.total;
      counts.organic += report.counts.organic;
      counts.suspicious += report.counts.suspicious;
      counts.inconclusive += report.counts.inconclusive;
    }
    return { total, counts };
  };
  const legit = aggregate("legit");
  const suspicious = aggregate("suspicious");
  return {
    seed: options.seed,
    perScenario: options.perScenario,
    legitTotal: legit.total,
    suspiciousTotal: suspicious.total,
    falsePositiveRate: legit.counts.suspicious / legit.total,
    falsePositiveUpper95: wilsonUpper(legit.counts.suspicious, legit.total),
    detectionRate: suspicious.counts.suspicious / suspicious.total,
    legitInconclusiveRate: legit.counts.inconclusive / legit.total,
    suspiciousInconclusiveRate: suspicious.counts.inconclusive / suspicious.total,
    scenarios,
  };
}

export function wilsonUpper(successes: number, total: number, z = 1.96): number {
  if (total === 0) return 1;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return (center + margin) / denominator;
}

export const percent = (value: number): string => `${(value * 100).toFixed(2)}%`;

export function falsePositiveLine(report: EvaluationReport): string {
  return `Taxa de falso positivo esperada: **${percent(report.falsePositiveRate)}** (limite superior 95%: ${percent(report.falsePositiveUpper95)}; ${report.legitTotal} séries legítimas, seed ${report.seed}).`;
}

export const FALSE_POSITIVE_LINE_PATTERN = /^Taxa de falso positivo esperada: .*$/m;
export const SUMMARY_BLOCK_PATTERN = /^Taxa de falso positivo esperada: .*\n(?:.*\n)*?\| --- \|.*\n(?:\|.*(?:\n|$))*/m;

export function metricsTable(report: EvaluationReport): string {
  const rows = report.scenarios.map(
    (item) =>
      `| ${item.scenario} | ${item.label} | ${item.total} | ${item.counts.organic} | ${item.counts.inconclusive} | ${item.counts.suspicious} |`,
  );
  return [
    "| Cenário | Rótulo | Séries | Orgânico | Inconclusivo | Suspeito |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...rows,
  ].join("\n");
}

export function summary(report: EvaluationReport): string {
  return [
    falsePositiveLine(report),
    "",
    `- Detecção (suspeitos marcados como suspeito): ${percent(report.detectionRate)} de ${report.suspiciousTotal}`,
    `- Legítimos inconclusivos: ${percent(report.legitInconclusiveRate)}`,
    `- Suspeitos inconclusivos: ${percent(report.suspiciousInconclusiveRate)}`,
    "",
    metricsTable(report),
  ].join("\n");
}
