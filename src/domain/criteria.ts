import type { SignalId } from "./types.ts";

export const THRESHOLDS = {
  minHistoryHours: 48,
  hourOfDayBaselineMinHours: 96,
  spikeMinNoiseMultiple: 6,
  spikeMinBaselineFraction: 0.5,
  spikeMinAbsoluteViews: 20,
  windowEdgeFraction: 0.2,
  windowMinNoiseMultiple: 2,
  highFraction: 0.8,
  coreFraction: 0.5,
  onsetMaxRampHours: 1,
  stopMaxTailHours: 1,
  plateauMinCoreHours: 3,
  plateauMaxDispersion: 1.5,
  plateauNoiseFloorFraction: 0.05,
  plateauMinSignalToNoise: 4,
  plateauMaxVariation: 0.15,
  rhythmMinHours: 12,
  rhythmMinBaselineSwing: 2,
  rhythmMaxElasticity: 0.5,
  engagementMinBaselineLikes: 30,
  engagementMinExpectedLikes: 30,
  engagementFiredMaxRatio: 0.3,
  engagementCoupledMinRatio: 0.5,
  lowVolumeExcessViews: 300,
  suspiciousMinScore: 4,
  inconclusiveMinScore: 2,
} as const;

export const SIGNAL_WEIGHTS: Record<SignalId, number> = {
  engagement_decoupling: 3,
  flat_plateau: 2,
  rhythm_mismatch: 2,
  abrupt_onset: 1,
  abrupt_stop: 1,
};

export const CONTENT_SIGNALS: readonly SignalId[] = ["engagement_decoupling", "flat_plateau", "rhythm_mismatch"];

export interface CriterionDoc {
  id: SignalId;
  label: string;
  weight: number;
  rule: string;
  why: string;
  organicCounterexample: string;
}

export const CRITERIA: readonly CriterionDoc[] = [
  {
    id: "engagement_decoupling",
    label: "Engajamento desacoplado",
    weight: SIGNAL_WEIGHTS.engagement_decoupling,
    rule: `curtidas marginais do pico / taxa de curtidas fora do pico <= ${THRESHOLDS.engagementFiredMaxRatio}`,
    why: "Views compradas raramente trazem curtidas na mesma proporção que a audiência real.",
    organicCounterexample: "Conteúdo que viraliza fora da bolha costuma ter taxa de curtidas menor, mas raramente abaixo de 30% da usual.",
  },
  {
    id: "flat_plateau",
    label: "Platô plano",
    weight: SIGNAL_WEIGHTS.flat_plateau,
    rule: `com >= ${THRESHOLDS.plateauMinCoreHours}h acima de 50% do pico e topo >= ${THRESHOLDS.plateauMinSignalToNoise}x o ruído, desvio-padrão do excesso <= ${THRESHOLDS.plateauMaxDispersion}x o ruído esperado e CV <= ${THRESHOLDS.plateauMaxVariation * 100}% (piso de ${THRESHOLDS.plateauNoiseFloorFraction * 100}% do nível)`,
    why: "Painéis de venda entregam um volume fixo por hora; audiência humana sobe, atinge pico e decai.",
    organicCounterexample: "Destaque de plataforma com tráfego estável pode ficar plano; por isso o sinal sozinho não acusa.",
  },
  {
    id: "rhythm_mismatch",
    label: "Ignora o ritmo dia/noite",
    weight: SIGNAL_WEIGHTS.rhythm_mismatch,
    rule: `elasticidade do excesso ao ciclo diário da própria audiência + 2 erros-padrão <= ${THRESHOLDS.rhythmMaxElasticity} (regressão log(excesso) ~ tendência quadrática + log(perfil horário), com >= ${THRESHOLDS.rhythmMinHours}h e perfil variando >= ${THRESHOLDS.rhythmMinBaselineSwing}x dentro do pico)`,
    why: "Gente real assiste quando está acordada: o excesso orgânico sobe e desce junto com o perfil horário da audiência (elasticidade perto de 1). Bot entrega igual de madrugada (perto de 0).",
    organicCounterexample: "Audiência global sem ciclo dia/noite deixa o perfil plano; aí o sinal fica indisponível em vez de disparar.",
  },
  {
    id: "abrupt_onset",
    label: "Início abrupto",
    weight: SIGNAL_WEIGHTS.abrupt_onset,
    rule: `o pico atinge 80% do excesso máximo em <= ${THRESHOLDS.onsetMaxRampHours}h após sair da linha de base`,
    why: "Entrega comprada liga de uma vez.",
    organicCounterexample: "Repost de uma conta grande também liga de uma vez; peso baixo por isso.",
  },
  {
    id: "abrupt_stop",
    label: "Fim abrupto",
    weight: SIGNAL_WEIGHTS.abrupt_stop,
    rule: `cai de 80% para menos de 20% do excesso máximo em <= ${THRESHOLDS.stopMaxTailHours}h (só avaliado se o pico terminou dentro da série)`,
    why: "Quando o pacote acaba, o tráfego some; interesse humano decai aos poucos.",
    organicCounterexample: "Fim de live, embed removido ou fim de destaque também cortam o tráfego; peso baixo.",
  },
];

export const DECISION_RULES: readonly string[] = [
  `Menos de ${THRESHOLDS.minHistoryHours}h completas: inconclusivo (histórico insuficiente).`,
  "Sem pico significativo (excesso máximo < 6x ruído, < 50% da linha de base ou < 20 views): orgânico.",
  `Suspeito: pontuação >= ${THRESHOLDS.suspiciousMinScore}, pelo menos 2 sinais e ao menos um de engajamento, platô ou ritmo.`,
  `Veto: se o engajamento acompanha o pico (razão >= ${THRESHOLDS.engagementCoupledMinRatio}), não acusa; vira inconclusivo.`,
  `Veto: se o excesso total do pico for < ${THRESHOLDS.lowVolumeExcessViews} views, não acusa; vira inconclusivo.`,
  `Inconclusivo: pontuação >= ${THRESHOLDS.inconclusiveMinScore} sem atingir os critérios de suspeito.`,
  "Orgânico: qualquer outro caso.",
];

export const NOT_DETECTED: readonly string[] = [
  "Compra de views junto com compra de curtidas proporcionais (o veto de engajamento evita acusar e, por consequência, deixa passar).",
  "Bots que imitam a curva diária e a forma de subida/decaimento de um pico orgânico.",
  "Compras pequenas (excesso abaixo de 300 views) ou diluídas a ponto de não formar pico.",
  "Compras contínuas desde o início da série: a linha de base já nasce contaminada.",
  "Mais de um pico na mesma série: só o maior é analisado.",
  "Audiência global sem ciclo dia/noite: o sinal noturno fica inoperante.",
  "Views humanas de baixa qualidade (fazendas de clique com pessoas reais seguindo horário comercial).",
];
