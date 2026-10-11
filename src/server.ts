import { buildApp } from "./app.ts";

const app = buildApp({ logger: true });
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

await app.listen({ port, host });
