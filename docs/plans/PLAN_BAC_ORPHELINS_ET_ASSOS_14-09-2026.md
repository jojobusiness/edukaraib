# PLAN — Landing /bac : retirer les matières orphelines + préparer la campagne associations · 14/09/2026

> Déclencheur : `node scripts/diag-offre-profs.mjs` du 14/09 → **4 boutons orphelins** sur la campagne `bac` (le parent clique et ne peut réserver personne).
> Contexte business : campagne associations de parents (plan de gestion : `EduKarib/01_MARKETING/campagnes/PLAN_ASSOCIATIONS_PARENTS_14-09-2026.md`, hors repo).

---

> ✅ **15/09/2026 — Tickets 1 et 4 LIVRÉS** (113 tests verts, build OK, diag sans orphelin) : ticket 4 = commit `31888f9e`, ticket 1 = commit suivant. Reste le ticket 7, qui attend la validation de la grille par Joseph.

## Ticket 1 — Retirer Philosophie, SVT, SES, Histoire-Géo de `BAC_CAMPAIGN` (≈ 15 min) — ✅ FAIT 15/09

**Fichier :** `frontend/config/campaigns.js`, lignes 23-26 :
```js
subjects: [
  'Maths', 'Français', 'Philosophie', 'Physique-Chimie',
  'SVT', 'SES', 'Anglais', 'Histoire-Géo',
],
```
→ devient :
```js
subjects: ['Maths', 'Français', 'Physique-Chimie', 'Anglais'],
```
- Ajouter une ligne à l'**historique des retraits** (commentaire vers la ligne 185, même format) : `14/09 (bac) : Philosophie, SVT, SES, Histoire-Géo — aucun prof réservable (diag du 14/09).`
- Vérifier que la copie de la landing `bac` ne cite pas ces matières en dur (chercher `Philo`, `SVT`, `SES`, `Histoire` dans `CampaignLanding.jsx` et dans le bloc `copy` de `BAC_CAMPAIGN`).

**Test :** `frontend/test/campagnes.test.jsx` ligne 66 protège déjà `RENTREE_CAMPAIGN` avec `sansProfReservable`. **Ajouter le même garde pour `BAC_CAMPAIGN`** :
```js
for (const matiere of ['Philosophie', 'SVT', 'SES', 'Histoire-Géo']) {
  expect(BAC_CAMPAIGN.subjects).not.toContain(matiere);
}
```
⚠️ Le test doit **échouer avant** la modif de `campaigns.js` et passer après — sinon il ne protège rien.

**Vérif :** `npm test` · `npm run build` · `node scripts/diag-offre-profs.mjs` → doit afficher « ✅ Aucun bouton de matière orphelin ».
**Commit :** `fix(bac): retirer 4 matieres sans prof reservable (diag du 14/09)` → push.

## Ticket 2 — Vérifier que l'admin peut créer un compte « influenceur » pour une association (≈ 15 min, lecture seule)

Le plan de campagne s'appuie sur le système influenceur existant (code unique, remise −5/−10/−30 €, commission +5/+10/+20 €, virement IBAN) pour donner un **code adhérents** à chaque association.
À vérifier **avant** de le promettre dans un mail :
1. Où l'admin crée un influenceur (onglet de `AdminDashboard` ? script ? création manuelle Firestore ?).
2. Le code accepte-t-il un nom d'association (`FCPE973`, par ex.) ?
3. La commission part-elle bien sur l'IBAN d'une personne morale ?
➜ Si la création n'existe que « à la main dans Firestore », écrire la procédure en 5 lignes dans ce fichier plutôt que de coder un écran : **pas de dev avant la première association qui dit oui.**

### ✅ Réponse au ticket 2 (lu dans le code le 14/09 après-midi)
1. **Création** : `POST /api/generate-influencer-code` (`api/generate-influencer-code.mjs`), appelable par l'admin pour un `uid` tiers. Le compte doit exister (`users/{uid}`), puis l'admin passe le rôle à `influencer` (`AdminDashboard.jsx`, onglet Comptes). Le code se modifie à la main dans l'onglet Influenceurs (`AdminDashboard.jsx:1576`).
2. **Nom du code** : le générateur prend le **1ᵉʳ mot du nom + 2 chiffres** (« APE Lycée Melkior » → `APE42`, « Association… » → `ASSOCIATION42`). Il faut le **renommer à la main** après création.
3. **IBAN de personne morale** : aucun contrôle de nature, seul le mod97 s'applique (`trigger-influencer-payout.mjs`). ✅ OK.
4. ⚠️ Mais **le mail de bienvenue tutoie « ton audience » avec un 🎤** : impossible à envoyer au bureau d'une association.
5. ⚠️ Et **la validité est de 6 mois** (`create-checkout-session.mjs:285`) : un code créé en octobre meurt en avril, avant le bac → ticket 5.

## ✅ Ticket 4 — Un code promo refusé ne doit JAMAIS bloquer le paiement — FAIT 15/09 (`31888f9e`)
> Livré : règle dans `api/pay/_influencerRules.mjs`, test `frontend/test/paiement-coupon.test.js` sur le vrai handler (3 cas échouent sur l'ancien code, passent sur le nouveau). Front inchangé : il ne validait que le format.
**Constat (14/09)** : `api/pay/create-checkout-session.mjs:296-310` renvoie une erreur 400 `COUPON_MAX_USAGE_REACHED` (≥ 2 usages du payeur) ou `COUPON_IP_LIMIT_REACHED` (IP déjà vue pour ce code). Le front n'intercepte que `COUPON_INVALID_OR_USED` et `COUPON_EXPIRED` (`ParentPayments.jsx:464-472`, `StudentPayments.jsx:395-403`) : tout le reste part dans `alert(e.message)` et **le paiement n'est jamais créé**. Comme le code de campagne est **pré-rempli pendant 14 jours** (`lib/bacCampaign.js` → `getCampaignCode()`), une famille venue par un lien `?code=` est bloquée **dès son 3ᵉ achat**, et une famille qui partage l'IP d'une autre l'est **dès le 1ᵉʳ**. Cela vaut **aujourd'hui pour tous les codes influenceurs** (ex. `LHATIEN81`).
**Correctif (côté serveur, un seul endroit)** : pour un **code influenceur** refusé (usage, IP, expiration), on **ignore le code et on continue** : pas de remise, pas de commission, anti-abus intact. On renvoie `couponIgnored: { code, reason }` dans la réponse pour les logs et Sentry. Les **coupons nominatifs** (`BIENVENUE-`, `AVIS-`…, collection `coupons`) gardent leur erreur 400, puisque l'utilisateur les a tapés lui-même.
**Test** (vitest, mock Firestore ou fonction extraite) : un payeur à 2 usages → la session se crée **sans remise** et `teacherAmountCents` reste inchangé (règle absolue coupons du CLAUDE.md).
**Vérif** : `npm test` · `node --check api/pay/create-checkout-session.mjs` · `npm run build`.
**Commit** : `fix(paiement): un code influenceur refuse n'empeche plus de payer`.

## 🆕 Ticket 7 — REFONTE « influenceurs » → « partenaires » (décision de Joseph, 14/09/2026) — remplace les tickets 5 et 6
> Joseph : *« on va changer le système entier et mettre en partenaires, et réfléchir comment les familles peuvent l'utiliser de façon simple et pour toute la famille »* + *« simple d'utilisation pour les assos »*.
> ⛔ Le ticket 6 (page conférence) est **écarté** : Joseph ne veut pas de conférence.

**Ce qui ne va pas aujourd'hui (lu dans le code le 14/09) :**
| Problème | Où |
|---|---|
| Le code vit **14 jours dans le navigateur** (`localStorage`) : un autre téléphone, un autre parent ou un navigateur vidé, et il est perdu | `frontend/lib/bacCampaign.js` |
| **2 usages par payeur**, puis blocage : une famille de 3 enfants, ou qui rachète un pack, perd sa remise, et **son paiement est bloqué** (ticket 4) | `create-checkout-session.mjs:291-298` |
| **1 usage par IP** : deux familles sur le même réseau se bloquent entre elles | `create-checkout-session.mjs:300-310` |
| **Expiration 6 mois** après la création du code | `create-checkout-session.mjs:285-289` |
| Le vocabulaire est celui d'influenceurs : tutoiement, « ton audience », 🎤, `/influencer/dashboard` | `api/generate-influencer-code.mjs`, `InfluencerDashboard.jsx` |

**Cible — le code est rattaché à la FAMILLE, pas au navigateur :**
1. **Rattachement une fois pour toutes.** À la 1ʳᵉ saisie du code (lien `?partenaire=CODE` ou champ au paiement), il est **enregistré sur le compte du parent** (`users/{uid}.partner_code`, `partner_linked_at`). Ensuite il s'applique **tout seul à chaque achat**, pour **tous les enfants** rattachés à ce compte. Plus rien à retaper, plus de limite de 14 jours.
2. **Pas de limite d'usage par payeur** pendant la durée du partenariat, **ni de limite par IP**. Anti-abus : le compte du partenaire ne peut pas utiliser son propre code, et une famille n'est rattachée qu'à **un seul** partenaire (le premier gagne, modifiable par l'admin).
3. **Durée : l'année scolaire** (`partners/{id}.expires_at`, par défaut le 31/07/2027), renouvelable.
4. **Un code refusé n'empêche jamais de payer** (ticket 4, prérequis).
5. **Côté association, tout tient sur un écran** : « Espace partenaire », au vouvoiement → son code et son lien à copier, un message tout prêt à transférer aux familles (WhatsApp / mail), nombre de familles rattachées, cours payés, reversements dus et versés, son IBAN. Le relevé mensuel suffit ; pas de compte Stripe côté partenaire (même principe que Factur'Peyi, CLOS 12/09).
6. **Côté admin, un seul formulaire** : nom de l'association, type (association / établissement / groupe Facebook / influenceur), code choisi (`APEL973`), email du contact, IBAN → crée le compte et envoie un mail de bienvenue au vouvoiement.
7. **Les influenceurs existants** (`LHATIEN81`…) continuent de fonctionner : ils deviennent des partenaires de type `influenceur`, avec leurs règles actuelles.

**❓ À fixer par Joseph avant de coder :**
- **Remise pour la famille**, par achat : garder −5 € / −10 € / −30 €, ou une autre grille ?
- **Reversement au partenaire** : garder +5 € / +10 € / +20 € par achat, **sur tous les achats** de la famille pendant l'année ?
- Contrainte : remise + reversement ≤ commission plateforme (10 € par cours · 50 € pack 5 h · 100 € pack 10 h). La grille actuelle en cours unitaire prend **10 € sur 10 €** : sur un cours à l'unité, EduKarib gagne alors **0 €**.

### 💶 Grille partenaires — analyse du 14/09 (à valider par Joseph)
**Faits (code) :** commission du site = **10 € par heure** (`create-checkout-session.mjs:247`) → 10 € sur un cours, 50 € sur un pack 5 h, 100 € sur un pack 10 h. En pack, le prof touche 90 % de son tarif horaire. Les frais Stripe sont payés **sur la part d'EduKarib** (le prof reçoit son montant plein par transfert), soit ≈ 1,5 % + 0,25 € par paiement pour une carte européenne standard (Klarna coûte plus cher).
**Direction donnée par Joseph :** les familles privilégieront les packs, et on demande aux associations de pousser les packs, parce que c'est là que tout le monde gagne le plus.

Exemple : prof à 25 €/h. « EduKarib net » = commission − remise − reversement − frais Stripe (estimés).
| | Grille actuelle (influenceurs) | **A — 2 €/h famille + 2 €/h asso (recommandée)** | B — packs seulement |
|---|---|---|---|
| Cours à l'unité | −5 / +5 → **≈ −0,70 €** (on perd de l'argent) | −2 / +2 → **≈ 5,25 €** | 0 / 0 → ≈ 9,20 € |
| Pack 5 h | −10 / +10 → ≈ 27,50 € | −10 / +10 → **≈ 27,50 €** | −10 / +10 → ≈ 27,50 € |
| Pack 10 h | −30 / +20 → ≈ 45,30 € | −20 / +20 → **≈ 55,20 €** | −20 / +20 → ≈ 55,20 € |
| Part gardée par EduKarib | 0 % à 60 % selon le produit | **60 % partout** | 60 % à 100 % |

**Pourquoi A :**
1. **Une règle d'une ligne** pour l'association : *« 2 € par heure pour vos familles, 2 € par heure pour votre caisse »*. Rien à calculer, rien à expliquer.
2. **Elle pousse les packs sans pénaliser l'unité** : un pack 10 h rapporte **20 € d'un coup** à l'association contre 2 € pour un cours, et l'association a tout intérêt à mettre en avant le pack. La famille, elle, cumule la remise du prof (−10 % en pack) et celle du partenaire.
3. **Elle tient la promesse des mails déjà envoyés**, qui disent « reversement **sur chaque cours payé** ». ⚠️ **L'option B la contredirait** : l'association ne toucherait rien sur un cours à l'unité.
4. On ne perd plus d'argent sur un cours à l'unité (−0,70 € aujourd'hui), et on gagne ~10 € de plus sur chaque pack 10 h.
**Ordre de grandeur :** une famille qui prend 2 packs de 10 h dans l'année → ≈ 110 € net pour EduKarib et 40 € pour l'association. **Le reversement sur tous les achats de l'année est l'argument qui fait pousser l'association.**
Les influenceurs existants (`LHATIEN81`…) gardent leur grille actuelle, qui n'est pas touchée.

**Découpage indicatif :** modèle de données + migration des `influencers` (2 h) · checkout + webhook (2 h) · espace partenaire (3 h) · formulaire admin + mail (1 h 30) · tests (2 h). **Aucun partenaire activé avant le ticket 4.**

## Ticket 5 — Codes « association » (≈ 1 h) — ⚠️ absorbé par le ticket 7, gardé pour mémoire
Sur le doc `influencers` : champs optionnels `kind: 'association'` et `expires_at` (Timestamp).
1. `create-checkout-session.mjs` : expiration = `influ.expires_at` si présent, sinon `created_at + 6 mois` (inchangé pour les influenceurs). **Pas de limite par IP** si `kind === 'association'` (des familles d'un même établissement partagent souvent un réseau) ; la limite de 2 usages par payeur est conservée.
2. `generate-influencer-code.mjs` : accepte `kind`, `code` (choisi par l'admin, `^[A-Z0-9-]{4,20}$`, unicité vérifiée) et `expiresAt` (par défaut **31/07/2027** pour une association) ; **mail de bienvenue au vouvoiement**, sans emoji, qui explique « remise pour vos adhérents, reversement à la caisse de l'association, relevé dans votre espace ».
3. Test : un code association créé il y a 7 mois reste valable, et une 2ᵉ IP identique ne le bloque pas.

## Ticket 6 — Page d'inscription à la conférence `/conference?asso=CODE` (≈ 2-3 h, déclenchée au 1ᵉʳ « oui » d'une association)
Formulaire : nom, e-mail, territoire, classe de l'enfant, **case de consentement non pré-cochée**, `asso` lu dans l'URL → `POST /api/conference-signup` (Admin SDK, anti-doublon par e-mail, plafond par IP) → collection `conference_signups` + mail de confirmation Resend avec le lien du live. Compteur par association dans l'admin. Route dans `App.jsx` et test de fumée automatique (la page vit dans `pages/`, donc **sans props obligatoires**).

## Ticket 3 — Relancer le diagnostic jeudi 17/09
Après les WhatsApp aux 5 profs les mieux notés (Charif, Dylan, Parfait, Olèm, Khalil) : `node scripts/diag-offre-profs.mjs`.
**Seuil pour ouvrir la campagne associations : ≥ 8 profs réservables** (6 au 14/09).

## ⛔ Hors plan
- Pas de landing dédiée « associations » tant qu'aucune n'a répondu : la conférence et le code se proposent par mail.
- Pas de nouveau statut « partenaire association » dans le code : l'association **est** un influenceur.
