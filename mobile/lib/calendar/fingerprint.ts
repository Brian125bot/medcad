/**
 * Fingerprint of the settings that shape every event. When it changes (names
 * toggled, device time zone moved) every linked event needs an update.
 */
export function contentFingerprint(input: { showNames: boolean; timeZone: string }): string {
  const text = JSON.stringify(['v1', input.showNames, input.timeZone]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
