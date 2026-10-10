import type { ViewSeriesInput } from "../domain/types.ts";
import { createRandom, hashSeed, type Random } from "./random.ts";

export type Label = "legit" | "suspicious";

export type ScenarioId =
  | "organic_steady"
  | "organic_viral"
  | "organic_shoutout"
  | "organic_featured_slot"
  | "organic_low_volume"
  | "organic_viral_no_likes"
  | "bought_plateau"
  | "bought_burst"
  | "bought_drip"
  | "bought_plateau_no_likes"
  | "bought_ramped"
  | "bought_with_likes";

export interface Scenario {
  id: ScenarioId;
  label: Label;
  description: string;
}

export interface Sample {
  id: string;
  scenario: ScenarioId;
  label: Label;
  input: ViewSeriesInput;
}

export interface DatasetOptions {
  seed: number;
  perScenario: number;
}

export const DEFAULT_DATASET: DatasetOptions = { seed: 20261010, perScenario: 200 };
export const DATASET_START = "2026-01-05T03:00:00.000Z";
export const DATASET_UTC_OFFSET_MINUTES = -180;
export const DATASET_HOURS = 168;
export const EVALUATION_NOW = "2026-02-01T00:00:00.000Z";

export const SCENARIOS: readonly Scenario[] = [
  { id: "organic_steady", label: "legit", description: "Audiência estável com ciclo dia/noite, sem pico." },
  { id: "organic_viral", label: "legit", description: "Viralização: subida em horas, pico e decaimento em lei de potência." },
  { id: "organic_shoutout", label: "legit", description: "Repost de conta grande: salto em 1h e decaimento exponencial." },
  { id: "organic_featured_slot", label: "legit", description: "Destaque de plataforma por 4-10h: liga e desliga de uma vez, engajamento normal." },
  { id: "organic_low_volume", label: "legit", description: "Criador pequeno (2-15 views/h) com pico orgânico modesto." },
  { id: "organic_viral_no_likes", label: "legit", description: "Viralização sem série de curtidas enviada." },
  { id: "bought_plateau", label: "suspicious", description: "Pacote entregue em volume fixo por 6-30h, sem curtidas." },
  { id: "bought_burst", label: "suspicious", description: "Rajada de 1-2h com 10-60x a linha de base, sem curtidas." },
  { id: "bought_drip", label: "suspicious", description: "Gotejamento de 24-60h com 0,8-2,5x a linha de base, dia e noite." },
  { id: "bought_plateau_no_likes", label: "suspicious", description: "Pacote em volume fixo sem série de curtidas enviada." },
  { id: "bought_ramped", label: "suspicious", description: "Bot com rampa linear de subida e descida de 3-6h." },
  { id: "bought_with_likes", label: "suspicious", description: "Views e curtidas compradas na proporção da audiência (caso que o classificador não pega)." },
];

interface Audience {
  base: number;
  likeRate: number;
  diurnal: (localHour: number) => number;
  dayFactors: number[];
}

interface Trace {
  human: number[];
  bot: number[];
  humanLikeBoost: number[];
  botLikeRate: number;
  includeLikes: boolean;
}

export function generateDataset(options: DatasetOptions = DEFAULT_DATASET): Sample[] {
  return SCENARIOS.flatMap((scenario) =>
    Array.from({ length: options.perScenario }, (_, index) => generateSample(scenario, index, options.seed)),
  );
}

export function generateSample(scenario: Scenario, index: number, seed: number): Sample {
  const random = createRandom(hashSeed(`${seed}:${scenario.id}:${index}`));
  const audience = makeAudience(random, scenario.id === "organic_low_volume" ? [2, 15] : [30, 3000]);
  const trace = buildTrace(scenario.id, random, audience);
  const startMs = Date.parse(DATASET_START);
  const views: number[] = [];
  const likes: number[] = [];

  for (let hour = 0; hour < DATASET_HOURS; hour++) {
    const localHour = localHourOf(startMs, hour);
    const dayFactor = audience.dayFactors[Math.floor(hour / 24)]!;
    const jitter = Math.max(0.5, random.normal(1, 0.04));
    const humanRate = audience.diurnal(localHour) * dayFactor * jitter * (audience.base + trace.human[hour]!);
    const humanViews = random.poisson(humanRate);
    const botViews = random.poisson(trace.bot[hour]!);
    views.push(humanViews + botViews);
    const extraHuman = humanRate > 0 ? (audience.diurnal(localHour) * dayFactor * jitter * trace.human[hour]!) / humanRate : 0;
    const likeRate = audience.likeRate * (1 + extraHuman * (trace.humanLikeBoost[hour]! - 1));
    likes.push(random.poisson(humanViews * likeRate) + random.poisson(botViews * trace.botLikeRate));
  }

  return {
    id: `${scenario.id}-${String(index).padStart(4, "0")}`,
    scenario: scenario.id,
    label: scenario.label,
    input: {
      startAt: DATASET_START,
      utcOffsetMinutes: DATASET_UTC_OFFSET_MINUTES,
      views,
      ...(trace.includeLikes ? { likes } : {}),
    },
  };
}

function localHourOf(startMs: number, hour: number): number {
  const local = Math.floor((startMs + hour * 3_600_000 + DATASET_UTC_OFFSET_MINUTES * 60_000) / 3_600_000) % 24;
  return local < 0 ? local + 24 : local;
}

function makeAudience(random: Random, [min, max]: [number, number]): Audience {
  const trough = random.uniform(0.12, 0.35);
  const peakHour = random.uniform(18, 22);
  return {
    base: random.logUniform(min, max),
    likeRate: random.uniform(0.02, 0.08),
    diurnal: (localHour) => trough + (1 - trough) * ((1 + Math.cos((2 * Math.PI * (localHour - peakHour)) / 24)) / 2) ** 1.5,
    dayFactors: Array.from({ length: Math.ceil(DATASET_HOURS / 24) }, () => Math.max(0.6, random.normal(1, 0.08))),
  };
}

function emptyTrace(includeLikes = true): Trace {
  return {
    human: new Array<number>(DATASET_HOURS).fill(0),
    bot: new Array<number>(DATASET_HOURS).fill(0),
    humanLikeBoost: new Array<number>(DATASET_HOURS).fill(1),
    botLikeRate: 0,
    includeLikes,
  };
}

function buildTrace(id: ScenarioId, random: Random, audience: Audience): Trace {
  switch (id) {
    case "organic_steady":
      return emptyTrace();
    case "organic_viral":
    case "organic_low_volume":
      return viral(random, audience, true);
    case "organic_viral_no_likes":
      return viral(random, audience, false);
    case "organic_shoutout":
      return shoutout(random, audience);
    case "organic_featured_slot":
      return featured(random, audience);
    case "bought_plateau":
      return plateau(random, audience, true, 0);
    case "bought_plateau_no_likes":
      return plateau(random, audience, false, 0);
    case "bought_with_likes":
      return plateau(random, audience, true, audience.likeRate * random.uniform(0.8, 1.2));
    case "bought_burst":
      return burst(random, audience);
    case "bought_drip":
      return drip(random, audience);
    case "bought_ramped":
      return ramped(random, audience);
  }
}

function viral(random: Random, audience: Audience, includeLikes: boolean): Trace {
  const trace = emptyTrace(includeLikes);
  const amplitude = audience.base * random.uniform(3, 30);
  const start = random.int(36, 110);
  const rise = random.uniform(2, 9);
  const decay = random.uniform(3, 14);
  const exponent = random.uniform(1, 2);
  const likeBoost = random.uniform(0.45, 1.1);
  for (let hour = start; hour < DATASET_HOURS; hour++) {
    const elapsed = hour - start;
    trace.human[hour] = elapsed <= rise ? amplitude * (elapsed / rise) ** 2 : amplitude * (1 + (elapsed - rise) / decay) ** -exponent;
    trace.humanLikeBoost[hour] = likeBoost;
  }
  return trace;
}

function shoutout(random: Random, audience: Audience): Trace {
  const trace = emptyTrace();
  const amplitude = audience.base * random.uniform(4, 20);
  const start = random.int(36, 120);
  const decay = random.uniform(3, 10);
  const likeBoost = random.uniform(0.5, 1.2);
  for (let hour = start; hour < DATASET_HOURS; hour++) {
    trace.human[hour] = amplitude * Math.exp(-(hour - start) / decay);
    trace.humanLikeBoost[hour] = likeBoost;
  }
  return trace;
}

function featured(random: Random, audience: Audience): Trace {
  const trace = emptyTrace();
  const amplitude = audience.base * random.uniform(2, 8);
  const day = random.int(2, 5);
  const start = day * 24 + random.int(8, 14);
  const duration = random.int(4, 10);
  const likeBoost = random.uniform(0.6, 1.1);
  for (let hour = start; hour < start + duration; hour++) {
    trace.human[hour] = amplitude * Math.max(0.3, random.normal(1, 0.15));
    trace.humanLikeBoost[hour] = likeBoost;
  }
  return trace;
}

function plateau(random: Random, audience: Audience, includeLikes: boolean, botLikeRate: number): Trace {
  const trace = emptyTrace(includeLikes);
  const level = audience.base * random.uniform(2, 15);
  const duration = random.int(6, 30);
  const start = random.int(36, DATASET_HOURS - duration - 6);
  for (let hour = start; hour < start + duration; hour++) trace.bot[hour] = level * Math.max(0, random.normal(1, 0.02));
  trace.botLikeRate = botLikeRate;
  return trace;
}

function burst(random: Random, audience: Audience): Trace {
  const trace = emptyTrace();
  const level = audience.base * random.uniform(10, 60);
  const duration = random.int(1, 2);
  const start = random.int(36, DATASET_HOURS - 10);
  for (let hour = start; hour < start + duration; hour++) trace.bot[hour] = level;
  return trace;
}

function drip(random: Random, audience: Audience): Trace {
  const trace = emptyTrace();
  const level = audience.base * random.uniform(0.8, 2.5);
  const duration = random.int(24, 60);
  const start = random.int(30, DATASET_HOURS - duration - 6);
  for (let hour = start; hour < start + duration; hour++) trace.bot[hour] = level * Math.max(0, random.normal(1, 0.03));
  return trace;
}

function ramped(random: Random, audience: Audience): Trace {
  const trace = emptyTrace();
  const level = audience.base * random.uniform(3, 12);
  const ramp = random.int(3, 6);
  const hold = random.int(6, 24);
  const start = random.int(36, DATASET_HOURS - hold - 2 * ramp - 6);
  for (let step = 0; step < hold + 2 * ramp; step++) {
    const factor = step < ramp ? (step + 1) / (ramp + 1) : step >= ramp + hold ? (hold + 2 * ramp - step) / (ramp + 1) : 1;
    trace.bot[start + step] = level * factor;
  }
  return trace;
}
