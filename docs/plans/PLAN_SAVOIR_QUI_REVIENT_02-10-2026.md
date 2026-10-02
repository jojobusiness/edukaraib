# PLAN — « Savoir qui revient »

**Créé le 02/10/2026.** Demandé par Joseph après la mesure à J+7 du bandeau prof.
**Une seule livraison : une date de dernière venue sur le site, par utilisateur.** Pas de tableau de bord, pas de notification, pas d'analytics.

> ✅ **EXÉCUTÉ LE 02/10/2026** — 166 tests verts, build vert.
> - `frontend/lib/derniereVenue.js` (`marquerVenue`, garde-fou 24 h, échec silencieux) appelée depuis `AuthContext` ; `users/{uid}.lastSeenAt` écrit au plus une fois par jour. **Aucune règle Firestore à changer** : `users` est déjà en écriture réservée au propriétaire, sans liste blanche de champs — vérifié, pas supposé.
> - `scripts/diag-retours.mjs` (lecture seule, `--role=`) + les 6 tests du plan.
> - 🐛 **Défaut trouvé par les tests** : sans clé en mémoire je comparais à 0 au lieu de pinguer d'office — un compte neuf n'aurait été tracé qu'au bout de 24 h. Corrigé (null ≠ 0).
> - 🐛 **Et dans le relevé** : les dates s'affichaient sans l'année, donc un compte du **02/10/2025** se lisait comme un inscrit du jour. Corrigé.
> - **Mesure J+7 du bandeau prof confirmée le 02/10 : 17 inscrits, 7 réservables — strictement identique au 25/09.**
> - ▶️ **Relire `diag-retours.mjs` vers le 16/10** : avant deux semaines, une date absente ne prouve rien.

---

## 1. Le problème, et il est précis

Le bandeau d'état prof (`734fe26a`) est en production depuis le **25/09**. Mesure à **J+7, le 02/10** :

| | 25/09 | 02/10 |
|---|---|---|
| Passent le filtre qualité | 14 | **14** |
| Ont au moins un créneau | 9 | **9** |
| **Réellement réservables** | **7** | **7** |

**Strictement identique.** Aurélie ARCON toujours sans photo, Belgica Alfaro toujours sans créneau, Sara MINA toujours sans photo.

🔴 **Mais on ne peut pas conclure**, et c'est ça le vrai problème : **rien dans la base ne dit si ces profs sont revenus sur le site.** On ne sait donc pas distinguer :
- *« le bandeau est vu et il ne convainc pas »* → il faudrait le réécrire ;
- *« le bandeau n'est jamais vu »* → il faut une **notification**, et réécrire le bandeau ne servirait à rien.

**Deux diagnostics opposés, deux corrections opposées, et aucun moyen de trancher.**

⚠️ **C'est un défaut du plan du 25/09, et il est à moi** : j'y ai écrit un critère de réussite mesurable sans vérifier qu'on pouvait mesurer l'**exposition**. ➜ **Règle à retenir : avant d'écrire « on mesurera X à J+7 », vérifier que la donnée qui permet d'interpréter X existe.**

---

## 2. Ce qui existe déjà — vérifié dans le code, pas supposé

| Donnée | Où | Ce qu'elle vaut vraiment |
|---|---|---|
| `presence/{uid}.lastSeen` | `api/server.js` → `setPresenceOnline()` / `setPresenceOffline()` | ⚠️ **Écrit uniquement par le serveur Socket.IO du chat.** Donc seulement si la personne **ouvre la messagerie**. Ce n'est pas une trace de visite du site. Et la collection est **illisible** avec la config publique (`permission-denied`) : un script de diag aurait besoin de l'Admin SDK |
| `users/{uid}.profileViews` | incrémenté par `TeacherProfile.jsx:260` | ✅ **Bien écrit** — à chaque ouverture d'une fiche prof. ⚠️ **Correction de ce que j'ai dit le 02/10** : « profileViews est vide sur les trois » voulait dire **personne n'a visité leurs fiches**, pas « le champ n'est jamais écrit ». Et c'est cohérent : Aurélie et Sara sont filtrées faute de photo, Belgica n'a aucun créneau |
| `users/{uid}.createdAt` | inscription | la date d'entrée |
| `users/{uid}.acquisition` | `7990b25f`, depuis le 21/09 | d'où vient la personne |

🔑 **Il manque une seule chose : une trace de dernière venue sur le site, indépendante du chat.**

---

## 3. Ce qu'on livre

**Un champ `users/{uid}.lastSeenAt`, écrit au plus une fois par jour, pour tout utilisateur connecté.**

### Où
`frontend/contexts/AuthContext.jsx` — c'est le seul endroit par lequel passe toute session authentifiée. ⛔ **Pas dans les tableaux de bord** : il y en a un par rôle, et on en oublierait un.

### Comment
À la connexion détectée (`onAuthStateChanged` avec un utilisateur) :
1. Lire `localStorage` pour la clé `ek:lastSeenPing:<uid>`.
2. Si elle existe et date de **moins de 24 h**, ne rien faire.
3. Sinon : `updateDoc(doc(db,'users',uid), { lastSeenAt: serverTimestamp() })`, puis écrire l'horodatage dans `localStorage`.

**Pourquoi le garde-fou des 24 h** : sans lui, chaque navigation déclenche une écriture Firestore. Sur un utilisateur actif, c'est des dizaines d'écritures par jour **pour une information qui n'a besoin que d'une précision d'un jour**.
⛔ **Et l'échec doit être silencieux** (`.catch(() => {})`) : une erreur d'écriture de statistique ne doit jamais empêcher quelqu'un de se connecter.

### Les règles Firestore
`users/{uid}` est déjà modifiable par son propriétaire. **Vérifier** que `lastSeenAt` n'est pas bloqué par une liste blanche de champs — et si une liste existe, l'y ajouter. ⛔ **Un utilisateur ne doit pouvoir écrire ce champ que sur son propre document.**

### Le diagnostic qui va avec
`scripts/diag-retours.mjs`, lecture seule, sur le modèle de `diag-offre-profs.mjs` :

```
=== QUI REVIENT — JJ/MM/AAAA ===
Prof / Élève · nom · inscrit le · dernière venue · jours depuis
--- Jamais revenus depuis l'inscription : n/N
--- Revenus dans les 7 derniers jours   : n/N
```

⚠️ **Il ne dira rien d'utile avant une à deux semaines** : le champ n'existe pas sur les comptes anciens, et il ne se remplira qu'à leur prochaine visite. **Une valeur absente signifie « pas revenu depuis la mise en service », pas « jamais venu ».** ➜ **À écrire dans le script lui-même**, pour que personne ne lise le premier relevé de travers.

---

## 4. Ce qu'on ne fait PAS

- ⛔ **Aucune notification, aucun mail automatique.** C'est le sujet d'après, et il ne se décide qu'avec la donnée que ce plan produit.
- ⛔ **Aucun écran, aucun tableau de bord.** La donnée se lit par script.
- ⛔ **Pas de suivi par page, pas d'analytics.** On veut une date, pas un parcours.
- ⛔ **Ne pas toucher à `presence`** : c'est la mécanique du chat, elle marche, et elle répond à une autre question.

---

## 5. Tests
`frontend/test/derniere-venue.test.jsx` — sur la fonction extraite, sans réseau :
1. Pas d'utilisateur connecté → **aucune écriture**.
2. Utilisateur connecté, `localStorage` vide → **une écriture**, et la clé est posée.
3. Clé datant de **2 heures** → **aucune écriture**.
4. Clé datant de **30 heures** → **une écriture**, la clé est rafraîchie.
5. `localStorage` inaccessible (navigation privée, exception à la lecture) → **une écriture**, et **aucune erreur remontée**.
6. L'écriture Firestore échoue → **l'exception est avalée**, la session continue.

➜ `npm test` doit rester vert et le build passer.

---

## 6. Pourquoi ça vaut le coup maintenant — et pourquoi c'est petit

⚠️ **La règle de Joseph du 25/09 tient : *« sans clients on fait des trucs dans le vide »*.** Ce plan n'est **pas** du travail sur l'offre : c'est de la **mesure**, et elle sert d'abord la **demande**.

**Les trois questions qu'elle permet enfin de poser :**
1. **Sc0r1el, Chamsia ABDOUL, Augustin Rouamba** — les trois élèves inscrits — **sont-ils jamais revenus ?** Aujourd'hui, personne ne le sait. **Un inscrit qui ne revient jamais et un inscrit qui revient trois fois sans réserver sont deux problèmes totalement différents.**
2. Le bandeau prof est-il vu ?
3. Quand il y aura du trafic, qui revient et qui disparaît ?

**Coût : un champ, un garde-fou de 24 h, six tests, un script de lecture.** Aucune migration, aucune règle nouvelle, aucun écran.

---

## 7. Fichiers touchés

| Fichier | Action |
|---|---|
| `frontend/contexts/AuthContext.jsx` | **modifier** — l'appel au ping, après détection de l'utilisateur |
| `frontend/lib/derniereVenue.js` | **créer** — la fonction, isolée pour être testable |
| `frontend/test/derniere-venue.test.jsx` | **créer** — les 6 cas |
| `scripts/diag-retours.mjs` | **créer** — le relevé |
| `firestore.rules` | **vérifier**, modifier seulement si une liste blanche bloque le champ |
