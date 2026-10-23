# PLAN — Fermer la lecture des cours (`lessons`) · 23/10/2026

> **Demande de Joseph (23/10)** : « go », après le verrou des données personnelles (`PLAN_VERROU_DONNEES_23-10-2026.md`, § 4).
> **Contrainte** : ne pas casser la réservation, c'est le chiffre d'affaires.

## 0. Ce qui fuit aujourd'hui
`lessons` : `allow read: if true`. **Sans compte**, on lit chaque cours :
- le prof et l'élève (ou l'enfant), le parent qui a réservé ;
- le créneau, le prix, et le statut de paiement par participant.

Depuis le 23/10, les identifiants mènent à un nom grâce à `profils`. Ça donne donc : « tel enfant a maths le mardi à 17 h avec tel prof ».

`update: if signedIn()` : n'importe quel compte connecté modifie n'importe quel cours (statut, participants…), sauf les champs de paiement.

## 1. Pourquoi c'était ouvert (vérifié dans le code)
| Qui lit les cours des AUTRES | Pourquoi |
|---|---|
| `TeacherProfile` (page publique, sans compte) | Griser les créneaux pris et compter les places restantes d'un groupe. |
| `TeacherProfile`, réservation | Rejoindre le cours collectif existant d'un autre élève : lecture **et** écriture du cours d'autrui. |
| Pages parent (`ParentCalendar`, `ParentCourses`, `ParentDashboard`, `ParentPayments`, `ChildDetails`) | Elles cherchent par identifiant d'enfant (`student_id in [...]`). Une règle ne peut pas relier un enfant à son parent dans une requête. |
| `StudentPayments` | Même cas, avec les alias élève (`students.user_id`). |

## 2. Ce qu'on met en place
1. **`lessons.acces`** : liste des comptes du cours (prof, élèves, parents, réservants, et le compte lié à une fiche `students`). La Cloud Function `onLessonWrittenSync` la recalcule à chaque écriture ; le navigateur la pose aussi à la création, pour que le cours apparaisse sans attendre.
2. **`creneaux/{lessonId}`** : copie publique sans aucun identifiant d'élève (prof, jour, heure, date, statut, groupe, capacité, nombre de places prises), écrite par la même fonction. La page publique du prof lit cette copie. La pastille « mon enfant est inscrit ici » vient des cours du visiteur connecté.
3. **`/api/rejoindre-groupe`** : rejoindre le cours collectif d'un autre élève passe par le serveur. Il vérifie que l'élève visé est soi-même ou son enfant, puis ajoute le participant, sans rien renvoyer des autres élèves.
4. **Vérification des doublons à la réservation** : elle ne porte que sur mes propres cours, relus par `acces`.
5. **Pages parent et élève** : une requête `where('acces', 'array-contains', moi)`, puis le filtre existant sur les enfants.

## 3. Règles
- `lessons` :
  - lecture et modification par l'admin, le prof du cours, l'élève, un participant ou un compte de `acces` ;
  - les champs de paiement restent interdits en écriture, et `teacher_id` ne peut pas changer ;
  - création : en son nom (`acces` doit contenir le créateur).
- `creneaux` : lecture publique, écriture interdite (seule la fonction écrit).

## 4. Preuve
- Émulateur (`npm run test:regles`) :
  - un intrus et un visiteur sans compte ne lisent ni ne modifient aucun cours ;
  - prof, élève et parent lisent les leurs avec les requêtes exactes de leurs pages ;
  - la page publique lit `creneaux`.
- Prod : `scripts/diag-regles-donnees.mjs`, complété pour `lessons` et `creneaux`.
- Parcours réel testé avec des comptes de test sur la prod : création, doublon, rejoindre un groupe.

## 5. Fraude trouvée en route : le « payé » forgé
`participantsMap.<élève>.is_paid` était modifiable par n'importe quel participant. Or `create-checkout-session` (`isAlreadyPaid`) s'y fie : une famille qui le passe à `true` n'est plus jamais invitée à payer. Le cours s'affiche « payé », le prof le donne, et il n'est jamais payé : le versement exige un vrai paiement `held`, qui n'existe pas dans ce cas.

Seuls cas légitimes où le navigateur écrit `true` :
- la création d'un **essai gratuit** (`is_trial`, prix 0) ;
- le prof qui passe un cours individuel déjà payé en cours collectif (il recopie `lesson.is_paid`).

Règle : pour chaque participant, `is_paid` ne peut devenir `true` que s'il l'était déjà. Il y a deux exceptions, ces deux cas, et le webhook (Admin SDK) n'est pas concerné par les règles.

## 6. Résultat (23/10/2026)
- ✅ **Livré et vérifié en production.**
  - Commits `e1149ee9` (verrou) et le correctif `/api/rejoindre-groupe` qui suit.
  - Règles finales déployées.
  - Cloud Function `onLessonWrittenSync` déployée.
  - Données migrées par `scripts/migrer-acces-cours.mjs` (1 cours en base).
- **Parcours réel contre la prod** (`scripts/essai-reservation-prod.mjs`, comptes de test créés puis supprimés) : 17/17.
  - Le parent crée un cours collectif.
  - Le créneau public apparaît, sans aucun identifiant.
  - Un visiteur sans compte voit le créneau pris, mais pas le cours.
  - Un élève rejoint le groupe par l'API ; une deuxième tentative donne « doublon ».
  - Le créneau public passe à 2 places prises.
  - Toutes les tentatives de fraude sont refusées : se déclarer payé, inscrire l'enfant d'un autre, lire le cours d'autrui.
- ⚠️ **Incident pendant la bascule, ~10 min.** `/api/rejoindre-groupe` renvoyait une erreur 500 : `FieldValue.deleteField` n'existe pas dans l'Admin SDK, il faut `FieldValue.delete()`. L'essai de bout en bout l'a détecté juste après la mise en ligne. Le correctif est poussé et l'essai a été relancé : 17/17. Impact vérifié : 0 demande de cours (notifications `lesson_request`) sur les 2 dernières heures, 1 seul cours en base. Personne n'a été bloqué.
  - Leçon : un test unitaire avec de faux `FieldValue` ne prouve rien. Le test utilise désormais les vraies valeurs de l'Admin SDK.
- `scripts/diag-regles-donnees.mjs`, complété pour les cours : 0 faille. `scripts/diag-regles-paiements.mjs` : 0 faille.
- Émulateur : 30 tests. Sur les règles d'avant, 6 échouent, **dont la fraude au « payé » : elle était bien possible en prod**.
- Vitest : 271 tests, lint 0 erreur, build OK.
