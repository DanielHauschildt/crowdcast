export interface CompareJob {
  variant: string;
  index: number;
}

export function compareJobs(
  variants: readonly string[],
  runs: number
): CompareJob[] {
  return variants.flatMap((variant) =>
    Array.from({ length: runs }, (_, i) => ({ variant, index: i + 1 }))
  );
}

/**
 * `fn` over `items` with at most `n` in flight; results in input order. After the first
 * failure no new item starts; the ones in flight finish, then the failure is rethrown.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  n: number,
  fn: (item: T, i: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`--parallel must be a positive integer, got ${n}`);
  const out = new Array<R>(items.length);
  let next = 0;
  let failure: { err: unknown } | null = null;
  const worker = async (): Promise<void> => {
    while (!failure && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]!, i);
      } catch (err) {
        failure ??= { err };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (failure) throw (failure as { err: unknown }).err;
  return out;
}
