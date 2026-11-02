// Fiche d'un compte dans l'admin : les chiffres, à partir des documents (02/11/2026).
// Module pur. ⚖️ Aucune donnée de messagerie : ni contenu, ni compteur de
// messages, ni lectures (secret des correspondances, CPCE L32-3).

const ENCAISSE = ['held', 'processing', 'released', 'payout_pending_rib'];

/** Cours d'un compte : total, faits, à venir, refusés. Sans doublon. */
export function resumeCours(lecons, maintenant = Date.now()) {
  const uniques = [...new Map((lecons || []).map((l) => [l.id, l])).values()];
  const out = { total: uniques.length, termines: 0, aVenir: 0, enAttente: 0, refuses: 0 };
  uniques.forEach((l) => {
    const st = String(l.status || '').toLowerCase();
    if (st === 'completed') out.termines += 1;
    else if (['rejected', 'removed', 'deleted'].includes(st)) out.refuses += 1;
    else if (st === 'confirmed') {
      const d = Date.parse(l.date || '');
      if (Number.isNaN(d) || d >= maintenant - 864e5) out.aVenir += 1;
    } else out.enAttente += 1;
  });
  return out;
}

/** Argent lié au compte : ce qu'il a payé, ou ce qu'il a gagné s'il est prof. */
export function resumePaiements(paiements) {
  const ok = (paiements || []).filter((p) => ENCAISSE.includes(p.status));
  return {
    nb: ok.length,
    paye: ok.reduce((n, p) => n + Number(p.gross_eur || 0), 0),
    gagne: ok.reduce((n, p) => n + Number(p.net_to_teacher_eur || 0), 0),
    rembourses: (paiements || []).filter((p) => p.status === 'refunded').length,
  };
}
