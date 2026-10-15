// Suivi des DEMANDES DE MISE EN RELATION — règle unique, partagée par l'onglet
// « Leads » de l'admin et par scripts/diag-messages.mjs.
//
// ⚖️ 15/10/2026 — réécrit après l'analyse du secret des correspondances
// (CPCE art. L32-3 ; plan PLAN_MESSAGES_SECRET_CORRESPONDANCES_15-10-2026.md).
// Joseph : « normalement je ne suis pas censé lire ça ». Il avait raison.
//
// ⛔ Ce module ne touche PLUS à la collection `messages`. Compter les messages
//    d'une conversation est une statistique SUR la correspondance : interdit
//    sans consentement exprès annuel (L32-3 IV), impossible à recueillir
//    proprement auprès d'un mineur de moins de 15 ans.
// ✅ Ce qu'on suit à la place : la « demande de mise en relation », un
//    événement du service au même titre qu'une réservation — la plateforme est
//    payée pour mettre en relation, en suivre l'exécution relève du contrat
//    (RGPD art. 6-1-b). On sait QUI a demandé QUEL prof, QUAND, et si le prof
//    a répondu. Jamais ce qui a été écrit.

export const COLLECTION_DEMANDES = 'demandes_contact';

/** Un compte de test fausserait tous les taux sur une base de cette taille. */
export const estCompteTest = (u) => /test|essai|demo/i.test(`${u?.fullName || ''} ${u?.email || ''}`);

export const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);

/** Médiane (null si rien de mesurable) — plus honnête qu'une moyenne sur 3 valeurs. */
export function mediane(valeurs) {
  const v = valeurs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Durée lisible : « 12 min », « 3.5 h », « 4 j ». */
export function dureeLisible(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const h = ms / 3600000;
  if (h < 1) return `${Math.round(ms / 60000)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${Math.round(h / 24)} j`;
}

/**
 * @param {{ demandes: Array, users?: Array, lessons?: Array, jours?: number, maintenant?: Date }} e
 * @returns {{ lignes: Array, totaux: object, parProf: Array }}
 */
export function statsDemandes({ demandes = [], users = [], lessons = [], jours = 30, maintenant = new Date() } = {}) {
  const parUid = new Map(users.map((u) => [u.uid || u.id, u]));
  const nom = (uid, repli) => parUid.get(uid)?.fullName || parUid.get(uid)?.email || repli || String(uid || '?').slice(0, 8);
  const depuis = new Date(maintenant.getTime() - jours * 86400000);

  // Une réservation a-t-elle suivi ? C'est le seul but de la mise en relation.
  const reserves = new Set();
  for (const l of lessons) {
    const eleve = l.student_id || l.student_uid;
    if (l.teacher_id && eleve) reserves.add(`${eleve}|${l.teacher_id}`);
  }

  const lignes = [];
  for (const d of demandes) {
    const creee = toDate(d.created_at);
    if (!creee || creee < depuis) continue;
    const eleveUid = d.eleve_uid;
    const profUid = d.prof_uid;
    if (!eleveUid || !profUid) continue;
    if (estCompteTest(parUid.get(eleveUid)) || estCompteTest(parUid.get(profUid))) continue;

    const repondu = toDate(d.prof_repondu_at);
    lignes.push({
      id: d.id || `${eleveUid}_${profUid}`,
      eleveUid,
      profUid,
      eleve: nom(eleveUid, d.eleve_prenom),
      prof: nom(profUid, d.prof_nom),
      roleEleve: d.role || parUid.get(eleveUid)?.role || '?',
      creee,
      delai: repondu ? repondu - creee : null,
      attendDepuis: repondu ? null : maintenant - creee,
      statut: reserves.has(`${eleveUid}|${profUid}`) ? 'réservé' : repondu ? 'répondu' : 'sans réponse',
      source: d.source || parUid.get(eleveUid)?.acquisition?.source || '—',
      matiere: d.matiere_profil || '',
    });
  }
  lignes.sort((a, b) => b.creee - a.creee);

  const repondues = lignes.filter((l) => l.delai !== null);
  const reservees = lignes.filter((l) => l.statut === 'réservé');
  const totaux = {
    demandes: lignes.length,
    repondues: repondues.length,
    sansReponse: lignes.filter((l) => l.statut === 'sans réponse').length,
    tauxReponse: lignes.length ? Math.round((100 * repondues.length) / lignes.length) : null,
    delaiMedian: mediane(repondues.map((l) => l.delai)),
    reservees: reservees.length,
    tauxReservation: lignes.length ? Math.round((100 * reservees.length) / lignes.length) : null,
  };

  const parProfMap = new Map();
  for (const l of lignes) {
    const p = parProfMap.get(l.profUid) || { uid: l.profUid, prof: l.prof, recues: 0, repondues: 0, delais: [] };
    p.recues += 1;
    if (l.delai !== null) { p.repondues += 1; p.delais.push(l.delai); }
    parProfMap.set(l.profUid, p);
  }
  const parProf = [...parProfMap.values()]
    .map((p) => ({ ...p, delaiMedian: mediane(p.delais) }))
    .sort((a, b) => b.recues - a.recues);

  return { lignes, totaux, parProf };
}
