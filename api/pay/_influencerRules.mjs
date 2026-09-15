// Règles d'éligibilité d'un code influenceur au checkout.
// Module pur (aucun accès Firestore) pour pouvoir le tester sans mock.
//
// ⚠️ Un code influenceur refusé ne bloque JAMAIS le paiement : le checkout
// l'ignore et encaisse sans remise ni commission (bug du 14/09/2026 — le code
// de campagne reste pré-rempli 14 jours, la famille ne pouvait plus payer).

export const INFLUENCER_VALIDITY_MS = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 mois
export const INFLUENCER_MAX_USES_PER_PAYER = 2;

/**
 * Renvoie la raison du refus, ou null si le code s'applique.
 * @param {{ createdAt: Date, now?: Date, usageSelfCount: number, ipAlreadyUsed: boolean }} p
 */
export function influencerRefusalReason({ createdAt, now = new Date(), usageSelfCount, ipAlreadyUsed }) {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isFinite(created.getTime()) && created.getTime() + INFLUENCER_VALIDITY_MS < now.getTime()) {
    return 'COUPON_EXPIRED';
  }
  if (usageSelfCount >= INFLUENCER_MAX_USES_PER_PAYER) return 'COUPON_MAX_USAGE_REACHED';
  if (ipAlreadyUsed) return 'COUPON_IP_LIMIT_REACHED';
  return null;
}
