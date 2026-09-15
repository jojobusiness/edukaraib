// Programme partenaires EduKaraib — règles partagées (checkout, webhook, admin, front).
// Module pur : aucun import Firestore ni Node, la base est passée en paramètre.
//
// Deux modèles coexistent dans la collection Firestore `influencers` (nom
// historique conservé pour ne pas migrer les comptes existants) :
//  - model: 'partenaire' (depuis le 15/09/2026) : 2 €/h de remise pour la
//    famille + 2 €/h reversés au partenaire, sur TOUS les achats de la famille,
//    sans limite d'usage ni d'IP, jusqu'à `expires_at`. La famille est rattachée
//    au partenaire à son 1er paiement (users/{uid}.partner_uid) : ensuite la
//    remise s'applique toute seule, pour tous ses enfants.
//  - sans `model` (anciens codes, ex. LHATIEN81) : grille historique
//    -5/-10/-30 € et +5/+10/+20 €, 2 usages par payeur, 1 par IP, 6 mois.
// ⚠️ Un code refusé ne bloque JAMAIS le paiement : le checkout l'ignore.

export const PARTNERS_COLLECTION = 'influencers';
export const PARTNER_USAGES_COLLECTION = 'influencer_usages';
/** Rôle stocké dans users/{uid}.role pour un compte partenaire (valeur historique). */
export const PARTNER_ROLE = 'influencer';

export const PARTNER_MODEL = 'partenaire';
/** Remise famille ET reversement partenaire, par heure facturée. */
export const PARTNER_CENTS_PER_HOUR = 200;

export const PARTNER_KINDS = {
  association: 'Association de parents',
  etablissement: 'Établissement scolaire',
  etudiants: 'Association étudiante',
  groupe: 'Groupe Facebook / communauté',
  createur: 'Créateur de contenu',
  autre: 'Autre',
};

export const PARTNER_CODE_REGEX = /^[A-Z0-9-]{4,20}$/;

const LEGACY_VALIDITY_MS = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 mois
const LEGACY_MAX_USES_PER_PAYER = 2;

/** Fin de l'année scolaire 2026-2027 (heure de Guyane). */
export function defaultPartnerExpiry() {
  return new Date('2027-07-31T23:59:59-03:00');
}

export const isPartnerModel = (partner) => partner?.model === PARTNER_MODEL;

/** Les limites par payeur / IP ne concernent que les anciens codes. */
export const needsUsageChecks = (partner) => !isPartnerModel(partner);

function toDate(v) {
  if (!v) return null;
  const d = v?.toDate?.() || (v instanceof Date ? v : new Date(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Raison du refus d'un code partenaire, ou null s'il s'applique.
 * @param {{ partner: object, partnerId: string, payerUid?: string, now?: Date,
 *           usageSelfCount?: number, ipAlreadyUsed?: boolean }} p
 */
export function partnerRefusalReason({
  partner, partnerId, payerUid, now = new Date(), usageSelfCount = 0, ipAlreadyUsed = false,
}) {
  // Le partenaire ne peut pas utiliser son propre code.
  if (payerUid && (payerUid === partnerId || payerUid === partner?.uid)) return 'COUPON_SELF';

  if (isPartnerModel(partner)) {
    const exp = toDate(partner.expires_at);
    if (exp && exp.getTime() < now.getTime()) return 'COUPON_EXPIRED';
    return null;
  }

  const created = toDate(partner?.created_at);
  if (created && created.getTime() + LEGACY_VALIDITY_MS < now.getTime()) return 'COUPON_EXPIRED';
  if (usageSelfCount >= LEGACY_MAX_USES_PER_PAYER) return 'COUPON_MAX_USAGE_REACHED';
  if (ipAlreadyUsed) return 'COUPON_IP_LIMIT_REACHED';
  return null;
}

/** Remise famille et reversement partenaire, en centimes. */
export function partnerAmounts({ partner, packMode, billedHours }) {
  const hours = Math.max(1, Number(billedHours) || 1);
  if (isPartnerModel(partner)) {
    return { discountCents: PARTNER_CENTS_PER_HOUR * hours, commissionCents: PARTNER_CENTS_PER_HOUR * hours };
  }
  if (!packMode) return { discountCents: 500, commissionCents: 500 };
  if (hours === 5) return { discountCents: 1000, commissionCents: 1000 };
  if (hours === 10) return { discountCents: 3000, commissionCents: 2000 };
  return { discountCents: 0, commissionCents: 0 };
}

export const normalizePartnerCode = (raw) => String(raw || '').trim().toUpperCase();

/** Code lisible tiré du nom de la structure : « APE Lycée Melkior » → APELYCEEMELK42. */
export function codeFromName(name) {
  const base = String(name || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toUpperCase().replace(/[^A-Z0-9]/g, '')
    .slice(0, 12) || 'PARTENAIRE';
  return base + String(Math.floor(Math.random() * 90) + 10);
}

/** Un cours est reversé au partenaire 7 jours après son paiement (délai de remboursement). */
export const PARTNER_TRANSFER_DELAY_DAYS = 7;
/** En dessous d'1 €, on cumule jusqu'au passage suivant du cron. */
export const PARTNER_MIN_TRANSFER_CENTS = 100;

/**
 * Montant à transférer au partenaire maintenant : les reversements des cours
 * payés depuis le dernier transfert et d'au moins 7 jours, remboursements
 * déduits, sans jamais dépasser le solde dû (`pendingPayout`, qui intègre les
 * remboursements survenus après un transfert).
 * @returns {{ amountCents: number, cutoff: Date }}
 */
export function partnerTransferDue({
  conversions = [], transferredUntil = null, pendingPayout = 0, now = new Date(),
  delayDays = PARTNER_TRANSFER_DELAY_DAYS,
}) {
  const cutoff = new Date(now.getTime() - delayDays * 24 * 60 * 60 * 1000);
  const from = toDate(transferredUntil);
  let eligibleCents = 0;
  for (const c of conversions || []) {
    const at = toDate(c?.paid_at);
    if (!at || at.getTime() > cutoff.getTime()) continue;
    if (from && at.getTime() <= from.getTime()) continue;
    eligibleCents += Math.max(0, Math.round((Number(c.amount_eur || 0) - Number(c.refunded_eur || 0)) * 100));
  }
  const pendingCents = Math.round(Number(pendingPayout || 0) * 100);
  return { amountCents: Math.max(0, Math.min(eligibleCents, pendingCents)), cutoff };
}

/**
 * Rattache la famille (le payeur) au partenaire, une fois pour toutes :
 * le premier partenaire gagne, seul l'admin peut changer ensuite.
 * @returns {Promise<boolean>} true si le rattachement vient d'être créé.
 */
export async function linkFamilyToPartner(db, payerUid, partnerUid) {
  if (!payerUid || !partnerUid || String(payerUid) === String(partnerUid)) return false;
  const userRef = db.collection('users').doc(String(payerUid));
  const partnerRef = db.collection(PARTNERS_COLLECTION).doc(String(partnerUid));
  return db.runTransaction(async (tx) => {
    // Firestore : toutes les lectures avant les écritures.
    const userSnap = await tx.get(userRef);
    const partnerSnap = await tx.get(partnerRef);
    if (!userSnap.exists || userSnap.data()?.partner_uid || !partnerSnap.exists) return false;
    tx.update(userRef, { partner_uid: String(partnerUid), partner_linked_at: new Date() });
    tx.update(partnerRef, { familiesCount: (partnerSnap.data()?.familiesCount || 0) + 1 });
    return true;
  });
}
