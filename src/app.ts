import Fastify, { type FastifyInstance } from "fastify";
import { systemClock, type Clock } from "./clock.ts";
import { classify } from "./domain/classifier.ts";
import { CRITERIA, DECISION_RULES, NOT_DETECTED, THRESHOLDS } from "./domain/criteria.ts";
import { InvalidSeriesError, type ViewSeriesInput } from "./domain/types.ts";

export interface AppOptions {
  clock?: Clock;
  logger?: boolean;
}

const MAX_HOURS = 24 * 90;

const classifyBody = {
  type: "object",
  required: ["startAt", "views"],
  additionalProperties: false,
  properties: {
    startAt: { type: "string", format: "date-time" },
    utcOffsetMinutes: { type: "integer", minimum: -720, maximum: 840 },
    views: { type: "array", minItems: 1, maxItems: MAX_HOURS, items: { type: "integer", minimum: 0 } },
    likes: { type: "array", minItems: 1, maxItems: MAX_HOURS, items: { type: "integer", minimum: 0 } },
  },
} as const;

export function buildApp({ clock = systemClock, logger = false }: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger, bodyLimit: 1_048_576 });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof InvalidSeriesError) {
      return reply.status(422).send({ error: "invalid_series", message: error.message });
    }
    if (error instanceof Error && "validation" in error) {
      return reply.status(400).send({ error: "bad_request", message: error.message });
    }
    app.log.error(error);
    return reply.status(500).send({ error: "internal_error", message: "Erro inesperado" });
  });

  app.get("/health", async () => ({ status: "ok", now: clock.now().toISOString() }));

  app.get("/v1/criteria", async () => ({
    signals: CRITERIA,
    decisionRules: DECISION_RULES,
    notDetected: NOT_DETECTED,
    thresholds: THRESHOLDS,
  }));

  app.post<{ Body: ViewSeriesInput }>("/v1/classify", { schema: { body: classifyBody } }, async (request) =>
    classify(request.body, clock.now()),
  );

  return app;
}
