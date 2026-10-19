// Onglet admin « Paiements & Revenus » — règles de lecture (19/10/2026).
//
// L'ancien onglet lisait des champs que plus rien n'écrit (`status ===
// 'succeeded'`, `amount` en centimes, `teacher_id`, collections `refunds` et
// `payouts`) : tous ses totaux valaient 0. La vérité vit sur le document
// `payments`, tel que l'écrivent create-checkout-session → stripe-webhook →
// trigger-payout → refund :
//   gross_eur · fee_eur · net_to_teacher_eur · teacher_uid · payer_uid ·
//   status · refund_amount_eur · transfer_id · released_at · is_pack · billed_hours
//
// Le prof touche toujours 100 % de `net_to_teacher_eur` : c'est ce qu'on lui doit.

/** Cycle de vie d'un paiement, dans l'ordre où il le parcourt. */
export const STATUTS = {
  pending:            { libelle: 'Non finalisé',                     ton: 'gris',  encaisse: false },
  held:               { libelle: 'Encaissé · cours pas encore fait', ton: 'bleu',  encaisse: true },
  processing:         { libelle: 'Virement au prof en cours',        ton: 'bleu',  encaisse: true },
  released:           { libelle: 'Versé au prof',                    ton: 'vert',  encaisse: true },
  payout_pending_rib: { libelle: 'Dû au prof · Stripe non connecté', ton: 'ambre', encaisse: true },
  refunding:          { libelle: 'Remboursement en cours',           ton: 'ambre', encaisse: true },
  refunded:           { libelle: 'Remboursé',                        ton: 'rouge', encaisse: true },
};
const INCONNU = { libelle: 'Statut inconnu', ton: 'gris', encaisse: false };

const eur = (v) => Math.round(Number(v || 0) * 100) / 100;
const toDate = (v) => {
  if (!v) return null;
  const d = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(d?.getTime?.()) ? null : d;
};

/** Un document `payments` → une ligne lisible. Ne lève jamais. */
export function normaliser(p = {}) {
  const statut = String(p.status || '');
  const s = STATUTS[statut] || INCONNU;
  const brut = eur(p.gross_eur);
  const rembourse = statut === 'refunded' && !(Number(p.refund_amount_eur) > 0)
    ? brut // remboursement total enregistré sans montant
    : eur(p.refund_amount_eur);
  return {
    id: p.id,
    date: toDate(p.created_at) || toDate(p.updated_at),
    verseLe: toDate(p.released_at),
    profUid: p.teacher_uid || p.teacher_id || null,
    payeurUid: p.payer_uid || null,
    brut,
    partProf: eur(p.net_to_teacher_eur),
    commission: eur(p.fee_eur),
    rembourse,
    statut,
    libelle: s.libelle,
    ton: s.ton,
    encaisse: s.encaisse,
    pack: !!p.is_pack,
    heures: Number(p.billed_hours) || 1,
    partenaire: eur(p.partner_commission_eur),
    // Ce que refund.mjs sait traiter : avant versement (refund simple) ou
    // après (reverse transfer + refund).
    remboursable: statut === 'held' || statut === 'released',
    aVerser: statut === 'payout_pending_rib',
  };
}

/** Filtre de l'écran. `du`/`au` au format AAAA-MM-JJ, bornes incluses. */
export function filtrer(lignes = [], { du = '', au = '', statut = 'tous', nonFinalises = false } = {}) {
  const debut = du ? new Date(`${du}T00:00:00`).getTime() : -Infinity;
  const fin = au ? new Date(`${au}T23:59:59`).getTime() : Infinity;
  return lignes.filter((l) => {
    if (!nonFinalises && !l.encaisse) return false;
    if (statut !== 'tous' && l.statut !== statut) return false;
    const t = l.date ? l.date.getTime() : null;
    if ((du || au) && t === null) return false;
    return t === null || (t >= debut && t <= fin);
  });
}

const somme = (lignes, cle) => eur(lignes.reduce((t, l) => t + l[cle], 0));

/** Les chiffres du haut de l'écran, sur les seuls paiements encaissés. */
export function totaux(lignes = []) {
  const ok = lignes.filter((l) => l.encaisse);
  const de = (...statuts) => ok.filter((l) => statuts.includes(l.statut));
  return {
    nb: ok.length,
    encaisse: somme(ok, 'brut'),
    rembourse: somme(ok, 'rembourse'),
    commission: somme(ok.filter((l) => l.statut !== 'refunded'), 'commission'),
    verseProfs: somme(de('released'), 'partProf'),
    enAttenteCours: somme(de('held', 'processing'), 'partProf'),
    duAuxProfs: somme(de('payout_pending_rib'), 'partProf'),
    nbDus: de('payout_pending_rib').length,
  };
}

/** Une ligne par prof : ce qu'il a fait encaisser, ce qu'il a reçu, ce qu'on lui doit. */
export function parProf(lignes = []) {
  const parUid = new Map();
  lignes.filter((l) => l.encaisse && l.profUid).forEach((l) => {
    const r = parUid.get(l.profUid) || { profUid: l.profUid, nb: 0, encaisse: 0, verse: 0, enAttente: 0, du: 0, rembourse: 0 };
    r.nb += 1;
    r.encaisse += l.brut;
    r.rembourse += l.rembourse;
    if (l.statut === 'released') r.verse += l.partProf;
    if (l.statut === 'held' || l.statut === 'processing') r.enAttente += l.partProf;
    if (l.statut === 'payout_pending_rib') r.du += l.partProf;
    parUid.set(l.profUid, r);
  });
  return [...parUid.values()]
    .map((r) => ({
      ...r,
      encaisse: eur(r.encaisse), verse: eur(r.verse), enAttente: eur(r.enAttente), du: eur(r.du), rembourse: eur(r.rembourse),
    }))
    .sort((a, b) => b.du - a.du || b.encaisse - a.encaisse);
}
