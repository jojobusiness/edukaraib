// Indicatifs des DOM (09/11/2026). Module pur, importé par le front et les scripts.
//
// Le cas réel : une prof de Cayenne inscrite avec « +33 6 94 … ». Un 0694 est un
// mobile guyanais : son vrai numéro international est +594 694 …, et un SMS ou un
// WhatsApp vers +33 694 … n'arrive pas. Beaucoup de gens des DOM tapent +33 par
// habitude ; à l'inverse, un Parisien qui garde l'indicatif par défaut (Guyane)
// obtient « +594 6 12 … ». On remet le bon indicatif dans les deux sens.

// Préfixes nationaux (sans le 0) → indicatif du territoire
const PREFIXES_DOM = [
  ['690', '590'], ['691', '590'], ['590', '590'], // Guadeloupe, Saint-Martin, Saint-Barthélemy
  ['694', '594'], ['594', '594'], // Guyane
  ['696', '596'], ['697', '596'], ['596', '596'], // Martinique
  ['692', '262'], ['693', '262'], ['262', '262'], ['263', '262'], // La Réunion
  ['639', '262'], ['269', '262'], // Mayotte
];
const INDICATIFS_DOM = ['590', '594', '596', '262'];

// Pays proposés par défaut dans le champ téléphone (codes ISO de react-phone-number-input)
export const PAYS_TELEPHONE = new Set(['GF', 'GP', 'MQ', 'RE', 'YT', 'MF', 'BL', 'FR', 'HT', 'CI', 'SN', 'CM', 'BE', 'CA', 'CH']);
export const PAYS_PAR_DEFAUT = 'GF';

const INDICATIF_PAYS = { '590': 'GP', '594': 'GF', '596': 'MQ', '262': 'RE', '33': 'FR' };

/** Remet le bon indicatif sur un numéro E.164 (« +33694… » → « +594694… »). Ne lève jamais. */
export function corrigerIndicatif(numero) {
  const n = typeof numero === 'string' ? numero.replace(/[\s.-]/g, '') : '';
  if (!/^\+\d{6,15}$/.test(n)) return numero || '';
  // +33 suivi d'un numéro des DOM
  if (n.startsWith('+33') && n.length === 12) {
    const national = n.slice(3);
    const dom = PREFIXES_DOM.find(([p]) => national.startsWith(p));
    if (dom) return `+${dom[1]}${national}`;
  }
  // Indicatif DOM suivi d'un mobile de métropole (06 12 …) → +33
  for (const ind of INDICATIFS_DOM) {
    if (n.startsWith(`+${ind}`) && n.length === ind.length + 10) {
      const national = n.slice(ind.length + 1);
      const estDom = PREFIXES_DOM.some(([p]) => national.startsWith(p));
      if (!estDom && national.startsWith('6')) return `+33${national}`;
    }
  }
  return n;
}

/** Territoire déduit d'un numéro (après correction) : 'GF', 'GP', 'MQ', 'RE', 'FR' ou ''. */
export function paysDepuisTelephone(numero) {
  const n = corrigerIndicatif(numero);
  if (n.startsWith('+262')) return n.slice(4).startsWith('639') || n.slice(4).startsWith('269') ? 'YT' : 'RE';
  const ind = Object.keys(INDICATIF_PAYS).find((i) => n.startsWith(`+${i}`));
  return ind ? INDICATIF_PAYS[ind] : '';
}

/** Code pays de l'en-tête Vercel, nettoyé (2 lettres majuscules) ou ''. */
export function paysDepuisEntete(valeur) {
  const p = String(valeur || '').toUpperCase().replace(/[^A-Z]/g, '');
  return p.length === 2 ? p : '';
}
