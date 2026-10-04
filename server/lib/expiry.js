/**
 * Credential lifetimes the user picks when signing a client in (OAuth consent page) or generating
 * a module token: 1 day / 1 week / 1 month / unlimited. Unlimited is the default — station
 * connections are meant to be permanent and stay revocable from 🔑 Access.
 */
export const EXPIRY_CHOICES = [
  { value: 'never', label: 'Unlimited', ms: null },
  { value: '1d', label: '1 day', ms: 86400e3 },
  { value: '1w', label: '1 week', ms: 7 * 86400e3 },
  { value: '1m', label: '1 month', ms: 30 * 86400e3 },
];

/** Absolute expiry in ms for a choice value, or null for unlimited (also the fallback for junk). */
export function expiryFromChoice(value, now = Date.now()) {
  const c = EXPIRY_CHOICES.find((x) => x.value === value);
  return c && c.ms ? now + c.ms : null;
}
