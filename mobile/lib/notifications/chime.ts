/**
 * COR-76 reminder chime: deterministic 16-bit PCM mono WAV synthesis.
 *
 * Two sine tones with exponential decay and a short linear fade-out so the
 * file never clips or clicks. `scripts/generate-chime.ts` writes the result
 * to `assets/sounds/cadencerx_chime.wav`; a test asserts the committed file
 * matches byte for byte.
 */

/** Chime tones in Hz (A5 then E6). Change here only. */
export const CHIME_TONE_HZ = [880, 1320] as const;
export const CHIME_SAMPLE_RATE = 44100;
export const CHIME_DURATION_SECONDS = 1.2;
/** Seconds between the start of each tone. */
export const CHIME_TONE_SPACING_SECONDS = 0.18;
const DECAY_SECONDS = 0.35;
const FADE_OUT_SECONDS = 0.05;
const TONE_GAIN = 0.4;
const WAV_HEADER_BYTES = 44;

export function chimeSampleCount(): number {
  return Math.round(CHIME_SAMPLE_RATE * CHIME_DURATION_SECONDS);
}

export function synthesizeChimeSamples(): Int16Array {
  const count = chimeSampleCount();
  const fadeSamples = Math.round(CHIME_SAMPLE_RATE * FADE_OUT_SECONDS);
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / CHIME_SAMPLE_RATE;
    let value = 0;
    CHIME_TONE_HZ.forEach((hz, index) => {
      const start = index * CHIME_TONE_SPACING_SECONDS;
      if (t < start) return;
      const local = t - start;
      value += TONE_GAIN * Math.exp(-local / DECAY_SECONDS) * Math.sin(2 * Math.PI * hz * local);
    });
    const remaining = count - i;
    if (remaining <= fadeSamples) value *= (remaining - 1) / fadeSamples;
    out[i] = Math.round(value * 32767);
  }
  return out;
}

export function encodeWav(samples: Int16Array, sampleRate = CHIME_SAMPLE_RATE): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  samples.forEach((s, i) => view.setInt16(WAV_HEADER_BYTES + i * 2, s, true));
  return new Uint8Array(buffer);
}

export function synthesizeChimeWav(): Uint8Array {
  return encodeWav(synthesizeChimeSamples());
}
