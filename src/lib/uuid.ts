import * as Crypto from 'expo-crypto';

/** Cross-platform UUID v4 for trade ids. Native (expo-crypto) + web safe. */
export function uuid(): string {
  // expo-crypto exposes randomUUID() directly — works native + web.
  try {
    return Crypto.randomUUID();
  } catch { /* fall through */ }
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  try {
    if (g?.crypto && typeof g.crypto.randomUUID === 'function') return g.crypto.randomUUID();
  } catch { /* fall through */ }
  // Final Math.random fallback.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
