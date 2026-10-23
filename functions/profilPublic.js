// Ce qu'on a le droit de montrer d'un compte à quelqu'un d'autre (23/10/2026).
//
// Jusqu'au 23/10, `users` était lisible SANS AUCUN COMPTE : n'importe qui
// listait les 36 comptes avec e-mail, téléphone, date de naissance et
// identifiant Stripe. `users` n'est plus lisible que par soi-même et l'admin ;
// les autres écrans lisent `profils/{uid}`, une copie construite ICI, sur une
// LISTE BLANCHE. Un champ absent de la liste ne sort jamais.
//
// ⚠️ Nouveau champ affiché sur la page publique d'un prof : l'ajouter à
// CHAMPS_PROF, sinon il n'apparaît pas. Ne JAMAIS y mettre email, phone,
// birth, stripeAccountId, acquisition, lastSeenAt, partner_uid, codes parrain.
// Testé par frontend/test/profil-public.test.js.

/** Nom et avatar : tout ce qu'on montre d'un élève, d'un parent, d'un partenaire. */
const CHAMPS_NOM = [
  "uid", "role", "fullName", "firstName", "lastName", "name", "displayName",
  "avatarUrl", "photoURL", "avatar_url",
];

/** La vitrine d'un prof : ce qu'affichent la recherche, l'accueil et sa page. */
const CHAMPS_PROF = [
  ...CHAMPS_NOM,
  "city", "location", "bio", "about_me", "about_course", "tagline",
  "subjects", "subject", "subjectsLabel", "main_subject",
  "diploma", "level", "levels", "teaching_levels", "certificatesUrls", "videoUrl",
  "price_per_hour", "price", "pack5_price", "pack10_price",
  "presentiel_enabled", "presentiel_price_per_hour",
  "visio_enabled", "visio_price_per_hour", "visio_same_rate",
  "visio_pack5_price", "visio_pack10_price",
  "group_enabled", "group_capacity", "availability",
  "offer_enabled", "trial_enabled", "subscription_enabled", "subscription_rate",
  "rating", "avgRating", "reviewsCount",
  // Booléens seulement (« peut être payé ») ; l'identifiant du compte reste privé
  "stripeChargesEnabled", "stripePayoutsEnabled", "email_verified",
  "createdAt",
];

const garder = (data, champs) => {
  const out = {};
  for (const k of champs) if (data[k] !== undefined) out[k] = data[k];
  return out;
};

/**
 * La copie publique d'un document `users`, ou null s'il n'y a rien à publier.
 * @param {string} uid
 * @param {object|null|undefined} data
 * @return {object|null}
 */
function profilPublic(uid, data) {
  if (!data) return null;
  const champs = data.role === "teacher" ? CHAMPS_PROF : CHAMPS_NOM;
  return {...garder(data, champs), uid};
}

module.exports = {profilPublic, CHAMPS_PROF, CHAMPS_NOM};
