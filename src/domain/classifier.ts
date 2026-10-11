import { CONTENT_SIGNALS, SIGNAL_WEIGHTS, THRESHOLDS as T } from "./criteria.ts";
import { leastSquares, mean, median, medianAbsoluteDeviation, rootMeanSquare, round, standardDeviation, sum } from "./stats.ts";
import {
  InvalidSeriesError,
  type Classification,
  type ClassificationResult,
  type Signal,
  type SignalId,
  type SpikeWindow,
  type ViewSeriesInput,
} from "./types.ts";

const HOUR_MS = 3_600_000;

interface PreparedSeries {
  startMs: number;
  views: number[];
  likes: number[] | null;
  localHours: number[];
  ignoredIncompleteHours: number;
}

interface Baseline {
  expected: number[];
  noise: number[];
  relativeNoise: number;
  diurnal: number[] | null;
}

interface Spike {
  start: number;
  end: number;
  peak: number;
  peakExcess: number;
  residuals: number[];
  views: number[];
}

const LABELS: Record<SignalId, string> = {
  engagement_decoupling: "Engajamento desacoplado",
  flat_plateau: "Platô plano",
  rhythm_mismatch: "Ignora o ritmo dia/noite",
  abrupt_onset: "Início abrupto",
  abrupt_stop: "Fim abrupto",
};

export function classify(input: ViewSeriesInput, now: Date): ClassificationResult {
  const series = prepare(input, now);
  const analyzedAt = now.toISOString();
  const base = {
    analyzedHours: series.views.length,
    ignoredIncompleteHours: series.ignoredIncompleteHours,
    analyzedAt,
  };

  if (series.views.length < T.minHistoryHours) {
    return {
      ...base,
      classification: "inconclusive",
      reason: `Histórico insuficiente: ${series.views.length}h completas, mínimo de ${T.minHistoryHours}h para separar pico de linha de base. Sem base para acusar.`,
      score: 0,
      signalsUsed: [],
      signals: [],
      spike: null,
    };
  }

  const firstPass = buildBaseline(series);
  const spike = findSpike(series, firstPass);

  if (!spike) {
    return {
      ...base,
      classification: "organic",
      reason: "Nenhum pico significativo acima da linha de base: a variação cabe no ruído esperado de uma audiência humana.",
      score: 0,
      signalsUsed: [],
      signals: [],
      spike: null,
    };
  }

  const baseline = withNoise(series, firstPass, (index) => index < spike.start || index > spike.end);
  const signals = [
    engagementSignal(series, baseline, spike),
    plateauSignal(baseline, spike),
    rhythmSignal(series, baseline, spike),
    onsetSignal(spike),
    stopSignal(series, spike),
  ];
  const fired = signals.filter((signal) => signal.status === "fired");
  const score = sum(fired.map((signal) => signal.weight));
  const excessViews = windowExcess(series, baseline, spike);
  const engagement = signals[0]!;
  const coupled = engagement.status === "clear" && (engagement.value ?? 0) >= T.engagementCoupledMinRatio;
  const meetsSuspicious =
    score >= T.suspiciousMinScore && fired.length >= 2 && fired.some((signal) => CONTENT_SIGNALS.includes(signal.id));
  const lowVolume = excessViews < T.lowVolumeExcessViews;

  let classification: Classification;
  if (meetsSuspicious && !coupled && !lowVolume) classification = "suspicious";
  else if (meetsSuspicious || score >= T.inconclusiveMinScore) classification = "inconclusive";
  else classification = "organic";

  return {
    ...base,
    classification,
    reason: explain(classification, fired, signals, { coupled, lowVolume, meetsSuspicious, excessViews, hours: spike.end - spike.start + 1 }),
    score,
    signalsUsed: signals.filter((signal) => signal.status !== "unavailable").map((signal) => signal.id),
    signals,
    spike: describeSpike(series, spike, excessViews),
  };
}

function prepare(input: ViewSeriesInput, now: Date): PreparedSeries {
  const startMs = Date.parse(input.startAt);
  if (Number.isNaN(startMs)) throw new InvalidSeriesError("startAt não é uma data ISO-8601 válida");
  if (startMs % HOUR_MS !== 0) throw new InvalidSeriesError("startAt precisa estar alinhado na hora cheia (minutos e segundos zerados)");
  if (input.views.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new InvalidSeriesError("views precisa conter apenas inteiros >= 0");
  }
  if (input.likes) {
    if (input.likes.length !== input.views.length) throw new InvalidSeriesError("likes precisa ter o mesmo tamanho de views");
    if (input.likes.some((value) => !Number.isInteger(value) || value < 0)) {
      throw new InvalidSeriesError("likes precisa conter apenas inteiros >= 0");
    }
  }
  if (startMs > now.getTime()) throw new InvalidSeriesError("startAt está no futuro em relação ao relógio do servidor");

  const completeHours = Math.min(input.views.length, Math.floor((now.getTime() - startMs) / HOUR_MS));
  const offsetMs = (input.utcOffsetMinutes ?? 0) * 60_000;
  const views = input.views.slice(0, completeHours);
  return {
    startMs,
    views,
    likes: input.likes ? input.likes.slice(0, completeHours) : null,
    localHours: views.map((_, index) => {
      const hour = Math.floor((startMs + index * HOUR_MS + offsetMs) / HOUR_MS) % 24;
      return hour < 0 ? hour + 24 : hour;
    }),
    ignoredIncompleteHours: input.views.length - completeHours,
  };
}

function buildBaseline(series: PreparedSeries): Baseline {
  const { views, localHours } = series;
  let expected: number[];
  let diurnal: number[] | null = null;

  if (views.length >= T.hourOfDayBaselineMinHours) {
    const byHour = Array.from({ length: 24 }, (_, hour) => median(views.filter((_, index) => localHours[index] === hour)));
    const peak = Math.max(...byHour);
    diurnal = byHour.map((value) => (peak > 0 ? value / peak : 1));
    expected = localHours.map((hour) => byHour[hour]!);
  } else {
    const level = median(views);
    expected = views.map(() => level);
  }

  return withNoise(series, { expected, diurnal }, () => true);
}

function withNoise(series: PreparedSeries, baseline: Pick<Baseline, "expected" | "diurnal">, include: (index: number) => boolean): Baseline {
  const { expected } = baseline;
  const relative = series.views
    .map((value, index) => (value - expected[index]!) / Math.max(expected[index]!, 1))
    .filter((_, index) => include(index));
  const relativeNoise = 1.4826 * medianAbsoluteDeviation(relative);
  const noise = expected.map((level) => Math.sqrt((relativeNoise * level) ** 2 + Math.max(level, 1)));
  return { ...baseline, noise, relativeNoise };
}

function findSpike(series: PreparedSeries, baseline: Baseline): Spike | null {
  const residuals = series.views.map((value, index) => value - baseline.expected[index]!);
  let peak = 0;
  for (let index = 1; index < residuals.length; index++) {
    if (residuals[index]! > residuals[peak]!) peak = index;
  }
  const peakExcess = residuals[peak]!;
  const significant =
    peakExcess >= T.spikeMinNoiseMultiple * baseline.noise[peak]! &&
    peakExcess >= T.spikeMinBaselineFraction * mean(baseline.expected) &&
    peakExcess >= T.spikeMinAbsoluteViews;
  if (!significant) return null;

  const inSpike = (index: number): boolean => {
    if (index < 0 || index >= residuals.length) return false;
    const diurnal = baseline.diurnal ? baseline.diurnal[series.localHours[index]!]! : 1;
    return (
      residuals[index]! >= T.windowEdgeFraction * peakExcess * diurnal &&
      residuals[index]! >= T.windowMinNoiseMultiple * baseline.noise[index]!
    );
  };

  const extend = (from: number, step: 1 | -1): number => {
    let edge = from;
    for (;;) {
      if (inSpike(edge + step)) edge += step;
      else if (inSpike(edge + 2 * step)) edge += 2 * step;
      else return edge;
    }
  };
  const start = extend(peak, -1);
  const end = extend(peak, 1);

  return { start, end, peak, peakExcess, residuals, views: series.views };
}

function windowIndexes(spike: Spike): number[] {
  return Array.from({ length: spike.end - spike.start + 1 }, (_, offset) => spike.start + offset);
}

function windowExcess(series: PreparedSeries, baseline: Baseline, spike: Spike): number {
  return sum(windowIndexes(spike).map((index) => series.views[index]! - baseline.expected[index]!));
}

function signal(id: SignalId, status: Signal["status"], value: number | null, threshold: string, detail: string): Signal {
  return { id, label: LABELS[id], status, weight: SIGNAL_WEIGHTS[id], value: value === null ? null : round(value, 3), threshold, detail };
}

function engagementSignal(series: PreparedSeries, baseline: Baseline, spike: Spike): Signal {
  const threshold = `<= ${T.engagementFiredMaxRatio}`;
  if (!series.likes) return signal("engagement_decoupling", "unavailable", null, threshold, "Série de curtidas não enviada.");
  const likes = series.likes;
  const inside = new Set(windowIndexes(spike));
  const outside = series.views.map((_, index) => index).filter((index) => !inside.has(index));
  const outsideLikes = sum(outside.map((index) => likes[index]!));
  const outsideViews = sum(outside.map((index) => series.views[index]!));
  if (outsideLikes < T.engagementMinBaselineLikes || outsideViews === 0) {
    return signal("engagement_decoupling", "unavailable", null, threshold, `Poucas curtidas fora do pico (${outsideLikes}) para estimar a taxa usual.`);
  }
  const rate = outsideLikes / outsideViews;
  const indexes = [...inside];
  const expectedBase = sum(indexes.map((index) => baseline.expected[index]!));
  const excessViews = sum(indexes.map((index) => series.views[index]!)) - expectedBase;
  const expectedLikes = rate * excessViews;
  if (expectedLikes < T.engagementMinExpectedLikes) {
    return signal("engagement_decoupling", "unavailable", null, threshold, `O pico deveria render só ~${Math.round(expectedLikes)} curtidas extras; pouco para comparar.`);
  }
  const excessLikes = sum(indexes.map((index) => likes[index]!)) - rate * expectedBase;
  const ratio = excessLikes / expectedLikes;
  const fired = ratio <= T.engagementFiredMaxRatio;
  const percent = Math.round(Math.max(ratio, 0) * 100);
  return signal(
    "engagement_decoupling",
    fired ? "fired" : "clear",
    ratio,
    threshold,
    `O pico trouxe ${percent}% das curtidas extras esperadas pela taxa usual de ${round(rate * 100, 2)}%.`,
  );
}

function plateauSignal(baseline: Baseline, spike: Spike): Signal {
  const threshold = `<= ${T.plateauMaxDispersion}`;
  const core = windowIndexes(spike).filter((index) => spike.residuals[index]! >= T.coreFraction * spike.peakExcess);
  if (core.length < T.plateauMinCoreHours) {
    return signal("flat_plateau", "unavailable", null, threshold, `Só ${core.length}h acima de 50% do pico; curto demais para medir platô.`);
  }
  const levels = core.map((index) => spike.residuals[index]!);
  const level = mean(levels);
  const hourlyNoise = core.map((index) => Math.sqrt((baseline.relativeNoise * baseline.expected[index]!) ** 2 + Math.max(spike.views[index]!, 1)));
  const expectedNoise = Math.max(rootMeanSquare(hourlyNoise), T.plateauNoiseFloorFraction * level);
  const signalToNoise = level / expectedNoise;
  if (signalToNoise < T.plateauMinSignalToNoise) {
    return signal("flat_plateau", "unavailable", null, threshold, `Topo do pico só ${round(signalToNoise, 1)}x acima do ruído; baixo demais para medir se é plano.`);
  }
  const dispersion = standardDeviation(levels) / expectedNoise;
  const variation = standardDeviation(levels) / level;
  const fired = dispersion <= T.plateauMaxDispersion && variation <= T.plateauMaxVariation;
  return signal(
    "flat_plateau",
    fired ? "fired" : "clear",
    dispersion,
    threshold,
    `${core.length}h no topo variando ${round(dispersion, 2)}x o ruído esperado (CV ${round(variation * 100, 1)}%).`,
  );
}

function rhythmSignal(series: PreparedSeries, baseline: Baseline, spike: Spike): Signal {
  const threshold = `elasticidade + 2 erros-padrão <= ${T.rhythmMaxElasticity}`;
  if (!baseline.diurnal) {
    return signal("rhythm_mismatch", "unavailable", null, threshold, `Precisa de ${T.hourOfDayBaselineMinHours}h para conhecer o ciclo dia/noite da audiência.`);
  }
  const diurnal = baseline.diurnal;
  const hours = windowIndexes(spike).filter((index) => spike.residuals[index]! > 0 && diurnal[series.localHours[index]!]! > 0);
  const profile = hours.map((index) => diurnal[series.localHours[index]!]!);
  const swing = profile.length > 0 ? Math.max(...profile) / Math.min(...profile) : 1;
  if (hours.length < T.rhythmMinHours || swing < T.rhythmMinBaselineSwing) {
    return signal("rhythm_mismatch", "unavailable", null, threshold, "O pico não atravessa horários de audiência alta e baixa o suficiente para comparar com o ciclo diário.");
  }
  const center = mean(hours);
  const scale = Math.max((hours.at(-1)! - hours[0]!) / 2, 1);
  const rows = hours.map((index, position) => {
    const time = (index - center) / scale;
    return [1, time, time * time, Math.log(profile[position]!)];
  });
  const regression = leastSquares(rows, hours.map((index) => Math.log(spike.residuals[index]!)));
  if (!regression) {
    return signal("rhythm_mismatch", "unavailable", null, threshold, "Não foi possível separar tendência e ciclo diário dentro do pico.");
  }
  const elasticity = regression.coefficients[3]!;
  const upper = elasticity + 2 * regression.standardErrors[3]!;
  const fired = upper <= T.rhythmMaxElasticity;
  const certainty = fired ? "" : upper > T.rhythmMaxElasticity && elasticity <= T.rhythmMaxElasticity ? " Estimativa incerta demais para acusar." : "";
  return signal(
    "rhythm_mismatch",
    fired ? "fired" : "clear",
    elasticity,
    threshold,
    `O excesso acompanha ${Math.round(elasticity * 100)}% (±${Math.round(2 * regression.standardErrors[3]! * 100)} p.p.) do ritmo dia/noite da audiência, que varia ${round(swing, 1)}x dentro do pico (orgânico fica perto de 100%).${certainty}`,
  );
}

function onsetSignal(spike: Spike): Signal {
  const threshold = `<= ${T.onsetMaxRampHours}h`;
  if (spike.start === 0) return signal("abrupt_onset", "unavailable", null, threshold, "O pico já começa na primeira hora da série.");
  const firstHigh = windowIndexes(spike).find((index) => spike.residuals[index]! >= T.highFraction * spike.peakExcess)!;
  const ramp = firstHigh - spike.start;
  const fired = ramp <= T.onsetMaxRampHours;
  return signal("abrupt_onset", fired ? "fired" : "clear", ramp, threshold, `Levou ${ramp}h para sair da linha de base e chegar a 80% do pico.`);
}

function stopSignal(series: PreparedSeries, spike: Spike): Signal {
  const threshold = `<= ${T.stopMaxTailHours}h`;
  if (spike.end >= series.views.length - 1) {
    return signal("abrupt_stop", "unavailable", null, threshold, "O pico ainda está em andamento no fim da série.");
  }
  const lastHigh = windowIndexes(spike).findLast((index) => spike.residuals[index]! >= T.highFraction * spike.peakExcess)!;
  const tail = spike.end - lastHigh;
  const fired = tail <= T.stopMaxTailHours;
  return signal("abrupt_stop", fired ? "fired" : "clear", tail, threshold, `Levou ${tail}h para cair de 80% do pico até a linha de base.`);
}

function describeSpike(series: PreparedSeries, spike: Spike, excessViews: number): SpikeWindow {
  const at = (index: number) => new Date(series.startMs + index * HOUR_MS).toISOString();
  return {
    startAt: at(spike.start),
    endAt: at(spike.end + 1),
    hours: spike.end - spike.start + 1,
    peakAt: at(spike.peak),
    peakViews: series.views[spike.peak]!,
    peakExcess: Math.round(spike.peakExcess),
    excessViews: Math.round(excessViews),
  };
}

interface ExplainContext {
  coupled: boolean;
  lowVolume: boolean;
  meetsSuspicious: boolean;
  excessViews: number;
  hours: number;
}

function sentence(item: Signal): string {
  const detail = item.detail.replace(/\.$/, "");
  return `${item.label.toLowerCase()} — ${detail.charAt(0).toLowerCase()}${detail.slice(1)}`;
}

function explain(classification: Classification, fired: Signal[], signals: Signal[], context: ExplainContext): string {
  const listed = fired.map(sentence).join("; ");
  const head = `Pico de ${context.hours}h com ~${Math.round(context.excessViews)} views acima da linha de base.`;
  const engagement = signals.find((item) => item.id === "engagement_decoupling")!;

  if (classification === "suspicious") {
    return `${head} Padrão de views compradas: ${listed}.`;
  }
  if (classification === "organic") {
    const clear = signals.filter((item) => item.status === "clear").map((item) => item.label.toLowerCase());
    const support = clear.length > 0 ? ` Avaliados sem alerta: ${clear.join(", ")}.` : "";
    const minor = fired.length > 0 ? ` Sinal isolado, fraco demais sozinho: ${listed}.` : "";
    return `${head} Forma e ritmo compatíveis com audiência humana.${support}${minor}`;
  }
  if (context.meetsSuspicious && context.coupled) {
    return `${head} A forma lembra entrega comprada (${listed}), mas o engajamento acompanha o pico: ${sentence(engagement).replace(/^[^—]+— /, "")}. Prefiro não acusar: pode ser destaque de plataforma, live ou compra combinada de curtidas.`;
  }
  if (context.meetsSuspicious && context.lowVolume) {
    return `${head} Há sinais (${listed}), mas o volume é pequeno demais para separar compra de acaso. Prefiro não acusar.`;
  }
  return `${head} Há sinais isolados (${listed}), insuficientes para acusar: falta um segundo indício independente ou dados de engajamento.`;
}
