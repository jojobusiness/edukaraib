// Programme partenaires — textes et liens côté site.
// Les règles (grille, types) viennent du module partagé avec l'API.
import { PARTNER_KINDS, isPartnerModel } from '../../api/_partners.mjs';

export { PARTNER_KINDS, isPartnerModel };

const SITE = 'https://edukaraib.com';

/** Lien à partager : la landing capte le code et le garde jusqu'au paiement. */
export const partnerShareLink = (code) => `${SITE}/rentree?code=${encodeURIComponent(code || '')}`;

/** Grille affichée au partenaire, selon son modèle. */
export function partnerGridRows(partner) {
  if (isPartnerModel(partner)) {
    return [
      { type: 'Cours d’une heure', famille: '−2 €', partenaire: '+2 €' },
      { type: 'Pack 5 h', famille: '−10 €', partenaire: '+10 €' },
      { type: 'Pack 10 h', famille: '−20 €', partenaire: '+20 €' },
    ];
  }
  return [
    { type: 'Cours à l’unité', famille: '−5 €', partenaire: '+5 €' },
    { type: 'Pack 5 h', famille: '−10 €', partenaire: '+10 €' },
    { type: 'Pack 10 h', famille: '−30 €', partenaire: '+20 €' },
  ];
}

/** Message prêt à transférer aux familles (WhatsApp, mail, groupe Facebook). */
export function partnerShareMessage({ code, structureName }) {
  const who = structureName || 'Notre association';
  return [
    'Bonjour à tous,',
    '',
    `${who} a noué un partenariat avec EduKaraib, une plateforme de cours particuliers avec des professeurs de Guyane et des Antilles, en présentiel ou en visio.`,
    '',
    `Avec le code ${code}, vous bénéficiez de 2 € de remise par heure de cours, et 2 € par heure sont reversés à ${who} pour financer ses projets. Le code s’enregistre sur votre compte au premier paiement : ensuite la remise s’applique toute seule, pour tous vos enfants.`,
    '',
    `Pour en profiter : ${partnerShareLink(code)}`,
    `(ou saisissez le code ${code} au moment du paiement)`,
    '',
    'Les packs de 5 h et 10 h sont les plus avantageux : jusqu’à 20 € de remise pour vous, et 20 € pour l’association.',
  ].join('\n');
}
