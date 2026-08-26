# PLAN — Refonte `/bac` : profs d'abord, prix après

**Date : 18/06/2026**
**Fichier cible : `frontend/pages/Bac.jsx`** (+ réutilisation de la logique de `frontend/pages/Search.jsx`)
**Objectif business : débloquer le clic-through vers `/search` et récolter des inscrits/data même en basse saison bac.**

---

## 1. Le problème (mesuré, pas supposé)

Données Vercel Analytics du 18/06 (24h) :

| Étape | Chiffre | Verdict |
|---|---|---|
| `/bac` (landing) | 36 visiteurs | L'aimant ramène le trafic |
| `/recherche` (`/search`) | **1** | 💀 Le funnel meurt ici |
| `/registre` | 1 | ~0 inscrit |
| Taux de rebond | 85% | Ils arrivent et repartent |

Côté Meta Ads (campagne EDUKARAIB) : CPM 3,00 $, CTR ~1,8 %, hook vidéo 49 % → **la diffusion n'est PAS le problème**. Le trafic arrive, il meurt sur la page.

### Cause racine identifiée dans le code

Sur `/bac`, pour atteindre `/search` (= voir les profs), le parcours actuel est :

1. Atterrissage → Hero
2. Clic "Choisir mon pack" → **scroll** vers la grille de prix
3. **Choisir un pack** (1er micro-engagement)
4. **Choisir une matière** (2e micro-engagement)
5. → enfin `navigate('/search?subject=...')`

**Deux décisions + du scroll avant de voir UN SEUL prof.** Le trafic froid mobile (88 %) tombe sur un **mur de prix** (packs 150 €/300 €) avant toute preuve de valeur → il bounce.

Ironie : le code lui-même (commentaire `Bac.jsx` ligne ~173) dit *« Toujours montrer les profs d'abord (valeur avant la barrière) »*. La page fait pourtant **l'inverse**.

---

## 2. Le principe du fix

Inverser la séquence pour faire ce que la page prétend déjà faire :

```
AVANT :  Hero → MUR DE PACKS → (2 clics) → profs
APRÈS :  Hero → VRAIS PROFS → packs → reste
```

La valeur (visages, notes, "dispo cette semaine") passe **avant** la barrière (prix).

---

## 3. Changements détaillés

### 3.1 — Hero : 2 chemins au lieu d'1
- Garder le bouton "Choisir mon pack".
- **Ajouter un CTA secondaire `Voir les profs dispo →`** qui scrolle vers la nouvelle section profs (et lien direct `/search` en secours).
- But : 0 décision pour accéder à la valeur.

### 3.2 — Nouvelle section "Profs dispo cette semaine" (cœur du fix)
Insérée **juste après le hero, AVANT la section packs**.

**Fetch des profs** (réutiliser la logique de `Search.jsx`) :
- `query(collection(db, 'users'), where('role', '==', 'teacher'))`
- Filtrer `t.offer_enabled !== false`.
- Enrichir avec la note moyenne (collection `reviews`, `where('teacher_id', 'in', chunk)` par paquets de 10) — comme dans `Search.jsx`.

**Tri intelligent** (afficher les 4 à 6 meilleurs) :
1. Certifiés en premier (`reviewsCount >= 5`).
2. Puis meilleure note (`avgRating` desc).
3. Bonus : profs enseignant une matière bac (`SUBJECTS_BAC`) remontés.

**Carte compacte** (sous-ensemble de la `TeacherCard` de `Search.jsx`) :
- Photo (`avatarUrl` ou `/avatar-default.png`)
- Prénom (`fullName.split(' ')[0]`)
- Matières (`subjects` array/string)
- ★ note + nb avis si `avgRating > 0`
- Prix/h (logique `Search.jsx` : `price_per_hour` base **+ 10** = marge plateforme)
- Badges : `📹 Visio` / `📍 Présentiel` / `🏅 Certifié` (si ≥5 avis)
- Clic carte → `/profils/:id` ; bouton secondaire → `/search?subject=<matière>`

**Bouton sous la grille** : `Voir tous les profs →` → `/search`.

**Tracking** : `pixelTrack('ViewContent', { content_name: 'Profs preview Bac', content_category: 'campagne' })` au montage de la section + event au clic d'une carte (signal d'intention forte pour Meta).

### 3.3 — Packs : descendre d'un cran
Les packs restent (l'ancrage prix sert ceux qui scrollent) mais passent **sous** la section profs. On ne supprime rien, on ré-ordonne. Les fonctions existantes (`choosePack`, `chooseSubject`, `scrollToPacks`) restent inchangées.

---

## 4. ⚠️ Dégradation gracieuse (obligatoire)

Inconnu à ce jour : **nombre réel de profs avec photo + profil propre** (impossible à requêter hors environnement).

Règle de sécurité dans le code :
- Si **< 3 profs affichables** (après filtre `offer_enabled`), la section "Profs dispo" **ne s'affiche pas** → on retombe sur le flux actuel (boutons matières). Zéro risque de page vide/pauvre.
- Pendant le chargement : skeleton (réutiliser `TeacherCardSkeleton` simplifié).
- Profs sans photo → `/avatar-default.png` (déjà géré dans `Search.jsx`).

---

## 5. Validation technique (à faire par Claude avant push)
- [ ] `npm run build` → exit 0 (vérifier le temps Vite habituel ~20s).
- [ ] Pas d'import manquant (`db` depuis `../lib/firebase`, `pixelTrack`, etc.).
- [ ] Section profs masquée si < 3 profs (tester mentalement le early-return).
- [ ] Aucune régression sur `choosePack` / `chooseSubject` / countdown / promo code.

## 6. Déploiement
- Commit clair : `feat(bac): profs d'abord — section profs dispo + CTA hero direct /search`
- Push sur `master` → Vercel auto-deploy.

## 7. Mesure du succès (48h)
- KPI : `/recherche` (`/search`) doit passer de **1 → 8-10+** à volume de trafic équivalent.
- Si oui → diagnostic "funnel price-first" confirmé, le clic est débloqué.
- Si `/search` reste bas → le problème est en amont (accroche pub / créa vidéo), pas la page.

---

## 8. Hors-scope code — fuite en amont (à passer à Théo)
La créa vidéo perd ~80 % des viewers entre 0:05 et 0:10 (rétention 3,3 %, 8s vues moy. sur 67s). Hook 49 % OK mais le contenu ne tient pas.
→ **Monter une version 12-15s** : offre + visage + bénéfice dans les 3 premières secondes, fin sur "profs dispo cette semaine, lien en bio". Une vidéo de 67s sur trafic froid mobile = perte garantie.

## 9. Note config Meta (à retenir, pas urgent)
La campagne EDUKARAIB est optimisée sur **"Vue de contenu"**, pas "Achat". Meta achète des clics pas chers, pas des acheteurs. OK pour récolter de la data maintenant ; à basculer vers une optim conversion (Purchase / CompleteRegistration) quand le volume de conversions le permettra.
