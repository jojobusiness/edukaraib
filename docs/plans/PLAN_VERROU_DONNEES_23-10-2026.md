# PLAN — Verrouiller les données personnelles · 23/10/2026

> **Demande de Joseph (23/10)** : « fait tout », après le verrou des paiements du 19/10.
> **Sa règle** : une faille sur des données sensibles se corrige tout de suite, jamais « quand tu veux ».

## 0. Relevé du 23/10 (vérifié en production, pas une relecture des règles)

| Gravité | Où | Ce qui fuit |
|---|---|---|
| 🔴 1 | `users` : `allow read: if true` | **Sans aucun compte**, avec la clé publique du site, on liste les **36 comptes** : e-mail, téléphone (23), date de naissance, identifiant Stripe, provenance. 14 élèves dedans. Testé le 23/10. |
| 🔴 2 | `api/notify-email.js` | Tout compte connecté envoie un e-mail **depuis `notifications@edukaraib.com` vers n'importe quelle adresse**, avec texte et lien libres. Relais de hameçonnage avec notre nom de domaine. |
| 🔴 3 | `students` : `read, write: if signedIn()` | Nom et **date de naissance d'enfants**, lisibles, modifiables et supprimables par tout compte. |
| 🟠 4 | `documents` : `read, write: if signedIn()` | Fichiers de cours de tout le monde, et suppression possible par n'importe qui. |
| 🟠 5 | `lessons` : `read: if true`, `delete: if signedIn()` | Planning, prix et identifiants des élèves visibles sans compte. N'importe quel compte peut supprimer le cours d'un autre. |
| 🟡 6 | `favorites`, `presence`, `parents`, `children` | Ouverts à tout compte connecté. `parents` et `children` sont vides. |

**Pourquoi `users` était ouvert** : le navigateur allait chercher l'e-mail des autres pour leur écrire, et la fiche d'un prof servait de page publique. On corrige la cause, pas seulement la règle.

## 1. Principe

- **Le navigateur ne lit plus jamais la fiche d'un autre.** Il lit sa propre fiche ; le reste passe par le serveur, qui ne renvoie que ce que l'écran a le droit de montrer.
- **`/api/profs`** (public, en cache) : les profils publics des profs, construits sur une **liste blanche** de champs (`api/_profilsPublics.mjs`). Jamais d'e-mail, de téléphone, de date de naissance ni d'identifiant Stripe.
- **`/api/profils`** (connecté) : le nom et l'avatar d'un utilisateur, ou le profil public d'un prof. La fiche d'un enfant n'est renvoyée qu'à son parent, à l'admin, ou à un prof ou un participant d'un cours où il figure, et **jamais avec sa date de naissance**.
- **`/api/notify-email`** :
  - on désigne le destinataire par son identifiant, et c'est le serveur qui trouve l'adresse (pour un enfant, celle du parent) ;
  - une adresse en clair n'est acceptée que pour l'admin, ou vers `contact@` ;
  - pour un non-admin, les liens qui ne pointent pas vers edukaraib.com sont neutralisés.

## 2. Nouvelles règles

| Collection | Lecture | Écriture |
|---|---|---|
| `users` | soi-même, admin | inchangée |
| `students` | parent (`parent_id`), l'élève lui-même, admin | parent (sans changer `parent_id`), admin |
| `documents` | admin, auteur, participants du cours | création par un participant en son nom ; suppression par l'auteur ou l'admin |
| `favorites` | propriétaire | propriétaire |
| `presence` | connecté | soi-même |
| `parents`, `children` | admin | admin |

## 3. Preuve

- `frontend/test-regles/` : tests sur l'**émulateur Firestore** (`npm run test:regles`), avec les requêtes exactes des écrans et les tentatives d'un intrus.
- Après déploiement : `scripts/diag-regles-donnees.mjs` rejoue l'intrus contre la production.

## 4. `lessons` : un chantier à part, avec sa raison

Lire ou rejoindre un cours collectif oblige aujourd'hui le navigateur à lire les cours des autres. C'est la réservation, donc le chiffre d'affaires. La lecture ne se ferme pas sans passer la réservation par le serveur. Ce qui est fait ici, sans y toucher :
- les identifiants d'élèves qu'on trouve dans `lessons` ne mènent plus à rien, puisque `users` et `students` sont fermés ;
- la suppression d'un cours est réservée au prof et à l'admin.

La suite fera l'objet de son propre plan, dédié.

## 5. Résultat (23/10/2026)
- ✅ **Livré et vérifié en production** (commit `9140cf7f`, règles déployées vers 18 h 45).
- `scripts/diag-regles-donnees.mjs` sur la prod : **0 faille**. Sans compte comme avec un compte jetable, tout est refusé (comptes, fiches enfants, documents, favoris). La recherche voit toujours les 17 profs, et aucun des 17 profils publics ne contient d'e-mail, de téléphone, de date de naissance ou d'identifiant Stripe. Les écrans parent, prof et admin passent.
- `/api/notify-email` vers une adresse libre depuis un compte jetable : **403**.
- `scripts/diag-regles-paiements.mjs` relancé : toujours 0 faille.
- Émulateur : 22 tests verts ; **14 échouent sur les anciennes règles**, ce qui prouve qu'ils détectent les failles.
- Données migrées :
  - 36 profils publics (`scripts/sync-profils-publics.mjs`) ;
  - 7 documents, chacun avec son champ `acces` (`scripts/migrer-acces-documents.mjs`). Leurs cours étant supprimés, seul l'auteur y a accès.
- Cloud Function `onUserWrittenSyncProfil` déployée. Testée en direct : un changement de nom est recopié en moins de 30 s.
- `api/server.js` (ancien serveur de chat en panne, avec un second relais e-mail) est retiré.
- **Reste** : la lecture de `lessons` (§ 4), à traiter dans un plan dédié.
