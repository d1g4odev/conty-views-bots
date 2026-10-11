import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_DATASET, generateDataset } from "../dataset/generator.ts";

const { values } = parseArgs({
  options: {
    seed: { type: "string" },
    "per-scenario": { type: "string" },
    out: { type: "string", default: "data/dataset.json" },
  },
});

const samples = generateDataset({
  seed: values.seed ? Number(values.seed) : DEFAULT_DATASET.seed,
  perScenario: values["per-scenario"] ? Number(values["per-scenario"]) : DEFAULT_DATASET.perScenario,
});
const out = resolve(values.out);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(samples));
console.log(`${samples.length} séries gravadas em ${out}`);
