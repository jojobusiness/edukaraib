# PLAN — modifications du site pour la rentrée

**Écrit le 26/08/2026. Rentrée le 01/09 (dans 6 jours).**
Tout ce qui suit est **vérifié dans le code et contre la base réelle**, pas déduit.

Repo : `EduKarib/edukarib` · branche `master` · landing `/rentree` en ligne (HTTP 200).

---

## 📊 LA MESURE QUI COMMANDE TOUT

Chaque bouton de matière de `/rentree` a été testé avec le vrai `subjectMatches()` contre les **15 libellés réellement saisis par les profs** en base :

| Bouton | Profs affichés | **Profs RÉSERVABLES** | Qui |
|---|---|---|---|
| Maths | 9 | **3** | Dramane, Lionidas, Fawzi |
| Français | 4 | **2** | Lionidas, Marie-Christine |
| Anglais | 1 | **1** | Marie-Christine |
| Physique-Chimie | 3 | **1** | Aristide |
| Espagnol | 1 | **1** | Marie-Christine |
| Comptabilité | 5 | **2** | Dramane, Marie-Christine |
| **Économie-Droit** | 1 | **0** | 🔴 **ORPHELIN** |
| **Informatique** | 0 | **0** | 🔴 **ORPHELIN** |

*« Réservable » = passe le filtre d'affichage **et** a au moins un créneau coché.*

➜ **Il y a DEUX boutons orphelins, pas un.** « Économie-Droit » affiche un prof (Hervé VAILLANTÉ) qui n'a aucun créneau — le parent clique, voit un profil, et ne peut rien réserver.

---

## MODIF 1 — Retirer `'Informatique'` 🔴 bloquant

**Fichier :** `frontend/config/campaigns.js`, dans `RENTREE_CAMPAIGN.subjects` (~L186).

Aucun des 15 profs ne déclare cette matière. Le clic mène à une liste **vide**. Et Joseph a tranché le 21/08 qu'il ne donnera pas de cours — donc personne ne la couvrira.

```js
subjects: [
  'Maths', 'Français', 'Anglais', 'Physique-Chimie',
  'Espagnol', 'Comptabilité', 'Économie-Droit',   // <- retirer 'Informatique'
],
```

À rouvrir le jour où un prof d'informatique s'inscrit **et** coche des créneaux.

---

## MODIF 2 — Trancher le cas `'Économie-Droit'` 🔴 bloquant

Le bouton a été ajouté à raison — **6 profs sur 15 sont en compta/finance/droit/éco/RH/gestion**, c'est la vraie force de la base. Mais aucun n'est réservable :

- **Hervé VAILLANTÉ** — « Français, droit, économie, gestion » — photo ✅, **0 créneau**
- **Sara MINA** — « Économie, Droit, Ressources humaines et communication » — **pas de photo** ❌, 0 avis, 0 créneau → exclue par le filtre qualité
- **Aurélie ARCON** — « Economie, droit, ressources humaines, management, marketing » — **pas de photo** ❌, 0 avis, 0 créneau → exclue

**Deux issues, à choisir :**

**(a) Le retirer maintenant** — cohérent avec le retrait d'« Informatique », zéro risque avant la rentrée. Le rouvrir dès qu'un prof éco-droit est réservable.

**(b) Le sauver en 24 h** — c'est le seul bouton récupérable sans écrire une ligne de code : il suffit qu'**Hervé coche des créneaux** (il a déjà une photo). Sara et Aurélie demandent en plus une photo de profil.

➜ **Recommandation : faire (b) aujourd'hui, appliquer (a) demain soir si Hervé n'a pas bougé.** C'est le seul bouton qui pointe vers la force réelle de la base — le supprimer par défaut serait dommage.

---

## MODIF 3 — Trier les profs par disponibilité réelle 🟠 fort impact

**Le problème, mesuré :** sur « Maths », **9 profs s'affichent et 3 sont réservables**. Le filtre d'affichage est :

```js
const visible = t.offer_enabled !== false && (photo || nbAvis >= 1);
```

Il ne regarde **pas les créneaux**. Un parent a donc 2 chances sur 3 de cliquer sur un prof au planning vide — au moment précis où il est le plus décidé à réserver.

**Modification demandée :**
1. **Trier** la liste avec les profs qui ont ≥ 1 créneau **en premier**.
2. Ajouter un **badge visuel** (ex. « Disponible cette semaine ») sur ceux qui ont des créneaux.

**⚠️ Ne PAS masquer les profs sans créneau.** Ce sont les mieux notés de la plateforme (Charif 8 avis · 5,0 ; Dylan 8 · 5,0 ; Parfait 7 · 5,0 ; Olèm 6 · 5,0 ; Khalil 5 · 5,0) et un parent peut vouloir les contacter. On les fait descendre, on ne les supprime pas.

---

## MODIF 4 — Le jeton `RH` manquant 🟢 mineur, optionnel

`frontend/lib/subjectMatch.js`, table `SYNONYMES`, clé `'economie droit'` : la liste contient `'ressources humaines'` mais pas `'rh'`. Marie-Christine Jeannello écrit « RH » — elle n'est donc pas trouvée par le bouton Économie-Droit alors qu'elle couvre la matière **et qu'elle a 5 créneaux** (la mieux dotée des profs réservables).

⚠️ **Attention avant de le faire** : le fichier avertit explicitement contre les jetons trop courts (`'eco'` est volontairement absent car il matcherait « école »). `'rh'` en simple `includes()` risque des faux positifs. **Si c'est fait, le faire avec une vraie limite de mot**, pas un `includes()` nu — sinon ne pas le faire.

➜ À elle seule, cette modif ferait passer « Économie-Droit » de 0 à 1 réservable et réglerait la MODIF 2.

---

## MODIF 5 — Hygiène du dépôt ✅ FAIT LE 26/08/2026

Working tree sale depuis des semaines :
- `dist/` modifié
- non suivis : `AUDIT_EDUKARAIB.md`, `PLAN_LANDING_RENTREE.md`, `PLAN_TUNNEL_CONVERSION.md`, `ROADMAP_INSTITUTION_EDUKARIB.md`, `TUTO_PIXEL_META.md`, `docs/business/`, `frontend/components/GoogleAuthButton.jsx`

**Commiter avant de toucher à la campagne**, pour que les modifs ci-dessus soient isolées et réversibles.

➜ **Fait le 26/08** lors du rangement des dossiers : `dist/` détraqué du suivi git (il était dans `.gitignore` mais 4 fichiers restaient suivis — c'est ce qui salissait `git status` en permanence), toute la doc déplacée dans `docs/` (`plans/`, `conception/`), scripts racine dans `scripts/`, `docs/business/` sorti vers le dossier de gestion parent, `GoogleAuthButton.jsx` (orphelin, jamais importé) et `pglite-debug.log` mis à la corbeille. Working tree propre.

---

## ✅ CE QUI EST DÉJÀ BON — NE PAS Y TOUCHER

- **`subjectMatch.js` fonctionne.** Corrigé le 20/08 : normalisation accents/ponctuation/casse + table de synonymes. « Maths » trouve bien « mathématiques financières », « Physique-Chimie » trouve « Physique, Chimie » **et** « Physique chimie ». Testé contre les 15 libellés réels — c'est solide.
- **Les dates de campagne sont justes.** `DATE_RENTREE = 2026-09-01T07:00:00-03:00` (fuseau Guyane, correct), puis 21/09, 05/10, fin 03/11 à la Toussaint. Les 4 phases s'enchaînent correctement.
- **L'architecture** `CampaignLanding.jsx` + configs datées : `/bac` et `/rentree` partagent le même moteur. Toute amélioration profite aux deux. À conserver.
- **Le SEO de `/rentree`** est renseigné (title, description, url).

---

## 🔴 LE PRÉREQUIS QUI VAUT PLUS QUE LES 5 MODIFS RÉUNIES

**5 profs réservables, dont 4 avec un seul créneau.** Inchangé depuis le 21/08.

Les 5 mieux notés ont **zéro créneau** : **Charif SANOGO** (8 avis · 5,0), **Dylan Nonguierma** (8 · 5,0), **Parfait COMPAORE** (7 · 5,0), **Olèm NIKIEMA** (6 · 5,0), **Khalil SANOU** (5 · 5,0). **34 avis cumulés, tous à 5,0, tous invisibles à la réservation.**

**Une heure de messages fait passer l'offre de 5 à 10 réservables.** Aucune modification de code ne produira ça. Message prêt : `../01_MARKETING/messages-profs/MESSAGE_PROFS_RENTREE_31_07.md` (déplacé le 26/08).

Et si Hervé, Sara et Aurélie répondent, la MODIF 2 disparaît d'elle-même.

---

## ORDRE D'EXÉCUTION

| # | Action | Type | Durée |
|---|---|---|---|
| 0 | **Relancer les 15 profs sur leurs créneaux** | ops | 1 h |
| 1 | ~~Commiter le working tree~~ ✅ fait le 26/08 | git | — |
| 2 | Retirer `'Informatique'` | code | 2 min |
| 3 | Trier les profs par disponibilité + badge | code | 30 min |
| 4 | Trancher `'Économie-Droit'` (après retour d'Hervé) | code | 2 min |
| 5 | Jeton `RH` avec limite de mot, ou rien | code | 15 min |

**Contrainte de temps : tout doit être en prod avant le 01/09.**
