import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DEFAULT_DATASET } from "../dataset/generator.ts";
import { SUMMARY_BLOCK_PATTERN, evaluate, summary } from "../evaluation/evaluate.ts";

const { values } = parseArgs({
  options: {
    seed: { type: "string" },
    "per-scenario": { type: "string" },
    "write-readme": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const report = evaluate({
  seed: values.seed ? Number(values.seed) : DEFAULT_DATASET.seed,
  perScenario: values["per-scenario"] ? Number(values["per-scenario"]) : DEFAULT_DATASET.perScenario,
});

console.log(values.json ? JSON.stringify(report, null, 2) : summary(report));

if (values["write-readme"]) {
  const path = new URL("../../README.md", import.meta.url);
  const readme = await readFile(path, "utf8");
  if (!SUMMARY_BLOCK_PATTERN.test(readme)) throw new Error("README sem o bloco de métricas (linha de falso positivo + tabela)");
  await writeFile(path, readme.replace(SUMMARY_BLOCK_PATTERN, `${summary(report)}\n`));
  console.log("\nREADME atualizado.");
}
