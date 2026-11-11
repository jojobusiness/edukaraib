# PLAN — Des pages-réponses que ChatGPT peut citer (EduKaraib) · écrit le 11/11/2026

> **Demande de Joseph (11/11)** : les pages ChatGPT de Factur'Peyi sont en ligne (`ee53134`, `fdc47fc`) ; « faut mettre des plans pour que ça soit exécuté partout ».
> **Pourquoi** : sur Factur'Peyi, les seules inscrites venues seules arrivent par ChatGPT (3 depuis le 17/10). ~200 contacts à froid du 02 au 09/11 n'ont rien donné.
> **Modèle à copier : le commit Factur'Peyi `ee53134`.** Le lire en entier avant de coder (`src/lib/guides.js`, `Guide.jsx`, `Guides.jsx`, extension du prérendu, `guides.test.js`).

## 0. Ce qui existe ici (à réutiliser, ne pas refaire)
- `frontend/pages/seo/` : 11 pages locales (cours de maths, français, anglais, cours particuliers par territoire).
- `frontend/data/blogPosts.js` + `Blog.jsx` / `BlogPost.jsx`.
- `/methode` et le guide PDF `public/guide/reviser-pour-de-vrai.pdf`.
- `public/robots.txt` (tout ouvert sauf les tableaux de bord), `public/sitemap.xml`.
- ⚠️ **Le site est une SPA sans prérendu** : un robot qui ne lance pas JavaScript ne voit que `<div id="root">`. **Pas de `llms.txt`** (404 le 11/11). C'est le premier problème à régler, avant même les nouvelles pages.

## 1. Rendre le texte lisible sans JavaScript (bloquant)
- Script Node `scripts/prerendu-guides.mjs`, lancé après `vite build` : il écrit `dist/guides/<slug>/index.html` avec le titre, la description, la canonique, le JSON-LD (Article + FAQPage) **et le texte de la page en dur**. Même logique que Factur'Peyi : pas de Chrome sur les machines de build Vercel, donc Node seulement.
- Faire de même pour les 11 pages de `frontend/pages/seo/` si c'est simple. Sinon, au minimum l'en-tête (titre, description, canonique).
- `dist/llms.txt` généré : la liste des guides, une ligne par guide.

## 2. Les pages (12), une question précise chacune, cible DOM + Caraïbe et Afrique francophones
Chaque page porte :
- **une réponse courte en tête**, 2-3 phrases citables telles quelles ;
- des sections, une FAQ, une date de mise à jour ;
- **les sources** (education.gouv.fr, eduscol, sites des académies, service-public) **pour toute affirmation sur des règles** ;
- un bouton suivi (`utm_source=guide`) vers la recherche de profs ou vers `/methode`.

| Slug `/guides/…` | Question visée |
|---|---|
| soutien-scolaire-en-ligne-guadeloupe | Soutien scolaire en ligne en Guadeloupe : comment ça marche, combien ça coûte |
| soutien-scolaire-en-ligne-martinique | Idem, Martinique |
| soutien-scolaire-en-ligne-guyane | Idem, Guyane |
| soutien-scolaire-en-ligne-reunion | Idem, La Réunion |
| prix-cours-particuliers-dom | Combien coûte un cours particulier aux Antilles, en Guyane, à La Réunion |
| prof-de-maths-en-ligne-college | Trouver un prof de maths en ligne pour un collégien |
| aide-aux-devoirs-en-visio | Aide aux devoirs en visio : comment se passe un cours |
| comment-reviser-et-retenir-ses-lecons | Comment réviser et retenir ses leçons (contenu du guide MÉTHODE) |
| preparer-le-brevet | Préparer le brevet : calendrier de révision |
| bac-parcoursup-depuis-les-dom | Bac et Parcoursup depuis les DOM : les étapes |
| soutien-scolaire-lycee-francais-afrique | Soutien scolaire en ligne pour les élèves des lycées français en Afrique (programme français) |
| calcul-moyenne-trimestre | Comment calculer sa moyenne (et la note qu'il faut au prochain contrôle) → lien vers le futur calculateur |

**Règles de contenu :**
- Les prix cités sont **ceux de la plateforme**, lus dans la base au moment du build (fourchette des tarifs des profs réservables + 10 €/h de frais), jamais un « prix moyen du marché » inventé.
- Rien sur le crédit d'impôt, le calcul des points du brevet ni un calendrier sans **source officielle datée**. Pas de source = pas de phrase.
- Jamais « profs certifiés ». Jamais de nombre d'élèves ni de chiffre interne faible.

## 3. Architecture
- `frontend/lib/guides.js` : contenu + fonctions JSON-LD. **Une seule source**, lue par la page et par le prérendu.
- `frontend/pages/Guide.jsx` (`/guides/:slug`) et `Guides.jsx` (`/guides`) ⚠️ composant qui exige des props hors de `pages/` (règle du repo : `pages.test.jsx` monte chaque page).
- Routes dans `App.jsx`, lien « Guides » dans le `Footer`, guides ajoutés au `sitemap.xml`.
- Maillage : chaque page de `seo/` renvoie vers les guides de son territoire.

## 4. Tests
- Chaque guide : slug unique, réponse courte de 400 caractères au plus, au moins une source quand il affirme une règle (domaines autorisés).
- Aucun guide ne contient « certifié ».
- Le prérendu produit le H1, la réponse courte et le JSON-LD ; `llms.txt` et le sitemap listent tous les guides.
- Test de casse : retirer une source fait échouer le test.
- `npm test`, lint, build, puis `curl` en production sur 2 guides et sur `/llms.txt`.

## 5. Mesure (Joseph, 5 min, le 18/11 puis le 25/11)
Poser à ChatGPT, chaque fois dans une nouvelle conversation, et noter si EduKaraib est cité et à quelle place :
1. soutien scolaire en ligne Guadeloupe
2. prof de maths en visio Martinique collège
3. cours particuliers Guyane prix
4. soutien scolaire en ligne La Réunion
5. comment réviser ses leçons et les retenir
Dans l'admin : visites avec `utm_source=guide` et comptes créés après une visite de guide.

## 6. Ce qu'on rend à Joseph
- Les URL des guides en ligne, `/llms.txt` qui répond 200, et une capture d'un guide sur mobile.

## RÉSULTAT
- ✅ **11/11/2026 — FAIT, commit 83502489, vérifié en production.**
  - 12 guides en HTML prérendu (`/guides/<slug>`), index `/guides`, `/llms.txt` (200), 12 guides dans `/sitemap.xml`, lien « Guides » dans le pied de page, maillage depuis les 11 pages locales.
  - Les 11 pages locales ont désormais leur propre titre, description et canonique sans JavaScript (seulement titre + accroche : leur FAQ reste à revoir avant d'être prérendue — « 3 fois sans frais », « toutes les matières » ne sont pas vérifiés).
  - Prix : `scripts/tarifs-guides.mjs` → `frontend/data/tarifsGuides.json` (20–40 €/h + 10 €, profs réservables au 11/11). **À relancer + commit quand les tarifs changent.**
  - Canonique passée sur `www.edukaraib.com` (useSEO, index.html, sitemap, robots). Retiré : « des centaines de familles » (faux).
  - Sources vérifiées par recherche le 11/11 (brevet 60/40 depuis 2026, Parcoursup, PME LADOM). Pas d'appel à un « prix du marché ».
  - Reste : mesure ChatGPT le 18/11 et le 25/11 (§5), par Joseph.
