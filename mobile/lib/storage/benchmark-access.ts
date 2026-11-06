/** Build-time flag value that enables COR-88 benchmark routes in release (`EXPO_PUBLIC_COR88_BENCHMARK`). */
export const BENCHMARK_FLAG_VALUE = '1';

/**
 * Whether the Theme tab and `/benchmark` are reachable. True in JS dev builds or
 * when the COR-88 public env flag was set to exactly `"1"` at bundle time.
 */
export function isBenchmarkAccessEnabled(dev: boolean, flag: string | undefined): boolean {
  return dev || flag === BENCHMARK_FLAG_VALUE;
}
