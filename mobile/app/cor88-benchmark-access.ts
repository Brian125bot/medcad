import { isBenchmarkAccessEnabled } from '@/lib/storage/benchmark-access';

/** Read once with dotted access so Expo inlines the value in release bundles. */
const COR88_BENCHMARK_FLAG = process.env.EXPO_PUBLIC_COR88_BENCHMARK;

export function cor88BenchmarkAccessEnabled(isDev: boolean): boolean {
  return isBenchmarkAccessEnabled(isDev, COR88_BENCHMARK_FLAG);
}
