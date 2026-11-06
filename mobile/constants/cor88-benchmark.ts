import { isBenchmarkAccessEnabled } from '@/lib/storage/benchmark-access';

/** Dotted access so Metro inlines `EXPO_PUBLIC_COR88_BENCHMARK` at bundle time. */
const COR88_BENCHMARK_FLAG = process.env.EXPO_PUBLIC_COR88_BENCHMARK;

export function cor88BenchmarkAccessEnabled(isDev: boolean): boolean {
  return isBenchmarkAccessEnabled(isDev, COR88_BENCHMARK_FLAG);
}
