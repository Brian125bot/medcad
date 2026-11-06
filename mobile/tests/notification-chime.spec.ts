/**
 * COR-76 chime synthesis tests.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHIME_SAMPLE_RATE,
  CHIME_TONE_HZ,
  chimeSampleCount,
  encodeWav,
  synthesizeChimeSamples,
  synthesizeChimeWav,
} from '../lib/notifications/chime';

describe('chime', () => {
  it('uses the agreed tones', () => {
    expect(CHIME_TONE_HZ).toEqual([880, 1320]);
  });

  it('writes a valid 16-bit PCM mono WAV header', () => {
    const wav = synthesizeChimeWav();
    const view = new DataView(wav.buffer);
    const ascii = (o: number, n: number) => String.fromCharCode(...wav.slice(o, o + n));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(CHIME_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(chimeSampleCount() * 2);
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
  });

  it('is about 1.2 s, stays below clipping, and ends silent', () => {
    const samples = synthesizeChimeSamples();
    expect(samples.length / CHIME_SAMPLE_RATE).toBeCloseTo(1.2, 3);
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    expect(peak).toBeGreaterThan(8000);
    expect(peak).toBeLessThan(32767 * 0.9);
    expect(samples[0]).toBe(0);
    expect(samples[samples.length - 1]).toBe(0);
  });

  it('is deterministic and matches the committed asset byte for byte', () => {
    const wav = synthesizeChimeWav();
    expect(synthesizeChimeWav()).toEqual(wav);
    const committed = readFileSync(join(__dirname, '..', 'assets', 'sounds', 'cadencerx_chime.wav'));
    expect(Buffer.from(wav).equals(committed)).toBe(true);
  });

  it('encodes arbitrary samples at a custom rate', () => {
    const wav = encodeWav(new Int16Array([1, -1]), 8000);
    expect(wav.length).toBe(48);
    expect(new DataView(wav.buffer).getInt16(46, true)).toBe(-1);
  });
});
