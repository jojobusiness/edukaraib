# PLAN — Voir la dernière connexion de chaque utilisateur dans l'admin · 23/10/2026

> **Demande de Joseph (23/10)** : « faudrait que j'arrive à voir la dernière connexion par utilisateur ».
> **Contrainte de Joseph** : tout dans l'admin, rien au terminal.
> **Cas qui déclenche la demande** : Arol goldson et Dylan « Dydy », élèves inscrits le 21/10, ont reçu un message de bienvenue de Joseph et n'ont pas répondu. Relevé du 23/10 :
> - Arol : inscrit le 21/10 à 18 h 29, **jamais revenu** (dernière venue 18 h 29) ;
> - Dylan : inscrit le 21/10 à 18 h 48, **revenu le 22/10 à 06 h 07**, sans répondre.
>
> Aujourd'hui, cette information n'est visible qu'en lançant un script.

---

## 0. Ce qui existe déjà (vérifié dans le code le 23/10, ne pas refaire)

- **La donnée est déjà enregistrée.** `users/{uid}.lastSeenAt` est écrit par `marquerVenue` (`frontend/lib/derniereVenue.js`), appelée depuis `frontend/contexts/AuthContext.jsx:35`. Livré le 02/10 (`PLAN_SAVOIR_QUI_REVIENT_02-10-2026.md`).
- **L'admin ne la montre qu'en partie.** L'onglet 🩺 Diagnostics (`api/admin-diagnostics.mjs`, bloc « 3. Qui revient ») affiche seulement :
  - le nombre de comptes jamais revenus ;
  - la liste des comptes revenus dans les 7 derniers jours.

  Il ne donne pas la date de chaque compte.
- **Le tableau de l'onglet « Comptes »** (`frontend/pages/AdminDashboard.jsx`, en-têtes l. 818-827, lignes l. ~882) a une colonne « Créé le », mais pas de colonne de dernière venue.
- ⚠️ **Limite de la donnée actuelle.** `DELAI_MS = 24 h` (`derniereVenue.js:15`) : on n'écrit qu'une fois par période de 24 h, et c'est la **première** visite de la période qui est retenue, pas la dernière. La date affichée peut donc avoir jusqu'à 24 h de retard.

## 1. Livraison 1 : une colonne « Dernière venue » dans l'onglet Comptes (le cœur du plan)

**Où** : `AdminDashboard.jsx`, tableau de l'onglet `accounts`. Ajouter un `<th>` « Dernière venue » après « Créé le », et la cellule correspondante.

**Contenu de la cellule**, calculé par une fonction pure `libelleDerniereVenue(createdAt, lastSeenAt, maintenant)`, placée dans `frontend/lib/derniereVenue.js` :

| Cas | Affichage |
|---|---|
| `lastSeenAt` absent | « jamais tracé » (gris). Compte antérieur au 02/10 et jamais revenu depuis. |
| `lastSeenAt` à moins de 1 h de `createdAt` | « **pas revenu depuis l'inscription** » (orange) |
| moins de 24 h | « aujourd'hui » / « hier » |
| sinon | « il y a N j », avec la date complète au survol (`title`, format `JJ/MM/AAAA HH:mm`, heure de Paris) |

**Tri et filtre**, au-dessus du tableau, à côté de la recherche existante :
- **Tri** : « Créé le » (défaut actuel) ou « Dernière venue », de la plus récente à la plus ancienne.
- **Filtre** : Tous · Revenus depuis 7 jours · Pas revenus depuis l'inscription.

**Aucune requête en plus** : `lastSeenAt` est déjà dans les documents chargés par le `onSnapshot` de la l. 438.

## 2. Livraison 2 : une date plus précise (petit réglage)

Passer `DELAI_MS` de 24 h à **1 h**.
- **Coût** : au plus une écriture Firestore par utilisateur et par heure d'activité. Au volume actuel (moins de 50 comptes actifs), c'est négligeable et ça reste dans le quota gratuit.
- **Gain** : la date affichée a au plus 1 h de retard, au lieu de 24 h.
- **Règles Firestore** : rien à changer. `users` est déjà en écriture réservée à son propriétaire, ce qui a été vérifié le 02/10.
- ⚠️ Mettre à jour le test qui fige les 24 h, et le libellé « au plus une fois par jour » dans le commentaire de `derniereVenue.js`.

## 3. Livraison 3 : « Vu » dans la conversation, comme sur WhatsApp (corrigé le 23/10)

> **Correction de Joseph (23/10)** : « sur tous les réseaux quand quelqu'un a vu le message on est prévenu ou on voit ».
> **Il a raison, et j'avais mélangé deux choses.** Un accusé de lecture affiché **à l'expéditeur, dans sa conversation**, fait partie du service de messagerie. C'est autorisé, comme sur WhatsApp ou Messenger. Ce qui reste interdit sans consentement (CPCE L32-3 IV, en-tête de `diag-messages.mjs`), c'est que **la plateforme** compte ou analyse les lectures dans des statistiques ou des relevés.
>
> **Relevé du 23/10 :** Arol et Dylan n'ont **jamais ouvert** la conversation avec Joseph (messages du 21/10 à 23 h 44). Dylan est revenu sur le site le 22/10, mais sans ouvrir ses messages.

**La donnée existe déjà, rien à ajouter en base :**
- `conversations/{id}.reads.{uid}` est écrit à l'ouverture de la conversation (`frontend/pages/Messages.jsx:387`).
- Il est déjà lu pour le point rouge « non lu » (`ChatList.jsx:175`).
- La règle Firestore autorise déjà sa lecture par les participants.

**À faire :**
- **Dans `Messages.jsx`**, sous **mon dernier message envoyé** uniquement :
  - « ✓ Envoyé » si `reads[autreUid]` est absent ou antérieur à l'envoi ;
  - « ✓✓ Vu à 18 h 40 » (ou « Vu hier », « Vu le 22/10 ») si `reads[autreUid] >= sent_at` de ce message.
- **Dans `ChatList.jsx`** : un petit « Vu » ou « Envoyé » à côté de mon dernier message, dans la liste.
- **Pour tous** (élèves, parents, profs, admin) et **dans les deux sens** : celui qui envoie voit si on l'a lu.
- **Une ligne dans la politique de confidentialité** : « Quand vous ouvrez une conversation, votre interlocuteur voit que son message a été lu. »
- ⛔ **On n'en fait aucune statistique** : rien dans 🩺 Diagnostics, `diag-messages` ou un export. L'information reste dans la conversation.

**Tests à ajouter :** une fonction pure `etatLecture(dernierMessage, reads, autreUid)` qui renvoie `envoye` ou `vu` avec la date. On teste :
- la frontière exacte (lecture au même instant que l'envoi = vu) ;
- `reads` absent ;
- un message de l'autre personne, qui ne doit rien afficher.

## 4. Ce qu'on ne fait PAS

- Pas de « lu » dans les statistiques ou les tableaux de l'admin (voir § 3).
- Pas de suivi page par page, pas de temps passé sur le site : Vercel Analytics et Amplitude le font déjà, de façon anonyme.
- Pas de notification à Joseph quand un compte revient : on la fera seulement si la colonne prouve qu'elle est utile.

## 5. Tests (Vitest, à côté de `frontend/test/` existant)

1. `libelleDerniereVenue` : les 4 cas du tableau ci-dessus, dont la frontière exacte de 1 h après l'inscription.
2. Le tri par « Dernière venue » place en dernier les comptes « jamais tracé ».
3. Le filtre « Pas revenus depuis l'inscription » renvoie Arol et pas Dylan, avec les données du 23/10 en fixture.
4. `marquerVenue` avec `delaiMs = 1 h` : pas de 2ᵉ écriture à 59 min, une écriture à 61 min.
5. Build et lint verts.

## 6. Ordre d'exécution

1. Écrire la fonction pure et ses tests (1-3).
2. Ajouter la colonne, le tri et le filtre dans `AdminDashboard.jsx`.
3. Passer le délai à 1 h et faire le test 4.
3 bis. « Vu » dans Messages.jsx et ChatList.jsx (§ 3) + ses tests + la ligne de la politique de confidentialité.
4. Build, puis commit et push.
5. Vérifier en prod dans l'admin, onglet Comptes : Arol doit afficher « pas revenu depuis l'inscription », et Dylan « il y a 1 j » (au 23/10).

## 7. Résultat (23/10/2026)
- ✅ **Livraison 1** : colonne « Dernière venue » dans l'onglet Comptes, avec un tri (créé le / dernière venue) et un filtre (toutes / revenus depuis 7 jours / pas revenus depuis l'inscription). La fonction pure est , avec  et  dans .
- ✅ **Livraison 2** :  passe à 1 h (tests à 59 et 61 min). La Cloud Function  ignore désormais les écritures qui ne changent pas la copie publique, pour ne pas réécrire  à chaque heure de présence.
- ✅ **Livraison 3** : le « Vu » existait déjà depuis le 15/06 (commit c7ef49cf), sans heure. Il affiche maintenant « ✓✓ Vu à 18 h 40 », « Vu hier » ou « Vu le 22/10 » (), il apparaît aussi dans la liste des discussions, et la politique de confidentialité a sa ligne. Aucune statistique n'en est tirée.
- Vérifié sur les vraies données le 23/10 : Arol → « pas revenu depuis l'inscription » (21/10 18:29), Dylan (Dydy) → « il y a 1 j » (22/10 06:07).
- 260 tests, lint 0 erreur, build OK.
