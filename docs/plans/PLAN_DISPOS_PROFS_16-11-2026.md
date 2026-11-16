# PLAN — Disponibilités des profs : calendrier « qui ne marche pas » et créneaux qui expirent chaque semaine

**Écrit le lundi 16/11/2026.** À exécuter depuis ce dépôt.

## 1. Le déclencheur
Une professeure s'est inscrite le 16/11 à 10 h 33 (Maths et NSI, du primaire au lycée, visio). Elle est arrivée par Google sur `/` et a répondu « autre » à la question sur la source. À 10 h 52, elle écrit à l'admin :
> « Je n'arrive pas à renseigner mes disponibilités. Quand je clique sur le calendrier, celui-ci s'ouvre, mais les clics sur les dates ne fonctionnent pas. »

## 2. La cause (lue dans le code, `frontend/components/TeacherAvailabilityEditor.jsx`)
- Le **calendrier du mois** (en haut de la fenêtre) n'est qu'un **sélecteur de semaine**. Un clic sur une date appelle `goToWeekOf(day)`, et c'est tout.
- La semaine en cours est **déjà** sélectionnée à l'ouverture. Cliquer sur le 17, le 18 ou le 19/11 ne change donc **rien de visible**. Le 1ᵉʳ au 15/11 sont grisés (jours passés). Pour elle, « les clics ne marchent pas ».
- Les heures se cochent en réalité dans le **tableau du dessous** : 18 colonnes plus une colonne « Actions » de 300 px minimum. Sur un écran moyen, ce tableau est sous la ligne de flottaison ou coupé à droite, et rien n'indique d'y descendre.

## 3. Le vrai problème, plus grave : les créneaux expirent chaque semaine
Les disponibilités sont stockées **par semaine** (`availability['2026-11-16'] = { Lun: [9,10], … }`), et la page prof (`TeacherProfile.jsx`, `availableSlots`) n'affiche que les semaines qui ont des créneaux.

**Mesure du 16/11, sur 23 profs :**
- 13 ont déjà rempli des disponibilités ;
- **0 a un créneau pour la semaine du 16/11** ;
- les dernières semaines remplies vont de mars à début novembre, et un seul prof va jusqu'à janvier 2027.

➜ **Une famille qui arrive aujourd'hui ne trouve presque aucun créneau à réserver.** Un prof doit revenir chaque semaine cocher ses heures, et aucun ne le fait. C'est un blocage direct du paiement, pas un détail d'interface.

## 4. Ce qu'il faut faire (dans l'ordre)

### 4.1 Disponibilités récurrentes : « mes horaires habituels » (le plus important)
- Nouveau champ `availability.modele = { Lun: [9,10,…], Mar: […], … }` : les horaires de **chaque semaine**, sans date de fin.
- Une semaine datée (`'YYYY-MM-DD'`) **remplace** le modèle pour cette semaine-là (vacances, exception). Une semaine datée vide = « pas dispo cette semaine ».
- Lecture côté famille et réservation (`TeacherProfile.jsx`, l.~500 capacité, l.~823 `availableSlots`, et `api/` qui vérifie un créneau) : pour une semaine donnée, on prend la semaine datée si elle existe, sinon le modèle.
  ⚠️ Repérer **tous** les lecteurs de `availability` avant de toucher au format (`grep -rn "availability" frontend api functions`). Les deux formats existants (ancien `{ Lun: [] }` et par semaine) doivent continuer à être lus.
- Migration douce : sans `modele`, prendre comme modèle la **dernière semaine remplie** de chaque prof, et lui écrire « On a gardé vos horaires du JJ/MM comme horaires habituels, modifiez-les si besoin ». Script `scripts/dispos-modele.mjs`, en mode lecture d'abord (affiche ce qu'il ferait), puis en écriture.
  **DÉCIDÉ par Joseph (16/11) : OUI, on prolonge seulement les profs actifs depuis septembre.**
  - Le modèle = la dernière semaine remplie, si cette semaine commence le **31/08/2026 ou après** (la semaine du 31/08 couvre déjà début septembre). Mesure du 16/11 : **8 à 9 profs** concernés, dont 1 qui a déjà rempli jusqu'au 04/01/2027.
  - Les profs dont la dernière semaine remonte à mars 2026 (3 ou 4 profs) ne sont **pas** prolongés. Ils restent invisibles jusqu'à ce qu'ils remplissent leurs horaires habituels eux-mêmes.
  - Chaque prof prolongé reçoit un mail : « On a gardé vos horaires du JJ/MM comme horaires habituels. Ils reviennent chaque semaine, modifiez-les si besoin : [lien vers le profil] ».
  - Le script tourne d'abord en lecture : il affiche la liste (prof, dernière semaine, horaires repris). Ensuite seulement, il écrit et envoie les mails.

### 4.2 L'éditeur : un écran qu'on comprend sans explication
1. En haut, **2 onglets** : « Mes horaires habituels » (ouvert par défaut, grille des 7 jours sans dates) et « Une semaine particulière » (le calendrier du mois actuel).
2. Un clic sur une date du calendrier : la semaine change, la grille **défile jusqu'à elle** (`scrollIntoView`), et un message dit « Semaine du 16 au 22/11 : cochez vos heures ci-dessous ».
3. **Mobile** : une ligne par jour, avec les heures en pastilles qui passent à la ligne (pas de tableau de 18 colonnes). La colonne « Actions » passe sous le jour.
4. Les raccourcis « Bureau » et « Continu » restent, et s'appliquent au modèle quand l'onglet « habituels » est ouvert.
5. Le bouton « Enregistrer » existant (09/11, `be332c14`) reste : il sauvegarde tout de suite.

### 4.3 Garde-fous
- `admin-diagnostics.mjs` et `admin-fiche-compte.mjs` (`nbCreneaux`) comptent le modèle comme des créneaux à venir.
- `scripts/diag-offre-profs.mjs` : ajouter la ligne « profs réservables cette semaine ». Elle doit passer de 0 à ≥ 10 après la migration.
- Tests : un test vitest sur la fonction pure « créneaux d'une semaine = semaine datée sinon modèle » (dans `api/_dispos.mjs`, importée par le front et par l'API, comme `_partners.mjs`).

### 4.4 Les fuseaux horaires : chacun voit l'heure de chez lui (demande de Joseph, 16/11)

**Le problème aujourd'hui (lu dans le code).** Un créneau est stocké sans fuseau : `Lun` + `18`. À la réservation, `BookingModal.jsx` (l. 378, `startAtFromDate`) en fait une « Date complète **locale** ». Les tableaux de bord recalculent `startAt` avec `nextOccurrence(slot_day, slot_hour)`, dans **le fuseau du navigateur de celui qui regarde**.
➜ Un prof en Guyane coche 18 h. Une famille en Martinique voit « 18 h » et le comprend comme 18 h chez elle, alors que c'est 17 h chez elle. Avec La Réunion, l'écart est de 7 à 8 h. **Les deux ne se retrouvent pas à la même heure.**

**Où sont les gens (16/11)** :
- profs : 13 en Guyane, 4 en Martinique ou Guadeloupe, 1 à La Réunion, 4 dans l'Hexagone, 1 « en ligne » ;
- élèves : Guyane, Martinique, Paris, « en ligne ».

Ce n'est donc pas un cas rare : c'est le cœur de l'offre (un prof de Guyane pour un élève des Antilles).

**La règle** : un créneau est un **instant précis**. Chacun le voit dans **son** fuseau, avec l'heure de l'autre en petit.

1. **Le fuseau de chaque compte** : `users/{uid}.timezone`, un nom IANA.
   - Il est rempli à l'inscription et à la connexion s'il est vide, avec `Intl.DateTimeFormat().resolvedOptions().timeZone` ; corrigé si le navigateur répond `Europe/Paris` pour un compte dont `pays_inscription` est un DOM (VPN, ordinateur réglé sur Paris).
   - Le profil a un menu « Votre fuseau » : Guyane (`America/Cayenne`), Martinique (`America/Martinique`), Guadeloupe (`America/Guadeloupe`), La Réunion (`Indian/Reunion`), Mayotte (`Indian/Mayotte`), Hexagone (`Europe/Paris`), Nouvelle-Calédonie, Polynésie, Haïti, et « autre ».
   - Les 3 chemins d'inscription (`Register.jsx`, `ensureUserDoc.js`, `partner-signup.mjs`) l'écrivent tous, comme pour `acquisition`.
2. **Les disponibilités sont saisies dans le fuseau du prof** (`availability.fuseau`). L'éditeur affiche « Vos horaires, heure de Guyane (UTC−3) ».
3. **Côté famille** : chaque créneau (semaine + jour + heure, fuseau du prof) devient un instant absolu, puis il s'affiche dans le fuseau de la famille, sous la forme « **17 h** chez vous · 18 h pour le prof ». Si l'écart déplace le créneau sur un autre jour, la grille le range au bon jour, celui de la famille. Exemple : 20 h en Martinique = 4 h le lendemain à La Réunion.
4. **À la réservation** : on enregistre l'instant en UTC (`start_utc`, ISO) + `fuseau_prof`. Les champs `slot_day`, `slot_hour` et `weekKey` restent, dans le fuseau du prof, pour la compatibilité. Tous les affichages (`MyCourses`, `Parent*`, `Student*`, `Teacher*Calendar`, tableaux de bord) lisent `start_utc` quand il existe, et ne retombent sur `nextOccurrence` que pour les anciens cours.
5. **Mails et rappels** (`functions/index.js`, `api/notify-email`, les rappels de cours, le lien visio) : l'heure est écrite dans le fuseau **du destinataire**, avec le nom du fuseau (« lundi 23/11 à 17 h, heure de Martinique »).
6. **Heure d'été** : l'Hexagone change d'heure (29/03/2027, 31/10/2027), les DOM non. L'écart Paris-Antilles passe de 5 h à 6 h. On ne stocke **aucun décalage fixe** : chaque conversion passe par `Intl.DateTimeFormat(…, { timeZone })` **à la date réelle du cours**. Fonctions pures dans `api/_fuseaux.mjs` (sans dépendance, comme `_partners.mjs`), importées par le front et l'API.
7. **Les données existantes** : le script `scripts/fuseaux-profs.mjs` propose un fuseau par prof, d'après sa ville et son `pays_inscription` (Cayenne → `America/Cayenne`, MQ → `America/Martinique`…). Il les liste d'abord, puis les écrit après l'accord de Joseph. Les cours **déjà réservés** gardent leur heure actuelle, interprétée dans le fuseau du prof.

**Tests à ajouter** (vitest, `api/_fuseaux.mjs`) :
- un prof en Guyane coche 18 h → une famille en Martinique voit 17 h, et une famille à La Réunion voit 1 h le lendemain ;
- un prof dans l'Hexagone coche 18 h en hiver → 13 h en Martinique ; le même créneau après le 29/03/2027 → 12 h ;
- un prof à La Réunion coche 7 h lundi → en Guyane, c'est dimanche 0 h, et la grille le range au dimanche.

## 5. Tests (par Claude, avant de livrer)
- `npm test` et `npm run build`.
- En local, avec un compte prof de test :
  - remplir les horaires habituels ;
  - vérifier que la page du prof, vue par une famille, montre des créneaux cette semaine ET dans 3 semaines ;
  - créer une exception sur une semaine, et vérifier qu'elle remplace le modèle pour cette semaine seulement.
- Captures en mobile (390 px) et en ordinateur de l'éditeur.
- En prod après le déploiement : `diag-offre-profs.mjs`.

## 6. Message à la prof (envoyé par Joseph, avant le correctif)
> Bonjour et bienvenue ! Le calendrier du haut sert seulement à choisir la semaine : les heures se cochent dans le tableau juste en dessous (une case = 1 h), puis « Enregistrer ». On rend ça plus clair dans les jours qui viennent. Par curiosité, comment avez-vous connu EduKaraib ?

## RÉSULTAT
- Décision de Joseph sur la migration (§ 4.1) : ✅ oui, profs actifs depuis le 31/08 seulement (16/11)
- Livré le : __ · commit : __ · profs réservables cette semaine : avant 0 → après __
