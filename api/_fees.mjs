export const PLATFORM_FEE_RATE = 0.05; // 5%

export function calcFeeCents(totalCents) {
  return Math.max(0, Math.round(totalCents * PLATFORM_FEE_RATE));
}