import { createRandom } from "../src/dataset/random.ts";
import type { ViewSeriesInput } from "../src/domain/types.ts";

export const START = "2026-03-02T03:00:00.000Z";
export const OFFSET = -180;
export const NOW = new Date("2026-04-01T00:00:00.000Z");

export interface SeriesSpec {
  base: number;
  hours?: number;
  human?: (hour: number) => number;
  bot?: (hour: number) => number;
  likeRate?: number;
  botLikeRate?: number;
  withLikes?: boolean;
  seed?: number;
}

export function audienceProfile(localHour: number): number {
  return 0.2 + 0.8 * ((1 + Math.cos((2 * Math.PI * (localHour - 20)) / 24)) / 2) ** 1.5;
}

export function buildSeries(spec: SeriesSpec): ViewSeriesInput {
  const random = createRandom(spec.seed ?? 7);
  const hours = spec.hours ?? 168;
  const likeRate = spec.likeRate ?? 0.05;
  const views: number[] = [];
  const likes: number[] = [];
  for (let hour = 0; hour < hours; hour++) {
    const profile = audienceProfile(hour % 24);
    const humanViews = random.poisson(profile * (spec.base + (spec.human?.(hour) ?? 0)));
    const botViews = random.poisson(spec.bot?.(hour) ?? 0);
    views.push(humanViews + botViews);
    likes.push(random.poisson(humanViews * likeRate) + random.poisson(botViews * (spec.botLikeRate ?? 0)));
  }
  return { startAt: START, utcOffsetMinutes: OFFSET, views, ...(spec.withLikes === false ? {} : { likes }) };
}

export const between = (from: number, to: number, value: number) => (hour: number) => (hour >= from && hour < to ? value : 0);
