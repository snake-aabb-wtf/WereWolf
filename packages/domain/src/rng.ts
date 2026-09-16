export function createSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

export function createRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    return value / 4_294_967_296;
  };
}

export function shuffle<T>(items: T[], seed: number): T[] {
  const result = [...items];
  const rng = createRng(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const current = result[index];
    const replacement = result[swapIndex];
    if (current !== undefined && replacement !== undefined) {
      result[index] = replacement;
      result[swapIndex] = current;
    }
  }
  return result;
}

export function pickDeterministic<T>(items: T[], seed: number): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.abs(seed) % items.length];
}
