# 📊 PLAN — savoir d'où vient chaque inscrit (préparé le 19/09/2026, à exécuter le 20/09)

> ✅ **EXÉCUTÉ LE 21/09/2026** — T1, T2 et T4 codés et testés (14 tests dans `frontend/test/acquisition.test.js`), T3 fait pour les mails Zoho ; les liens des réseaux sociaux restent à poser par Joseph (liste en bas).
> - **T1** : `api/_acquisition.mjs` (règles pures, partagées front/API) + `frontend/lib/acquisition.js` (capture dans `main.jsx`, 90 jours). Écrit `users/{uid}.acquisition` sur les **trois** chemins de création de compte : inscription email (`Register.jsx`), Google (`utils/ensureUserDoc.js`, donc aussi `Login.jsx`), partenaire (`api/partner-signup.mjs`, re-nettoyé côté serveur). Capte aussi `fbclid`/`ttclid`/`gclid` (Facebook reconnu même quand le navigateur in-app perd le référent) et le `?code=` partenaire.
> - Écart assumé avec le plan : la 1re source gagne **sauf** si c'était « direct » (visite dont l'origine est perdue) — une vraie source trouvée ensuite la remplace. Le référent est stocké sans sa query string (`users` est en lecture publique).
> - **T2** : « Comment avez-vous connu EduKaraib ? » — obligatoire sur l'inscription complète, **facultatif en mode express** (landing /bac, où chaque champ coûte des inscriptions). Absent du bouton Google (pas de formulaire), sauf si choisi avant le clic.
> - **T3** : `99_SCRIPTS/zoho/envoyer.mjs` met `utm_source=zoho&utm_medium=mail&utm_campaign=…` sur tous ses liens (`--campagne=` pour une nouvelle campagne).
> - **T4** : `node scripts/diag-acquisition.mjs [--semaines=4]`. 1er relevé (21/09) : 2 inscrits en 8 semaines (18/09, un élève et une prof), antérieurs au suivi → « non mesuré ».

> **Demandé par Joseph le 19/09**, après avoir corrigé Claude : *« si mdr c'est de Facebook avec une vidéo, c'est grâce aux analyses de Vercel — c'est pour ça qu'il faut trouver le moyen de bien remonter »*.
> ✅ **Il avait raison** : la source EST visible, dans le tableau de bord Vercel. Ce plan ne sert donc pas à « avoir des analytics » — il en existe déjà trois. Il sert à combler le **seul trou réel** : rien n'est écrit **sur le compte de l'inscrit**, donc on sait qu'un visiteur vient de Facebook, mais jamais **quel compte** vient de Facebook.

## 1. Ce qui existe déjà (lu dans le code le 19/09, ne rien réinstaller)
| Outil | Où | Ce qu'il donne | Sa limite ici |
|---|---|---|---|
| **Vercel Analytics** | `frontend/main.jsx` → `inject()`, PROD uniquement | Visiteurs, pages, **sources de trafic** (c'est lui qui a montré Facebook) | **Agrégé.** Il compte des visites, il ne nomme pas de compte |
| **Amplitude** | `frontend/lib/amplitude.js`, `autocapture: true`, zone **EU**, chargé après le 1er rendu | Funnels, rétention, sessions · `ampIdentify(uid)` relie déjà les events à l'utilisateur connecté | Il ne stocke rien dans **Firestore** : impossible de croiser avec les réservations et les paiements |
| **Meta Pixel** | `frontend/lib/metaPixel.js` | Conversions côté Facebook | Coupé par les bloqueurs et par iOS |
| **Sentry** | `frontend/main.jsx` | Erreurs, replays | Hors sujet ici |

## 2. Le trou, précisément
`frontend/pages/Register.jsx` ligne ~345 : le document écrit dans `users` contient `uid, email, role, firstName, lastName, fullName, phone, city, avatarUrl, createdAt`. **Aucun champ d'acquisition.** Résultat : l'élève inscrit le 18/09 à 20 h 50 est un chiffre dans Vercel et une ligne anonyme dans Firestore, et les deux ne se rejoignent jamais.

🔑 **Factur'Peyi a déjà résolu exactement ce problème** — voir `Factur'Peyi/facturpeyi/src/lib/parrainage.js` et son en-tête : le code `?ref=` ne survivait ni au F5, ni à Google, ni à Stripe. La solution qui y tourne (capture à l'arrivée sur n'importe quelle page + conservation 90 jours dans le navigateur) **se transpose ici telle quelle**. On ne réinvente rien, on porte.

## 3. Les tickets, dans l'ordre de valeur

### T1 — capturer la source à l'arrivée et l'écrire sur le compte *(le seul indispensable)*
Créer `frontend/lib/acquisition.js`, sur le modèle de `parrainage.js` :
- Au chargement de **n'importe quelle** page : lire `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, et à défaut `document.referrer`.
- Ranger le tout dans `localStorage` sous une clé unique, **avec la date**, pour **90 jours**. ⚠️ **La PREMIÈRE source gagne et ne s'écrase pas** — contrairement au parrainage, où le dernier lien gagne. Ici on veut savoir qui a fait découvrir EduKarib, pas qui a été cliqué en dernier.
- Dans `Register.jsx`, ajouter au `baseData` :
  ```js
  acquisition: {
    source: …,        // "facebook" | "tiktok" | "youtube" | "instagram" | "zoho" | "direct" | …
    medium: …,        // "video" | "carrousel" | "story" | "mail" | "bio"
    campaign: …,      // "rentree", "bac", "assos-septembre"
    referrer: …,      // document.referrer brut, pour trancher les cas douteux
    landing: …,       // la 1re page vue (/bac, /rentree, /partenaire…)
    premierContact: … // horodatage de la 1re visite, pas de l'inscription
  }
  ```
- ⚠️ Écrire **en plus**, jamais à la place : aucune modification des champs existants.
- ⚠️ Ne jamais faire échouer l'inscription si la lecture échoue (navigateur in-app, mode privé) : tout en `try/catch`, valeur par défaut `"inconnu"`.

### T2 — la question déclarative, le filet quand la technique échoue
Un champ obligatoire dans le formulaire : **« Comment avez-vous connu EduKaraib ? »** → *Facebook · TikTok · Instagram · YouTube · Un professeur · Mon établissement ou une association · Un proche · Autre*.
🔑 **C'est ce filet qui a attribué Martin chez Factur'Peyi**, là où le technique avait échoué. Les navigateurs in-app de Facebook et Instagram — d'où vient justement cet élève — sont précisément ceux qui perdent le plus de paramètres.

### T3 — mettre des `utm` sur tout ce qui sort *(gratuit, 20 minutes, à faire même sans T1)*
| Canal | Lien à utiliser |
|---|---|
| Bio TikTok / Instagram | `edukaraib.com/?utm_source=tiktok&utm_medium=bio` |
| Facebook (le canal qui a produit) | `…?utm_source=facebook&utm_medium=video&utm_campaign=<moule>` |
| Description YouTube | `…?utm_source=youtube&utm_medium=description` |
| Mails Zoho aux associations | `edukaraib.com/partenaire?utm_source=zoho&utm_campaign=assos-septembre` |
| Carrousels (CTA en légende) | `…?utm_source=instagram&utm_medium=carrousel` |
⚠️ Un paramètre `utm_` n'empêche pas une page de s'afficher : c'est sans risque.

### T4 — le diagnostic, pour que le relevé du dimanche se fasse en 10 secondes
`scripts/diag-acquisition.mjs`, calqué sur `diag-offre-profs.mjs` (même config publique, lecture seule) : compte les inscrits **par source, par semaine, par rôle**, et signale ceux restés en `"inconnu"`. Le jour où ce chiffre tombe sous 30 %, l'attribution est fiable.

## 4. Ce que ça change concrètement
Aujourd'hui le relevé du dimanche dit « +1 élève ». Après ces tickets il dira **« +1 élève, Facebook, vidéo M3, landing /bac »** — et à partir de là, l'arbitrage des slots du 30/09 se fait sur des faits et non sur une impression. **C'est le même arbitrage que pour les profs : on ne double pas ce qu'on ne sait pas mesurer.**

## 5. Ordre d'exécution conseillé (½ journée)
1. **T3** en premier — 20 minutes, aucun code, et ça commence à collecter tout de suite.
2. **T1** ensuite — le cœur.
3. **T2** dans la foulée, c'est un `<select>` de plus.
4. **T4** à la fin, pour rendre le dimanche automatique.

⚠️ **Avant de coder T1** : ouvrir `Factur'Peyi/facturpeyi/src/lib/parrainage.js` en entier. Les pièges (F5, connexion Google, redirection de paiement, casse du code) y sont déjà documentés et résolus — les reproduire ici serait payer deux fois la même leçon.
