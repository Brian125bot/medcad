import { describe, expect, it } from 'vitest';
import { buildSyntheticDataset } from '../lib/storage/device-benchmark';
import {
  basenameOnly,
  countNeedleInBytes,
  FILE_SCAN_CHUNK_BYTES,
  formatDatabaseFileSizes,
  isBenchmarkDatabaseFile,
  scanFileBytesForSentinels,
  toFileUri,
} from '../lib/storage/database-file-scan';

const encoder = new TextEncoder();

describe('toFileUri', () => {
  it('prefixes file:// for plain absolute paths and leaves URIs unchanged', () => {
    expect(toFileUri('/data/user/0/pkg/files/SQLite/cadencerx-benchmark.db')).toBe(
      'file:///data/user/0/pkg/files/SQLite/cadencerx-benchmark.db',
    );
    expect(toFileUri('file:///already')).toBe('file:///already');
    expect(toFileUri('content://authority/path')).toBe('content://authority/path');
    expect(toFileUri('relative/path.db')).toBe('file:///relative/path.db');
    expect(toFileUri('https://example.com/x')).toBe('https://example.com/x');
  });
});

describe('isBenchmarkDatabaseFile', () => {
  it('matches basename only', () => {
    expect(isBenchmarkDatabaseFile('/var/containers/cadencerx-benchmark.db', 'cadencerx-benchmark.db')).toBe(true);
    expect(isBenchmarkDatabaseFile('cadencerx-benchmark.db', 'cadencerx-benchmark.db')).toBe(true);
    expect(isBenchmarkDatabaseFile('/tmp/cadencerx.db', 'cadencerx-benchmark.db')).toBe(false);
    expect(basenameOnly('a\\b\\file.db')).toBe('file.db');
  });
});

describe('scanFileBytesForSentinels', () => {
  it('returns unavailable for null files', () => {
    expect(scanFileBytesForSentinels(null, ['BENCH'])).toEqual({ status: 'unavailable', files: [], leakCount: 0 });
  });

  it('passes with zero hits and reports sizes', () => {
    const files = [{ name: 'cadencerx-benchmark.db', bytes: new Uint8Array([1, 2, 3]) }];
    const result = scanFileBytesForSentinels(files, ['BENCHX']);
    expect(result.status).toBe('passed');
    expect(result.leakCount).toBe(0);
    expect(result.files[0].hits).toBe(0);
    expect(formatDatabaseFileSizes(result.files)).toBe('cadencerx-benchmark.db 3 B');
  });

  it('fails when a sentinel appears in raw bytes', () => {
    const needle = encoder.encode('BENCHLEAK');
    const files = [{ name: 'cadencerx-benchmark.db', bytes: new Uint8Array([0, ...needle, 0]) }];
    const result = scanFileBytesForSentinels(files, ['BENCHLEAK']);
    expect(result.status).toBe('failed');
    expect(result.leakCount).toBe(1);
  });

  it('scans multiple files and counts multiple hits', () => {
    const tag = encoder.encode('BENCHA');
    const files = [
      { name: 'cadencerx-benchmark.db', bytes: tag },
      { name: 'cadencerx-benchmark.db-wal', bytes: tag },
    ];
    const result = scanFileBytesForSentinels(files, ['BENCHA']);
    expect(result.status).toBe('failed');
    expect(result.leakCount).toBe(2);
  });

  it('handles an empty file', () => {
    expect(scanFileBytesForSentinels([{ name: 'cadencerx-benchmark.db', bytes: new Uint8Array() }], ['BENCH']).status).toBe('passed');
  });

  it('rejects non-ASCII sentinels at call time', () => {
    expect(() => scanFileBytesForSentinels([], ['BENCH\u0080'])).toThrow('ASCII');
  });

  it('finds a sentinel straddling chunk boundaries', () => {
    const chunk = 8;
    const needle = encoder.encode('STRADDLE');
    const haystack = new Uint8Array(chunk + needle.length - 1);
    haystack.fill(0x61);
    haystack.set(needle, chunk - 4);
    expect(countNeedleInBytes(haystack, needle, chunk)).toBe(1);
    expect(scanFileBytesForSentinels([{ name: 'cadencerx-benchmark.db', bytes: haystack }], ['STRADDLE'], chunk).leakCount).toBe(1);
  });

  it('dataset sentinels are ASCII', () => {
    for (const sentinel of buildSyntheticDataset('2026-01-01').sentinels) {
      expect([...sentinel].every((char) => char.charCodeAt(0) <= 127)).toBe(true);
    }
  });

  it('returns zero for an empty needle', () => {
    expect(countNeedleInBytes(new Uint8Array([1, 2, 3]), new Uint8Array(0), 2)).toBe(0);
  });

  it('formats an empty file list', () => {
    expect(formatDatabaseFileSizes([])).toBe('no files read');
  });

  it('counts a match in a later chunk using overlap scan', () => {
    const needle = encoder.encode('LATE');
    const haystack = new Uint8Array(20);
    haystack.set(needle, 12);
    expect(countNeedleInBytes(haystack, needle, 8)).toBe(1);
  });

  it('uses the default chunk size constant', () => {
    expect(FILE_SCAN_CHUNK_BYTES).toBeGreaterThan(0);
    const big = new Uint8Array(FILE_SCAN_CHUNK_BYTES + 10);
    big.set(encoder.encode('EDGE'), FILE_SCAN_CHUNK_BYTES - 2);
    expect(scanFileBytesForSentinels([{ name: 'cadencerx-benchmark.db', bytes: big }], ['EDGE']).leakCount).toBe(1);
  });
});
