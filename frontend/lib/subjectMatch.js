/* ————————————————————————————————————————————————————————————
   Correspondance matière ⇄ libellé saisi par les profs.

   POURQUOI CE FICHIER EXISTE (diagnostic 20/08/2026) :
   Les landings envoient `/search?subject=Maths`, et Search.jsx filtrait par
   `subs.includes(q)` — une simple sous-chaîne. Résultat mesuré sur la base
   réelle :
     • « Maths »           ne matchait PAS « Mathématiques » (mathématiques
                           ne contient pas « maths »)
     • « Physique-Chimie » ne matchait NI « Physique, Chimie » NI
                           « Physique chimie »
   Les boutons de matière des landings étaient donc largement décoratifs :
   l’élève tombait sur la liste non filtrée, sans en-tête de résultats.

   Ce module normalise (accents, ponctuation, casse) et applique une table de
   synonymes. Il est volontairement sans dépendance : utilisable côté landing
   comme côté recherche.
   ———————————————————————————————————————————————————————————— */

/** Minuscule, sans accent, ponctuation réduite à des espaces. */
export function normalizeSubject(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Jetons de recherche par matière canonique (clés déjà normalisées).
 *
 * Deux formes de jetons :
 *   - `'math'`  → correspondance par sous-chaîne (trouve « mathématiques »)
 *   - `'=rh'`   → correspondance par MOT ENTIER (trouve « RH », jamais
 *                 « rhétorique »)
 *
 * La forme `=` existe pour les sigles courts, qu'un `includes()` nu ferait
 * matcher n'importe où. C'est la raison pour laquelle « eco » reste absent :
 * il matcherait « école ». Tout jeton de moins de 4 lettres doit être en `=`.
 */
const SYNONYMES = {
  'maths': ['math'],                                  // math, maths, mathematiques…
  'mathematiques': ['math'],
  'francais': ['francais', 'lettres'],
  'anglais': ['anglais', 'english'],
  'espagnol': ['espagnol'],
  'physique chimie': ['physique', 'chimie'],
  'physique': ['physique'],
  'chimie': ['chimie'],
  'svt': ['svt', 'sciences de la vie', 'biologie'],
  'histoire geo': ['histoire', 'geographie'],
  'philosophie': ['philosophie', 'philo'],
  'ses': ['ses', 'sciences economiques', 'sciences eco'],
  'comptabilite': ['comptabilite', 'compta', 'gestion'],
  // '=rh' en mot entier : Marie-Christine écrit « RH » et non « ressources
  // humaines ». Sans ce jeton elle n'était pas trouvée par Économie-Droit alors
  // qu'elle couvre la matière ET qu'elle est la mieux dotée en créneaux.
  'economie droit': ['economie', 'droit', 'management', 'marketing', 'ressources humaines', '=rh'],
  'informatique': ['informatique', 'bureautique', 'numerique'],
  'creole': ['creole'],
  'musique': ['musique'],
  'aide aux devoirs': ['aide aux devoirs', 'soutien', 'primaire', 'college', 'methodologie'],
};

/** Jetons à chercher pour une requête donnée (repli : la requête elle-même). */
export function subjectTokens(query) {
  const q = normalizeSubject(query);
  if (!q) return [];
  return SYNONYMES[q] ?? [q];
}

/**
 * Vrai si `haystack` (matières + bio du prof, texte libre) correspond à la
 * matière demandée. Comparaison normalisée des deux côtés.
 */
export function subjectMatches(query, haystack) {
  const hay = normalizeSubject(haystack);
  if (!hay) return false;
  const mots = hay.split(' ');
  return subjectTokens(query).some((t) => {
    if (!t) return false;
    // `=jeton` : mot entier. La normalisation ayant déjà réduit toute la
    // ponctuation à des espaces, comparer aux mots suffit — pas besoin de regex
    // (et surtout pas de `\b`, qui coupe sur les lettres accentuées en JS).
    if (t.startsWith('=')) return mots.includes(t.slice(1));
    return hay.includes(t);
  });
}
