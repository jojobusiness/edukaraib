// Ce que deviennent nos e-mails : envoyé, reçu, cliqué, rejeté (03/11/2026).
// Plan : docs/plans/PLAN_SUIVI_EMAILS_27-10-2026.md. Module pur.
//
// ⛔ Jamais d'« ouvert » ni de « lu » : le pixel d'ouverture est un traceur (CNIL),
// beaucoup d'élèves sont mineurs, et un clic sur la notification d'un message ne
// veut pas dire que le message a été lu (secret des correspondances).

export const EVENEMENTS_SUIVIS = [
  'email.sent', 'email.delivered', 'email.clicked',
  'email.bounced', 'email.complained', 'email.failed',
];

const STATUT = {
  'email.sent': 'envoye',
  'email.delivered': 'livre',
  'email.clicked': 'clique',
  'email.bounced': 'rejete',
  'email.complained': 'rejete',
  'email.failed': 'rejete',
};
const RANG = { envoye: 1, livre: 2, clique: 3, rejete: 4 };

/** Tag Resend : lettres ASCII, chiffres, _ et - seulement. */
export function tagType(type) {
  const v = String(type || 'notification').normalize('NFD').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'notification';
  return [{ name: 'type', value: v }];
}

/** Motif lisible d'un rejet, ou null. */
export function motifRejet(evenement) {
  if (evenement?.type === 'email.complained') return 'classé spam';
  if (evenement?.type === 'email.bounced') return 'adresse rejetée';
  if (evenement?.type === 'email.failed') return 'échec d’envoi';
  return null;
}

/**
 * Nouvel état `users/{uid}.dernierMail` après un événement Resend, ou null s'il
 * n'y a rien à écrire (événement non suivi, ou d'un mail plus ancien que le dernier).
 * Un même mail ne recule jamais : rejeté > cliqué > reçu > envoyé.
 */
export function etatApresEvenement(etat, evenement) {
  const statut = STATUT[evenement?.type];
  const id = evenement?.data?.email_id;
  if (!statut || !id) return null;
  const quand = evenement.created_at || new Date().toISOString();
  const creeLe = evenement.data.created_at || quand;
  const memeMail = etat?.resendId === id;
  if (!memeMail && etat?.creeLe && Date.parse(creeLe) < Date.parse(etat.creeLe)) return null;

  const tags = evenement.data.tags || {};
  const type = Array.isArray(tags) ? tags.find((t) => t.name === 'type')?.value : tags.type;
  const base = memeMail ? { ...etat } : {
    resendId: id, creeLe, type: type || 'notification', statut: 'envoye', sujet: String(evenement.data.subject || '').slice(0, 120), nbClics: 0,
  };
  const suivant = { ...base };
  if (RANG[statut] > RANG[base.statut || 'envoye']) suivant.statut = statut;
  if (statut === 'envoye' && !suivant.envoyeLe) suivant.envoyeLe = quand;
  if (statut === 'livre' && !suivant.livreLe) suivant.livreLe = quand;
  if (statut === 'clique') {
    suivant.cliqueLe = suivant.cliqueLe || quand;
    suivant.nbClics = Number(suivant.nbClics || 0) + 1;
  }
  if (statut === 'rejete') suivant.motif = motifRejet(evenement);
  return suivant;
}

/** Libellé de la colonne admin. Jamais « lu » ni « ouvert ». */
export function libelleDernierMail(m) {
  if (!m) return { texte: '—', ton: 'gris' };
  const jour = (v) => (v ? new Date(v).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' }) : '');
  if (m.statut === 'rejete') return { texte: `⚠️ ${m.motif || 'rejeté'}`, ton: 'rouge' };
  if (m.statut === 'clique') return { texte: `✓✓ cliqué le ${jour(m.cliqueLe)}`, ton: 'vert' };
  if (m.statut === 'livre') return { texte: `✓ reçu le ${jour(m.livreLe)}`, ton: 'normal' };
  return { texte: `✉️ envoyé le ${jour(m.envoyeLe || m.creeLe)}`, ton: 'gris' };
}
