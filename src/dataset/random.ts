export interface Random {
  next(): number;
  uniform(min: number, max: number): number;
  int(min: number, max: number): number;
  logUniform(min: number, max: number): number;
  normal(mean?: number, sd?: number): number;
  poisson(lambda: number): number;
}

export function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = (mean = 0, sd = 1): number => {
    const u = Math.max(next(), 1e-12);
    const v = next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return {
    next,
    uniform: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    logUniform: (min, max) => Math.exp(Math.log(min) + (Math.log(max) - Math.log(min)) * next()),
    normal,
    poisson: (lambda) => {
      if (lambda <= 0) return 0;
      if (lambda > 40) return Math.max(0, Math.round(normal(lambda, Math.sqrt(lambda))));
      const limit = Math.exp(-lambda);
      let product = next();
      let count = 0;
      while (product > limit) {
        product *= next();
        count++;
      }
      return count;
    },
  };
}
