// Barre de contact tout en haut du site (30/09/2026, demande de Joseph).
// Un parent qui hésite doit pouvoir écrire en un geste, depuis son téléphone,
// sans chercher la page Contact : mail d'un côté, WhatsApp de l'autre.
// ⚠️ Cibles tactiles d'au moins 44 px de haut — c'est un bandeau fait pour le pouce.
import React from 'react';

export const EMAIL_CONTACT = 'contact@edukaraib.com';
// Numéro au format international sans espace ni « + » pour wa.me
export const WHATSAPP_NUMERO = '33766437668';
export const WHATSAPP_AFFICHE = '+33 7 66 43 76 68';
const WHATSAPP_MESSAGE = 'Bonjour, je vous contacte depuis edukaraib.com au sujet des cours particuliers.';

export const lienWhatsapp = (message = WHATSAPP_MESSAGE) =>
  `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(message)}`;

export default function BandeauContact() {
  return (
    <div className="bg-primary text-white text-sm">
      <div className="mx-auto flex max-w-6xl items-stretch justify-center gap-2 px-3 py-1.5 sm:justify-end sm:gap-6">
        <a
          href={`mailto:${EMAIL_CONTACT}`}
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg px-3 font-semibold hover:bg-white/15 sm:flex-none"
        >
          <span role="img" aria-hidden="true">✉️</span>
          <span className="truncate">{EMAIL_CONTACT}</span>
        </a>

        <a
          href={lienWhatsapp()}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-[#25D366] px-3 font-semibold text-[#07351d] hover:brightness-95 sm:flex-none"
        >
          <span role="img" aria-hidden="true">💬</span>
          <span>WhatsApp</span>
          <span className="hidden md:inline font-normal">{WHATSAPP_AFFICHE}</span>
        </a>
      </div>
    </div>
  );
}
