// Coordonnées publiques d'EduKaraib — une seule source (30/09/2026).
// Utilisées par la page /contact et par le bouton « Nous contacter » de la barre.
export const EMAIL_CONTACT = 'contact@edukaraib.com';

// Numéro au format international, sans espace ni « + » : c'est ce qu'attend wa.me
export const WHATSAPP_NUMERO = '33766437668';
export const WHATSAPP_AFFICHE = '+33 7 66 43 76 68';
const WHATSAPP_MESSAGE = 'Bonjour, je vous contacte depuis edukaraib.com au sujet des cours particuliers.';

export const lienWhatsapp = (message = WHATSAPP_MESSAGE) =>
  `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(message)}`;
