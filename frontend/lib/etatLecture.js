// « Vu » sous mon dernier message, comme sur WhatsApp (23/10/2026,
// plan docs/plans/PLAN_DERNIERE_CONNEXION_23-10-2026.md § 3).
//
// ⚖️ L'accusé de lecture montré À L'EXPÉDITEUR, dans sa conversation, fait
// partie du service de messagerie (Joseph, 23/10 : « sur tous les réseaux
// quand quelqu'un a vu le message on est prévenu »). Ce qui reste interdit
// (CPCE L32-3) : que la PLATEFORME compte ou analyse ces lectures. Ne jamais
// en faire une statistique, un export ou une ligne de Diagnostics.

import { enMs } from './derniereVenue';

/**
 * @param {{ sender_uid?: string, sent_at?: unknown }|null} dernierMessage le dernier message de la conversation
 * @param {Record<string, unknown>|undefined} reads conversations/{id}.reads
 * @param {string} moi
 * @param {string} autreUid
 * @returns {null | { etat: 'envoye' } | { etat: 'vu', le: number }}
 *          null si le dernier message n'est pas de moi (rien à afficher)
 */
export function etatLecture(dernierMessage, reads, moi, autreUid) {
  if (!dernierMessage || !moi || dernierMessage.sender_uid !== moi) return null;
  const envoi = enMs(dernierMessage.sent_at);
  const lu = enMs(reads?.[autreUid]);
  // Message en cours d'envoi (horodatage serveur pas encore revenu) : « envoyé »
  if (envoi == null || lu == null || lu < envoi) return { etat: 'envoye' };
  return { etat: 'vu', le: lu };
}

const jourParis = (ms) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

/** « Vu à 18 h 40 », « Vu hier », « Vu le 22/10 ». */
export function libelleVu(le, maintenant = Date.now()) {
  if (jourParis(le) === jourParis(maintenant)) {
    const [h, m] = new Date(le).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).split(':');
    return `Vu à ${Number(h)} h ${m}`;
  }
  if (jourParis(le) === jourParis(maintenant - 24 * 60 * 60 * 1000)) return 'Vu hier';
  return `Vu le ${new Date(le).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' })}`;
}
