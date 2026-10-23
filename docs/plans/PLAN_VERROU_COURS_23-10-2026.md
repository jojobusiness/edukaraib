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

## 6. Résultat (à remplir)
- RÉSULTAT : …
