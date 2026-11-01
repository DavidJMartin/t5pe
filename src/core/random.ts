// Seedable randomness: the same seed always gives the same sequence (names, generated patches).

export type Rng = () => number;

/** mulberry32: small, fast, well mixed. Returns numbers in [0, 1). */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(random: Rng, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

/** Standard normal (Box–Muller). */
export function gaussian(random: Rng): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}
