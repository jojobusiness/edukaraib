// Ce que chaque paiement nous laisse vraiment (18/10/2026).
//
// Rappel du montage, vérifié dans la doc Stripe le 18/10/2026 :
// on encaisse « tarif prof + commission » sur le compte de la PLATEFORME
// (paiements et transferts distincts, aucun application_fee), puis on verse
// au prof 100 % de son tarif. Stripe débite ses frais de NOTRE solde :
// « Le solde de votre compte sera débité du coût des frais Stripe, des
// remboursements et des contestations de paiement. »
// → Le prof touche toujours son plein tarif. Les frais sortent de notre part.
//
// Conséquence à surveiller, et seule raison d'être de ce module : quand un
// coupon ramène la commission à 0 €, le prof garde ses 100 % et c'est nous qui
// payons les frais Stripe. On ne bloque rien — on veut juste le chiffre.
//
// Sources (lues le 18/10/2026) :
//   stripe.com/fr/pricing · stripe.com/fr/connect/pricing
//   docs.stripe.com/connect/separate-charges-and-transfers
//   docs.stripe.com/refunds (« Les frais de traitement Stripe appliqués à la
//   transaction initiale ne sont pas remboursés »)

/** Grille Stripe France, en centimes. Un pourcentage du brut + un fixe. */
export const GRILLES = {
  carte_eee:   { pct: 0.015,  fixe: 25, libelle: 'Carte EEE' },
  carte_uk:    { pct: 0.025,  fixe: 25, libelle: 'Carte UK' },
  carte_monde: { pct: 0.0315, fixe: 25, libelle: 'Carte hors EEE' },
  klarna:      { pct: 0.0499, fixe: 40, libelle: 'Klarna' },
};
/** Sans information sur la carte, Stripe facture au moins ça : on n'optimiste pas. */
export const GRILLE_DEFAUT = 'carte_eee';

/** Connect : 0,25 % + 0,10 € par virement vers le compte du prof. */
export const VIREMENT = { pct: 0.0025, fixe: 10 };
/** Connect : 2 €/mois par compte connecté ayant reçu un virement dans le mois. */
export const COMPTE_ACTIF_CENTS = 200;

const cents = (euros) => Math.round(Number(euros || 0) * 100);
const nombre = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Grille applicable à partir du moyen de paiement enregistré sur le paiement. */
export function grilleDe(methode) {
  const m = String(methode || '').toLowerCase();
  if (m === 'klarna') return 'klarna';
  return GRILLE_DEFAUT;
}

/** Frais Stripe estimés sur un encaissement, faute de montant réel. */
export function fraisStripeEstimes(brutCents, methode) {
  if (!(brutCents > 0)) return 0;
  const g = GRILLES[grilleDe(methode)];
  return Math.round(brutCents * g.pct) + g.fixe;
}

/** Coût du virement au prof. Nul tant que rien n'a été versé. */
export function fraisVirement(verseCents) {
  if (!(verseCents > 0)) return 0;
  return Math.round(verseCents * VIREMENT.pct) + VIREMENT.fixe;
}

/**
 * Marge d'un paiement, en centimes.
 *
 * `stripe_fee_cents` est le montant RÉEL lu sur l'opération de solde Stripe
 * (balance_transaction.fee, « Fees (in the smallest currency unit) paid for
 * this transaction »), posé par le webhook. Tant qu'il manque — paiements
 * d'avant le 18/10/2026, ou frais pas encore disponibles — on estime, et on
 * le dit : `estime: true`.
 *
 * Remboursement : Stripe ne rend pas ses frais. Notre commission part au
 * prorata du montant rendu, exactement comme `refund.mjs` reprend la part du
 * prof au prorata.
 */
export function margePaiement(pay = {}) {
  const brut = cents(pay.gross_eur);
  const prof = cents(pay.net_to_teacher_eur);
  // La commission réelle, c'est ce qui reste en main — pas le champ annoncé.
  const commissionBrute = brut > 0 ? Math.max(0, brut - prof) : cents(pay.fee_eur);

  const rembourse = cents(pay.refund_amount_eur);
  const partRendue = brut > 0 ? Math.min(1, rembourse / brut) : 0;
  const commission = Math.round(commissionBrute * (1 - partRendue));

  const reel = nombre(pay.stripe_fee_cents);
  const fraisStripe = reel !== null ? reel : fraisStripeEstimes(brut, pay.payment_method_type);
  const verse = ['released', 'refunded', 'refunding'].includes(pay.status) ? prof : 0;
  const virement = fraisVirement(verse);

  return {
    brut,
    prof,
    commission,
    fraisStripe,
    virement,
    net: commission - fraisStripe - virement,
    estime: reel === null,
    methode: grilleDe(pay.payment_method_type),
    rembourse: rembourse > 0,
  };
}

/** Les paiements réellement encaissés : une session abandonnée ne coûte rien. */
export const estEncaisse = (pay = {}) => !!pay.status && pay.status !== 'pending';

/**
 * Relevé pour l'admin. `negatifs` est la seule alerte : ces paiements-là nous
 * ont coûté plus qu'ils ne nous ont rapporté — le prof, lui, a eu ses 100 %.
 */
export function resumeMarges(paiements = []) {
  const lignes = paiements.filter(estEncaisse).map((p) => ({ ...margePaiement(p), source: p }));
  const somme = (cle) => lignes.reduce((t, l) => t + l[cle], 0);

  return {
    nbPaiements: lignes.length,
    encaisse: somme('brut'),
    verseProfs: somme('prof'),
    commission: somme('commission'),
    fraisStripe: somme('fraisStripe'),
    fraisVirement: somme('virement'),
    net: somme('net'),
    estimes: lignes.filter((l) => l.estime).length,
    negatifs: lignes.filter((l) => l.net < 0).sort((a, b) => a.net - b.net),
  };
}
