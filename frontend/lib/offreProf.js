// Ce qui rend un prof réservable — règle UNIQUE, partagée par le produit et le
// diagnostic (plan docs/plans/PLAN_PROF_INVISIBLE_25-09-2026.md).
//
// Le 25/09/2026, 10 profs sur 17 ne pouvaient recevoir aucune réservation et
// aucun ne le savait : le produit applique une règle qu'il n'énonce jamais.
// `etatProfil()` énonce cette règle, `EtatProfilProf.jsx` l'affiche.
//
// ⛔ Ne jamais réécrire `nbCreneaux()` ailleurs : `availability` mélange en base
// l'ancien format (objet jour → créneaux) et le nouveau (tableau). Deux
// implémentations de la même règle finissent toujours par diverger.

/** Nombre de créneaux cochés, tous formats d'`availability` confondus. */
export function nbCreneaux(availability) {
  if (!availability) return 0;
  if (Array.isArray(availability)) return availability.length;
  if (typeof availability === 'object') {
    return Object.values(availability).reduce(
      (n, v) => n + (Array.isArray(v) ? v.length : (v ? 1 : 0)),
      0,
    );
  }
  return 0;
}

/**
 * Ce qui manque à un prof pour être réservable, du plus grave au moins grave.
 * @param {{ profil: object, nbAvis?: number }} args
 * @returns {Array<{ code: string, bloquant: boolean, titre: string, texte: string, lien: string, action: string }>}
 *          tableau vide = le prof est réservable, rien à afficher.
 */
export function etatProfil({ profil, nbAvis = 0 } = {}) {
  const t = profil || {};
  const manques = [];

  if (t.offer_enabled === false) {
    manques.push({
      code: 'masque',
      bloquant: true,
      titre: 'Votre profil est masqué',
      texte: "Vous n'apparaissez dans aucune recherche, et aucune famille ne peut vous réserver.",
      lien: '/prof/profile',
      action: 'Réafficher mon profil',
    });
  }

  // Filtre qualité des landings : photo OU au moins un avis
  if (!t.avatarUrl && Number(nbAvis) < 1) {
    manques.push({
      code: 'photo',
      bloquant: true,
      titre: "Votre profil n'apparaît pas encore dans les résultats",
      texte: "Il manque une photo — c'est le seul élément qui bloque. Les familles choisissent un visage avant un tarif.",
      lien: '/prof/profile',
      action: 'Ajouter ma photo',
    });
  }

  if (nbCreneaux(t.availability) === 0) {
    manques.push({
      code: 'creneaux',
      bloquant: true,
      titre: 'Aucune famille ne peut vous réserver',
      texte: "Vous n'avez pas encore indiqué vos disponibilités. Comptez 2 minutes, et vous pourrez les changer quand vous voulez.",
      lien: '/prof/planning',
      action: 'Ouvrir mes créneaux',
    });
  }

  // Manque à gagner, pas un blocage : le prof reste réservable en présentiel
  if (t.visio_enabled && !t.visio_same_rate && !t.visio_price_per_hour) {
    manques.push({
      code: 'visioPrix',
      bloquant: false,
      titre: "Votre tarif visio n'est pas renseigné",
      texte: "Vous avez activé la visio, mais elle ne s'affiche pas sur votre profil tant qu'elle n'a pas de tarif.",
      lien: '/prof/profile',
      action: 'Indiquer mon tarif visio',
    });
  }

  return manques;
}

/** Le prof est-il réservable ? Même règle que `scripts/diag-offre-profs.mjs`. */
export function estReservable({ profil, nbAvis = 0 } = {}) {
  return !etatProfil({ profil, nbAvis }).some((m) => m.bloquant);
}
