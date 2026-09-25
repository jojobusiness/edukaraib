# PLAN — « Le prof ne sait pas qu'il est invisible »

**Créé le 25/09/2026.** Demandé par Joseph le 25/09.
**Une seule livraison : un bandeau d'état dans l'espace prof.** Pas de refonte, pas de blocage, pas de migration.

> ✅ **EXÉCUTÉ LE 25/09/2026** — bandeau en ligne, 156 tests verts, build vert.
> - `frontend/lib/offreProf.js` (`nbCreneaux` + `etatProfil` + `estReservable`), `frontend/components/EtatProfilProf.jsx`, inséré dans `TeacherDashboard.jsx` sous le titre. `scripts/diag-offre-profs.mjs` importe désormais `nbCreneaux` au lieu de sa copie (relancé : mêmes chiffres, 17 profs).
> - 18 tests : les 11 cas du plan (`frontend/lib/offreProf.test.js`) + 4 de rendu (`frontend/test/etat-profil-prof.test.jsx`, le bandeau s'affiche et pointe vers le bon écran).
> - **Écart assumé** : `nbAvis` vient de la requête `reviews` **déjà faite** par le tableau de bord (`reviewsSnap.size`), pas de `profil.reviewsCount`. Ce champ n'est écrit nulle part dans le code : il vaudrait toujours 0, et un prof noté sans photo aurait vu « il manque une photo » à tort. Aucune lecture Firestore en plus.
> - ▶️ **Mesure le 02/10/2026** : `node scripts/diag-offre-profs.mjs`. Référence du 25/09 : **17 inscrits · 14 filtrés · 9 avec créneaux · 7 réservables**.

---

## 1. Le problème, mesuré

Relevé du **25/09/2026** (`node scripts/diag-offre-profs.mjs`) :

| | |
|---|---|
| Profs inscrits | **17** |
| Passent le filtre qualité | **14** |
| Ont au moins un créneau | **9** |
| **Réellement réservables** | **7** |

**10 profs sur 17 ne peuvent recevoir aucune réservation. Aucun d'eux n'en est informé par le produit.**

### La règle réelle, lue dans le code
`scripts/diag-offre-profs.mjs` et les landings appliquent la même chose :

```js
const photo   = !!t.avatarUrl;
const visible = t.offer_enabled !== false && (photo || nbAvis >= 1);   // filtre qualité
const reservable = visible && nbCreneaux(t.availability) > 0;
```

➜ **Un prof est réservable si et seulement si** : `offer_enabled !== false` **ET** (`avatarUrl` **OU** ≥ 1 avis) **ET** au moins un créneau dans `availability`.
⚠️ Et sous 3 profs qui passent le filtre, **la section « profs dispo » disparaît entièrement de `/bac` et `/rentree`**.

### Les trois cas réels qui ont déclenché ce plan
| Prof | Ce qu'il a fait | Ce que le produit en fait | Ce qu'il en sait |
|---|---|---|---|
| **Aurélie ARCON** (Le Moule) | a ouvert **3 créneaux** | `avatarUrl` vide → **filtrée, invisible partout** | **rien** |
| **Belgica Alfaro** (en ligne) | profil complet, photo | **0 créneau** → introuvable | **rien** |
| **Durock** (Matoury) | visio cochée, 5 créneaux | `visio_price_per_hour` vide → `getPriceLines()` **masque la ligne visio** | **rien** |

🔑 **C'est le même défaut trois fois : le produit applique une règle qu'il n'énonce jamais.** Aurélie a fait le travail (3 créneaux) et n'en tire rien, faute d'une photo que personne ne lui a demandée.

### Pourquoi ce ticket plutôt qu'une relance
Ces trois profs devaient recevoir un message à la main le 23/09. **Ils ne l'ont pas reçu — Joseph avait autre chose à faire, ce qui est exactement le problème.** Une correction qui dépend d'un rappel humain à chaque nouveau prof ne tient pas : elle marche 3 fois, puis elle est oubliée. **Le produit, lui, n'oublie pas.**
⚠️ **Portée assumée** : ce ticket ne crée pas de demande, et la demande est le vrai goulot (0 réservation). Il est retenu parce qu'il est **ponctuel, petit, et qu'il supprime une corvée récurrente** — pas parce qu'il remplacerait le travail sur la demande.

---

## 2. Ce qu'on livre

**Un bandeau d'état en haut de `/prof/dashboard`**, qui dit en clair ce qui manque pour être réservable, et **emmène directement à l'écran qui le corrige**.

### Emplacement
`frontend/pages/TeacherDashboard.jsx`, **juste après le bloc `<h2>Tableau de bord Professeur</h2>`** (ligne ~363, avant `<div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">`).

### Nouveau composant
`frontend/components/EtatProfilProf.jsx` — il reçoit le document `users/{uid}` et le nombre d'avis, et rend soit le bandeau, soit `null`.

```
Props : { profil, nbAvis }
Rend  : null si tout est bon, sinon un bandeau avec 1 à 3 lignes d'action.
```

### Les conditions, dans cet ordre de gravité

| # | Condition détectée | Message affiché | Bouton → |
|---|---|---|---|
| 1 | `offer_enabled === false` | **Votre profil est masqué.** Vous n'apparaissez dans aucune recherche. | `/prof/profile` |
| 2 | `!avatarUrl && nbAvis < 1` | **Votre profil n'apparaît pas encore dans les résultats.** Il manque une photo — c'est le seul élément qui bloque. | `/prof/profile` |
| 3 | `nbCreneaux(availability) === 0` | **Aucune famille ne peut vous réserver :** vous n'avez pas encore de créneau. Comptez 2 minutes, et vous pourrez les changer quand vous voulez. | `/prof/planning` |
| 4 | `visio_enabled && !visio_same_rate && !visio_price_per_hour` | **Votre tarif visio n'est pas renseigné**, donc la visio ne s'affiche pas sur votre profil. | `/prof/profile` |

- **Les conditions 1 à 3 sont bloquantes** → bandeau **ambre**, titre *« Votre profil n'est pas encore réservable »*.
- **La condition 4 seule est un manque à gagner**, pas un blocage → bandeau **bleu**, titre *« Un réglage vous fait perdre des réservations »*.
- **Si plusieurs conditions sont vraies, on les affiche toutes**, dans l'ordre du tableau. On ne cache pas la 3ᵉ parce que la 2ᵉ existe : le prof doit voir tout ce qui lui reste à faire, sinon il revient trois fois.
- **Si aucune n'est vraie** : le composant rend `null`. ⛔ **Pas de bandeau vert « tout va bien »** — un bandeau permanent finit par ne plus être lu.

### Réutiliser, ne pas réécrire
`nbCreneaux(availability)` existe déjà dans `scripts/diag-offre-profs.mjs` et gère **les deux formats** d'`availability` présents en base (tableau **et** objet).
➜ **L'extraire dans `frontend/lib/offreProf.js`** et l'importer des deux côtés. ⛔ Ne pas en écrire une deuxième version : deux implémentations d'une même règle finiront par diverger, et c'est précisément ce qui a produit le bug du MRR sur Factur'Peyi le 20/09.

À exporter depuis `frontend/lib/offreProf.js` :
```js
export function nbCreneaux(availability)      // copie exacte du script
export function etatProfil({ profil, nbAvis }) // → [{ code, gravite, texte, lien }]
```

### Où lire `nbAvis`
`TeacherDashboard.jsx` charge déjà le document utilisateur (voir `userSnap` ~ligne 307). Utiliser **`profil.reviewsCount ?? 0`** — c'est ce que le script prend en repli quand la collection `reviews` n'est pas interrogeable.
⛔ **Ne pas ajouter une requête sur `reviews` depuis le tableau de bord** pour ça : le champ suffit, et le tableau de bord a déjà un timeout de charge connu (`AdminDashboard`).

---

## 3. Ce qu'on ne fait PAS dans ce ticket

- ⛔ **Ne rien rendre obligatoire à l'inscription.** Ajouter une photo obligatoire changerait le taux d'inscription des profs, et on n'a pas de quoi mesurer l'effet (4 inscrits en 8 semaines). **C'est une décision produit séparée, qui appartient à Joseph.**
- ⛔ **Ne bloquer aucun écran, n'afficher aucune modale.** Un bandeau qu'on peut ignorer, pas un mur.
- ⛔ **Aucun mail ni notification automatique au prof.** Ça se discutera quand le bandeau aura été vu ; l'envoi automatique est un autre sujet (délivrabilité, consentement).
- ⛔ **Ne pas toucher au filtre lui-même.** La règle « photo OU ≥1 avis » reste telle quelle : ici on l'explique, on ne la change pas.

---

## 4. Tests

`frontend/lib/offreProf.test.js` — sur `etatProfil()`, données en dur, aucun accès réseau :

1. Profil complet (photo + 2 créneaux + pas de visio) → **`[]`**.
2. `offer_enabled: false` → contient le code **`masque`**.
3. Pas de photo, 0 avis → **`photo`**.
4. Pas de photo mais **3 avis** → **ne contient PAS `photo`** *(le OU du filtre)*.
5. `availability: {}` → **`creneaux`**. `availability: []` → **`creneaux`**.
6. `availability: { lundi: ['09:00'] }` **et** `availability: [{...}]` → **ne contient PAS `creneaux`** *(les deux formats)*.
7. `visio_enabled: true`, `visio_price_per_hour: ''` → **`visioPrix`**.
8. `visio_enabled: true`, `visio_same_rate: true`, pas de prix visio → **ne contient PAS `visioPrix`**.
9. **Cas Aurélie** : pas de photo + 3 créneaux → exactement **`['photo']`**.
10. **Cas Belgica** : photo + 0 créneau → exactement **`['creneaux']`**.
11. **Cas Durock** : photo + 5 créneaux + visio sans prix → exactement **`['visioPrix']`**, et **gravité non bloquante**.

➜ `npm test` doit rester vert (**138 tests au 21/09**) et le build passer.

---

## 5. Critère de réussite — mesurable, pas déclaratif

**Avant :** 17 profs · 14 passent le filtre · 9 avec créneaux · **7 réservables** (25/09/2026).

Relancer `node scripts/diag-offre-profs.mjs` **7 jours après la mise en production** :
- ✅ **Réussi si « réellement réservables » monte**, sans aucun message envoyé à la main.
- ❌ **Échoué si le chiffre ne bouge pas** → ça voudra dire que les profs ne reviennent pas sur leur tableau de bord, et **le sujet suivant n'est pas le bandeau, c'est la notification** (ou le fait qu'ils se soient inscrits sans intention réelle).

⚠️ **Ne pas conclure avant 7 jours** : sur 17 profs, deux qui se connectent le même jour suffiraient à faire croire à un effet qui n'existe pas.

---

## 6. Fichiers touchés

| Fichier | Action |
|---|---|
| `frontend/lib/offreProf.js` | **créer** — `nbCreneaux()` + `etatProfil()` |
| `frontend/lib/offreProf.test.js` | **créer** — les 11 cas |
| `frontend/components/EtatProfilProf.jsx` | **créer** — le bandeau |
| `frontend/pages/TeacherDashboard.jsx` | **modifier** — insérer le bandeau après le `<h2>` (~ligne 363) |
| `scripts/diag-offre-profs.mjs` | **modifier** — importer `nbCreneaux` au lieu de sa copie locale |

⛔ **Aucune règle Firestore, aucune API, aucune migration.** Tout est en lecture de champs déjà présents.

---

## 7. Après coup, si le bandeau marche
Le même composant se réutilise tel quel sur l'espace **partenaire** (`/partenaire/espace`), où le même défaut existe : un partenaire sans compte Stripe connecté ne touche rien et ne le sait pas. **À ne faire qu'après la mesure des 7 jours.**
