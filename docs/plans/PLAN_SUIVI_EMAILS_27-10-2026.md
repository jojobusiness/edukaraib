# PLAN — Savoir si nos e-mails arrivent et font revenir les gens (livré, rejeté, cliqué) · 27/10/2026

> ✏️ **Corrections du 03/11/2026, avant exécution :**
> 1. Les numéros de ligne de `notify-email.js` ont changé (verrou du 23/10) : l'envoi est dans la boucle `for (const dest of destinataires)`, avec `toUids` résolus par `api/_destinataires.mjs`.
> 2. **Plus de clic dans Resend pour Joseph** : suivi des clics (`domains.update`) et webhook (`webhooks.create`) se règlent par l'API Resend, et le secret se pose dans Vercel par la CLI.
> 3. `users.dernierMail` est lisible par le compte lui-même (règle de `users`), ce qui est sans gravité. Mais il doit être **protégé en écriture** (`intactOuVide`), sinon un compte pourrait le maquiller.
> 4. `profils` ne recopie que sa liste blanche : `dernierMail` n'y entre jamais, rien à faire.
> 5. Limite de fonctions Vercel : environ 45 fonctions sont déjà déployées sans erreur, le plan n'est donc pas limité à 12. On peut en ajouter une.

> **Demande de Joseph (27/10)** : « comment on fait pour mettre un tracker d'email pour mes apps ». Il a validé un plan par app.
> **Contrainte de Joseph** : tout dans l'admin, rien au terminal.
> **Cas qui déclenche la demande** : Arol goldson et Dylan « Dydy », élèves inscrits le 21/10. Ils n'ont jamais ouvert la conversation avec Joseph sur le site, et Joseph leur a écrit par mail le 27/10. Aujourd'hui, **on ne sait même pas si la notification « nouveau message » envoyée par le site leur est arrivée**, ni si elle est partie en spam.

---

## 0. Ce qui existe déjà (vérifié dans le code le 27/10, ne pas refaire)

- **Tous les mails partent par Resend**, et **aucun ne porte de tag**. Les envois sont dans :
  - `api/notify-email.js:183` : les notifications, dont « nouveau message ». Un mail par destinataire, avec `FROM_PRO` puis `FROM_TEST` en secours ;
  - `api/send-welcome-teacher.js` ;
  - `api/lesson-reminders.mjs` ;
  - `api/stripe-webhook.mjs` (l. 414, 559, 714) ;
  - `api/refund*.mjs` ;
  - `api/trigger-payout.mjs` ;
  - les coupons (`create-*-coupon.mjs`) ;
  - `api/leads-sans-reponse-cron.mjs` ;
  - `api/_partnerEmails.mjs`.
- ⚠️ **Il y a aussi les Firebase Cloud Functions** (`functions/index.js`, CommonJS) : `onNotificationCreated` et `onMessageCreated`. Elles envoient par l'API REST de Resend, via `sendEmailResend()`, depuis `notifications@edukaraib.com`. **C'est sans doute par là qu'est partie la notification à Arol et Dylan.** Il faut ajouter dans le corps JSON de cette requête REST le champ `"tags": [{ "name": "type", "value": "notif-message" }, { "name": "uid", "value": "<destinataire>" }]`, puis lancer le lint et le deploy des Functions (`npm --prefix functions run lint`, `firebase deploy --only functions`).
- **Il n'y a aucun webhook Resend.** On ne sait rien de ce que deviennent les mails après l'envoi.
- **La colonne « Dernière venue »** de l'onglet Comptes (`AdminDashboard.jsx` l. 385 et 854) est livrée le 23/10. Le suivi des mails vient **à côté** : « mail reçu le 21/10, cliqué : non ; dernière venue : le 24/10 ».
- **Le modèle de Factur'Peyi existe déjà et marche en production** depuis le 20/10 : `facturpeyi/api/webhook-resend.js` + `lib-server/emails-bloques.js`. Il y a la vérification de signature Svix, l'idempotence par `svix-id`, la lecture du corps brut et `tagsEnvoi()`. **On le recopie, on ne le réinvente pas.**

## 1. Décision de principe : clics oui, ouvertures non

| Signal | On le suit ? | Pourquoi |
|---|---|---|
| **Livré** (`email.delivered`) | ✅ | C'est l'acheminement du mail, pas un traceur. |
| **Rejeté / spam** (`bounced`, `complained`, `failed`, `suppressed`) | ✅ | Ça permet d'arrêter d'écrire à une adresse morte, et de **voir qu'un élève n'a jamais rien reçu**. |
| **Cliqué** (`email.clicked`) | ✅ | La personne est revenue sur le site grâce au mail. C'est le seul signal qui compte. |
| **Ouvert** (`email.opened`) | ❌ **désactivé** | 1) Faux positifs : l'app Mail d'Apple précharge les images. 2) La CNIL considère le pixel comme un traceur, avec un consentement en principe requis pour un suivi personne par personne. 3) **Beaucoup d'élèves sont mineurs.** ⚠️ Joseph doit relire la recommandation de la CNIL sur les pixels avant de changer d'avis. |

⛔ **La règle de la messagerie tient toujours** (CPCE L32-3, en-tête de `diag-messages.mjs`, plan du 23/10 § 3). Un clic sur la notification « nouveau message » veut dire « il est venu sur le site ». Ça ne veut **jamais** dire « il a lu le message ». Dans l'admin, le libellé est « a cliqué sur le mail », jamais « a lu ».

**Réglage dans Resend (Joseph, au clic, dans le tableau de bord du compte qui envoie pour edukaraib.com)** :
- Domains → `edukaraib.com` → Configuration : **Click tracking : ON**, **Open tracking : OFF**.
- Webhooks → Add endpoint → `https://edukaraib.com/api/webhook-resend` → cocher :
  - `email.delivered`, `email.clicked` ;
  - `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`.
- Copier le *signing secret* dans les variables Vercel, sous le nom **`RESEND_WEBHOOK_SECRET`**.

⚠️ Avec le suivi des clics, Resend réécrit les liens. On vérifie (§ 6) que les liens de visio et de paiement s'ouvrent toujours bien.

## 2. Livraison 1 : étiqueter chaque envoi

- Créer **`api/_suiviEmails.mjs`**, avec :
  - `tagsEnvoi({ type, uid })`, recopiée de Factur'Peyi (Resend n'accepte en tag que des lettres ASCII, des chiffres, `_` et `-`) ;
  - `etatApresEvenement(etat, evenement)` : la fonction pure de priorité, `rejete` > `clique` > `livre` > `envoye` ;
  - `motifRejet(evenement)`, recopiée de `motifBlocage`.
- **Poser `tags` sur chaque `resend.emails.send`** de la liste du § 0, avec un `type` lisible (`notif-message`, `bienvenue-prof`, `rappel-cours`, `paiement`, `remboursement`, `versement`, `coupon`, `relance-lead`, `partenaire`) et l'`uid` du destinataire quand on le connaît.
  - Dans `notify-email.js`, l'uid est connu quand l'appel passe par `toUids` (`frontend/lib/profils.js:85`). Il faut garder le lien uid → adresse dans la boucle de la l. 182.
- À l'envoi, écrire **`users/{uid}.dernierMail = { type, statut: "envoye", envoyeLe, resendId }`** (admin SDK, côté serveur uniquement).

## 3. Livraison 2 : `api/webhook-resend.mjs`

Le fichier est recopié de Factur'Peyi : corps brut, `resend.webhooks.verify`, idempotence dans la collection `emailEvents/{svix-id}`, marquée seulement **après** succès.

```
tags.uid absent → 200 { ignore }
delivered → users/{uid}.dernierMail.statut = etatApresEvenement(...), livreLe
clicked   → statut "clique", cliqueLe (1er clic seulement), nbClics +1
rejet     → statut "rejete", motif, + emailsBloques/{adresse} (comme Factur'Peyi) :
            on n'y écrit plus, et Joseph le voit dans l'admin
opened    → ignoré (désactivé de toute façon)
```

- **Règles Firestore** :
  - `emailEvents` et `emailsBloques` : aucune lecture ni écriture côté client (`allow read, write: if false`), seulement l'admin SDK ;
  - `users.dernierMail` : lecture admin seulement. Il ne doit **pas** être copié dans `profils` : vérifier que `onUserWrittenSyncProfil` ne le recopie pas.
- 📏 **Le nombre de fonctions Vercel** : `api/` compte environ 40 fonctions publiques au 27/10. Vérifier la limite du plan Vercel avant d'en ajouter une. Si la limite est atteinte, brancher le webhook dans une fonction existante qui sert de routeur.

## 4. Livraison 3 : ce que voit Joseph dans l'admin

- **Onglet Comptes**, une colonne « **Dernier mail** » à côté de « Dernière venue » :
  - `envoye` : « ✉️ notif-message · 21/10 » (gris) ;
  - `livre` : « ✓ reçu le 21/10 » ;
  - `clique` : « ✓✓ **cliqué** le 22/10 » (vert) ;
  - `rejete` : « ⚠️ **adresse rejetée** » ou « ⚠️ **classé spam** » (rouge).
- **Filtre** à ajouter à ceux de « Dernière venue » : « Mail jamais reçu (rejeté) ».
- **Onglet 🩺 Diagnostics**, une ligne agrégée seulement : « sur 7 jours : X mails envoyés, Y reçus, Z cliqués, W rejetés ». C'est une mesure globale, sans nom.
- ⛔ Pas de « lu » ni d'« ouvert » nulle part (§ 1).

## 5. Confidentialité

Ajouter une ligne dans la politique de confidentialité : « Nous enregistrons si nos e-mails vous sont bien remis et si vous cliquez sur leurs liens, pour vérifier qu'ils vous parviennent. Nous ne mesurons pas leur ouverture. »

## 6. Tests et vérification

1. `etatApresEvenement` (Vitest) :
   - `delivered` après `clique` → reste `clique` ;
   - `delivered` après `rejete` → reste `rejete` ;
   - 2 clics → `cliqueLe` inchangé, `nbClics` = 2 ;
   - pas d'`uid` → aucune écriture.
2. `tagsEnvoi` : les caractères interdits sont retirés, et les valeurs vides ne sont pas envoyées.
3. Le webhook :
   - une signature invalide renvoie 400 ;
   - un même `svix-id` rejoué n'écrit qu'une fois ;
   - `email.opened` est ignoré.
4. `notify-email` avec `toUids` : chaque mail porte l'uid de **son** destinataire, jamais celui d'un autre.
5. Build, lint et les tests existants (260 au 23/10) au vert, puis commit et push.
6. **En production** :
   - envoyer un message de test à un compte de Joseph, vérifier que la colonne passe à « reçu », puis à « cliqué » après le clic ;
   - **vérifier que le lien du mail ouvre bien la conversation** malgré la réécriture des liens ;
   - vérifier qu'un lien de visio (Jitsi/JaaS) dans un rappel de cours s'ouvre toujours.

## 7. Ce qu'on ne fait PAS

- Pas de pixel d'ouverture.
- Pas de « lu » sur les messages via le mail (§ 1).
- Pas d'outil d'emailing externe (Brevo, Mailchimp) : Resend suffit au volume actuel.
- Pas de relance automatique déclenchée par l'absence de clic : on la fera seulement si la colonne prouve qu'elle serait utile.
