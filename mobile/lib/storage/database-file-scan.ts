export interface DatabaseFileBytes {
  /** Basename only (no directories). */
  name: string;
  bytes: Uint8Array;
}

export interface FileScanResult {
  status: 'passed' | 'failed' | 'unavailable';
  files: { name: string; byteLength: number; hits: number }[];
  leakCount: number;
}

export const FILE_SCAN_CHUNK_BYTES = 65_536;

const textEncoder = new TextEncoder();

export function basenameOnly(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

export function isBenchmarkDatabaseFile(path: string, expectedBasename: string): boolean {
  return basenameOnly(path) === expectedBasename;
}

function assertAsciiSentinel(sentinel: string): void {
  for (let index = 0; index < sentinel.length; index += 1) {
    if (sentinel.charCodeAt(index) > 127) {
      throw new Error('sentinel must be ASCII for UTF-8 file scan');
    }
  }
}

function needleMatches(haystack: Uint8Array, start: number, needle: Uint8Array): boolean {
  for (let index = 0; index < needle.length; index += 1) {
    if (haystack[start + index] !== needle[index]) return false;
  }
  return true;
}

/** Count non-overlapping occurrences of `needle` scanning `haystack` in `chunkSize` windows. */
export function countNeedleInBytes(haystack: Uint8Array, needle: Uint8Array, chunkSize: number): number {
  if (needle.length === 0) return 0;
  let count = 0;
  for (let chunkStart = 0; chunkStart < haystack.length; chunkStart += chunkSize) {
    const chunkEnd = Math.min(haystack.length, chunkStart + chunkSize);
    const scanStart = chunkStart === 0 ? 0 : chunkStart - (needle.length - 1);
    const scanEnd = Math.min(haystack.length, chunkStart + chunkSize + needle.length - 1);
    for (let index = scanStart; index <= scanEnd - needle.length; index += 1) {
      if (index >= chunkStart && index < chunkEnd && needleMatches(haystack, index, needle)) count += 1;
    }
  }
  return count;
}

export function scanFileBytesForSentinels(
  files: DatabaseFileBytes[] | null,
  sentinels: string[],
  chunkSize: number = FILE_SCAN_CHUNK_BYTES,
): FileScanResult {
  if (files === null) {
    return { status: 'unavailable', files: [], leakCount: 0 };
  }
  const needles = sentinels.map((sentinel) => {
    assertAsciiSentinel(sentinel);
    return textEncoder.encode(sentinel);
  });
  const fileResults: FileScanResult['files'] = [];
  let leakCount = 0;
  for (const file of files) {
    let hits = 0;
    for (const needle of needles) {
      hits += countNeedleInBytes(file.bytes, needle, chunkSize);
    }
    leakCount += hits;
    fileResults.push({ name: file.name, byteLength: file.bytes.byteLength, hits });
  }
  return {
    status: leakCount > 0 ? 'failed' : 'passed',
    files: fileResults,
    leakCount,
  };
}

export function formatDatabaseFileSizes(files: FileScanResult['files']): string {
  if (files.length === 0) return 'no files read';
  return files.map((file) => `${file.name} ${file.byteLength} B`).join(' · ');
}
