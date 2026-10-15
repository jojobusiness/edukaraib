# PLAN — Page `/methode` : le guide de révision sur le site, avec un appel à l'action fort · 15/10/2026

> **Origine (15/10/2026)** : les **2 premiers commentaires « MÉTHODE »** sont arrivés sur le Short YouTube du B-roll 1 (« Il révise des heures et oublie tout le lendemain »). YouTube n'a pas de messagerie : le guide doit avoir une adresse publique.
> **Décision de Joseph :** *« il faut qu'il soit sur le site web… on donne la méthode et on met un CTA agressif pour qu'ils s'inscrivent et prennent un prof »*.
> ✅ **EXÉCUTÉ LE 15/10/2026** (validé par Joseph : tout le plan d'un coup) — 169 tests verts, build vert, page et PDF servis en local (200).
> - Page `/methode` + alias `/guide` et `/methode-revision`, footer, sitemap, PDF sur `/guide/reviser-pour-de-vrai.pdf`. GATE_PDF = B.
> - Messagerie : contact sans compte → inscription express (plus `/login`), prof sans créneau → « écrivez-lui » + « Demander ses disponibilités », brouillon pré-rempli généralisé. **`Search.jsx` n'avait aucun trou** : « Contacter » y existe déjà pour tous les profs, aucun filtre ne masque ceux sans créneau — rien touché.
> - Alerte « 🔥 nouveau lead » (1 seule par conversation, transaction anti-doublon) + cron horaire `leads-sans-reponse-cron` (4 h, 8 h-21 h Paris) + `scripts/diag-messages.mjs`.
> - Clauses ajoutées aux CGU (7.2 bis) et à la confidentialité **avant** d'envoyer le moindre extrait.
> - `/methode` sans utm ⇒ `source=video, campaign=methode` (2 tests) + ligne « via /methode » dans `diag-acquisition`.
> - ⚠️ **Reste à faire par Joseph** : `firebase deploy --only functions` (l'alerte lead vit dans une Cloud Function), et `npx vercel env pull .env.local` pour lancer `diag-messages`.
>
> 🔴 **Fait mesuré le 15/10 qui conditionne tout** : entre le 02 et le 15/10, **aucun prof n'est revenu sur le site** (`diag-retours`). Le lead chaud ne sera pas sauvé par le produit mais par le **coup de fil de Joseph** — d'où l'alerte immédiate.

> **Objectif mesurable :** transformer chaque « MÉTHODE » en **inscrit** (KPI du dimanche : `node scripts/diag-acquisition.mjs`), puis en **réservation**.

---

## ⚠️ 0. Trois faits à connaître AVANT de coder

1. **Sur un Short, les liens ne sont pas cliquables**, ni dans la description ni dans les commentaires (règle YouTube depuis le 31/08/2023, contre le spam). Sont cliquables : les liens de la **bannière/bio de la chaîne**, et la description des **vidéos longues**. TikTok : pas de lien non plus.
   ➜ **L'adresse doit se taper de mémoire : `edukaraib.com/methode`.** C'est elle qu'on dit dans les réponses, qu'on épingle et qu'on met à l'écran dans les prochains montages. Ajouter aussi le lien dans les **liens de la chaîne YouTube** (Personnalisation → Informations de base → Liens), cliquable depuis la page de la chaîne.
   *(À vérifier en 10 s : coller l'URL dans la description du Short et regarder si elle devient bleue.)*
2. **La page enverra du trafic sur une offre mince.** Relevé du 12/10 : 7 profs réservables, et les 5 mieux notés (Charif, Dylan, Parfait, Olèm, Khalil) n'ont **aucun créneau**. ➜ Lancer `node scripts/diag-offre-profs.mjs` avant la mise en ligne, et ne pointer le CTA que vers les matières qui ont un prof réservable. ⛔ Aucun chiffre interne sur la page (pas de « 7 profs »).
3. **Le guide existe déjà** : `EduKarib/01_MARKETING/fiche-revision-02-10-2026/GUIDE_REVISION.html` (source) + le PDF de 11 pages. On ne réécrit pas la méthode, on la **découpe**.

---

## 1. Ce qu'on donne sans inscription — ✅ TRANCHÉ PAR JOSEPH LE 15/10 : option B

| | A. Tout ouvert | B. **Hybride (recommandé)** | C. Tout derrière l'inscription |
|---|---|---|---|
| Sur la page | la méthode complète + PDF libre | **la méthode lisible en entier** (les 5 méthodes, le diagnostic) | un teaser |
| Derrière l'inscription | rien | **le PDF complet** (check-list J-7 → jour J, semaine type, erreurs par matière) | tout |
| Inscrits | faibles | **moyens à forts** | forts sur les motivés, mais l'élève qui a commenté se sent piégé |
| Risque | 0 conversion | faible | « MÉTHODE = piège à inscription » dans les commentaires, qui tue les suivants |

✅ **Option B retenue par Joseph (15/10).** La promesse faite dans la vidéo (« je t'envoie le guide ») est tenue sur la page ; le **PDF à garder**, lui, coûte une inscription **express en 1 clic (Google)**. C'est agressif sans être un appât. Le code garde A/B/C réglables par une constante (`GATE_PDF`, valeur **`B`**), au cas où la mesure dise autre chose.

---

## 2. Ce qu'il faut construire

### 2.1 Route et page
- `frontend/pages/Methode.jsx` (sans props obligatoires : la fumée de `npm test` monte toutes les pages).
- Route `/methode` dans `frontend/App.jsx`. Alias `/guide` et `/methode-revision` → `<Navigate to="/methode" replace />` (les gens tapent mal).
- `useSEO({ title: 'Réviser pour de vrai : la méthode gratuite | EduKaraib', description: 'Pourquoi on oublie tout le lendemain, et les 5 méthodes qui font tenir une leçon. Guide gratuit pour élèves et parents des Antilles, de Guyane, de La Réunion et de Mayotte.', url: 'https://edukaraib.com/methode' })`.
- `public/sitemap.xml` + lien dans `Footer.jsx` (règle « nouvelles pages » du CLAUDE.md).
- PDF copié dans `public/guide/reviser-pour-de-vrai.pdf` (nom sans date ni majuscules : c'est une URL).

### 2.2 Structure de la page (mobile d'abord : le trafic vient des Shorts)
1. **Hero** : « Tu révises des heures et tu oublies tout le lendemain ? Ce n'est pas toi, c'est la méthode. » + bouton **« Trouver un prof cette semaine »** (CTA n° 1, dès le premier écran).
2. **Reconnaître ≠ se souvenir** (repris du guide) + **diagnostic en 3 niveaux**.
3. **Les 5 méthodes** (blurting, répétition espacée J+1→J+30, Cornell, Feynman, exercices niveau contrôle), en cartes dépliables.
4. **CTA n° 2 au milieu** : « Tu as compris la méthode. Ce qui manque, c'est quelqu'un qui te teste. » → prof.
5. **Le PDF complet** : bouton « Télécharger le guide complet (11 pages) » → selon `GATE_PDF` : téléchargement direct, ou `/register?express=1&next=/methode?pdf=1`.
6. **Bloc parent** (vouvoiement) : « Votre enfant révise mais les notes ne suivent pas ? » → même CTA.
7. **CTA n° 3 final** + **barre collante en bas sur mobile** : « Un prof près de chez toi ou en visio → Réserver ».

### 2.3 Le CTA « agressif » : où il mène
- Bouton prof → `/search` (filtré sur une matière réservable si l'élève l'a choisie dans un petit sélecteur « Ta matière qui coince : Maths / Français / Physique-Chimie / Anglais »). Reprendre la liste de `BAC_CAMPAIGN.subjects` (déjà tenue à jour sur l'offre réelle) plutôt qu'en coder une nouvelle.
- Non connecté → `/register?express=1&next=/search?subject=…` (le mode express et `next` existent déjà dans `Register.jsx`, l. 176-198 : rien à inventer).
- Retour `?pdf=1` après inscription → déclencher le téléchargement + toast « Ton guide se télécharge. Prochaine étape : un prof pour te tester. »
- Si un bon de bienvenue existe déjà à l'inscription (`api/create-welcome-coupon.mjs`, codes `BIENVENUE-…`) : **l'afficher sur la page** (« ta 1ʳᵉ heure avec ton bon de bienvenue »). Vérifier son montant et ses conditions dans le code avant d'écrire une phrase dessus ; ne rien promettre qui n'existe pas.

### 2.4 MESSAGERIE D'ABORD — demandé par Joseph le 15/10
> *« si un lead est chaud je vais lui dire de contacter le prof pour les dispo… faut aussi que le site soit axé sur la relation par messages »*
> Raison : un prof sans créneau ouvert reste **joignable**. Le message transforme l'offre mince (7 réservables) en offre réelle (tous les profs filtrés), et c'est dans la conversation que l'heure se vend.

**Ce qui existe déjà (lu le 15/10)** : carte prof de `Search.jsx` → bouton contact → si non connecté, modale « Contactez X gratuitement » → `/register?express=1&next=/chat/{uid}` (l. 597-620). `TeacherProfile.jsx` a un message **pré-rempli** (l. 192-207), mais seulement pour le tunnel `/bac`.

**Les 3 trous à boucher :**
1. **`TeacherProfile.jsx`, l. 193 : non connecté → `/login`.** Un nouveau visiteur atterrit sur une page de connexion alors qu'il n'a pas de compte : fuite. ➜ Même modale que la recherche : `/register?express=1&next=/chat/{teacherId}`.
2. **Un prof sans créneau = cul-de-sac** (« Aucun creneau disponible. », l. 1734). ➜ À la place : « Pas encore de créneau en ligne : **écris-lui, il te répond avec ses dispos** » + bouton **« Demander ses disponibilités »** (gros, vert). Dans `Search.jsx`, le prof sans créneau garde un bouton **« Écrire »** au même niveau que « Réserver » chez les autres. Vérifier qu'aucun filtre de `Search` ne masque les profs sans créneau ; s'il y en a un, les afficher **après** les réservables, jamais les cacher.
3. **Message pré-rempli partout, pas seulement pour /bac.** Généraliser `setChatDraft` : venu de `/methode` → « Bonjour {prénom}, j'ai lu la méthode de révision d'EduKaraib. J'ai besoin d'aide en {matière} ({niveau si connu}). Quelles sont vos disponibilités cette semaine ? » L'élève n'a plus qu'à appuyer sur Envoyer.

**Et sur `/methode`** : le CTA principal devient **« Écrire à un prof »** (pas « Réserver ») : moins engageant, donc plus de clics, et ça marche même sans créneau. « Réserver » reste en second.

**Côté prof et côté Joseph (vérifier, ne pas réinventer)** : un nouveau message doit (a) prévenir le prof par e-mail (`notifyEmailUser` / `onMessageCreated`, cf. CLAUDE.md « Notifications ») et (b) alerter Joseph (`ADMIN_INBOX`), pour qu'il puisse relancer le prof si la réponse tarde : **un lead chaud qui attend 24 h est un lead perdu.** Tester les deux sur un vrai envoi.

### 2.4 bis SAVOIR QUI ÉCRIT À QUI, ET COMBIEN — demandé par Joseph le 15/10
> *« c'est un détail important, il faut que je sache à qui et combien de messages sont envoyés »*

**Constat dans le code (15/10)** : `functions/index.js`, `onMessageCreated` (l. 255-280) **ne prévient l'admin que si le destinataire EST l'admin** (« On ne notifie que si le DESTINATAIRE est un admin »). Un message élève → prof : le prof reçoit un e-mail (`notifyEmailUser`, `Messages.jsx` l. 454), **Joseph ne voit rien**. L'onglet admin « Discussions » ne montre que ses propres conversations. ➜ Aujourd'hui, un lead chaud peut mourir sans que personne ne le sache.

**À construire, 3 étages :**

1. **Alerte immédiate à `ADMIN_INBOX` sur le 1ᵉʳ message de chaque nouvelle conversation élève/parent → prof** (dans `onMessageCreated`, nouvelle branche ; ne pas toucher à la branche admin existante).
   Contenu : **qui** (prénom, rôle, ville si connue, **source** `acquisition.campaign/source`, ex. « via /methode »), **à quel prof**, matière si détectée, **extrait** du message (120 caractères), lien vers le profil du prof et vers l'élève dans l'admin.
   Les messages suivants de la même conversation : **pas** d'e-mail un par un (sinon la boîte devient illisible), ils passent dans le récap (étage 3).
   Objet : `🔥 Nouveau lead : {prénom} → {prof} ({matière}) — via {source}`.
2. **Alerte « sans réponse »** : si le prof n'a pas répondu **4 h** après le 1ᵉʳ message (entre 8 h et 21 h, heure de Paris), e-mail à Joseph : `⏰ {prénom} attend {prof} depuis 4 h`, avec le téléphone du prof s'il est en base. C'est le signal pour relancer le prof lui-même. Une seule alerte par conversation.
   Technique : Cloud Function planifiée (`onSchedule` toutes les heures) ou cron Vercel déclaré dans `vercel.json` comme `partner-payouts-cron` — prendre ce qui existe déjà dans le repo. Champ `admin_alerte_sans_reponse_at` sur la conversation pour ne pas réalerter.
3. **Le relevé chiffré, en lecture seule : `scripts/diag-messages.mjs --jours=7`** (même famille que `diag-acquisition` / `diag-retours`, aucun écriture en base) :
   - **par conversation** : élève/parent → prof · date du 1ᵉʳ message · nb de messages de chaque côté · **délai de 1ʳᵉ réponse du prof** · statut `sans réponse` / `répondu` / `réservé` (un `lesson` ou un paiement existe entre les deux) · source d'acquisition de l'élève ;
   - **totaux** : conversations ouvertes · messages envoyés · % de conversations répondues · délai médian de réponse · **conversations → réservations** ;
   - **par prof** : conversations reçues, taux de réponse, délai médian (c'est ce qui dit quel prof mettre en avant, et lequel relancer).
   - Exclure les comptes de test et l'admin (cf. règle « compter la base hors comptes de test »).
   - Ajouté au **relevé du dimanche**, à côté de `diag-acquisition`.

⚠️ **Confidentialité** : l'alerte contient un extrait du message. Vérifier que les CGU / la politique de confidentialité disent que l'équipe peut consulter les échanges pour la qualité du service et la sécurité des mineurs ; sinon ajouter la phrase (`CGU.jsx`, `Privacy.jsx`). Le relevé `diag-messages` n'affiche **aucun** contenu, seulement des comptes et des délais.

**Test** : un compte élève de test écrit à un prof de test → e-mail « 🔥 Nouveau lead » reçu ; sans réponse pendant la fenêtre (abaisser le seuil à 1 min en local) → e-mail « ⏰ » reçu une seule fois ; `diag-messages` affiche la conversation en `sans réponse`, puis `répondu` après une réponse. Supprimer les comptes de test.

### 2.5 Mesure (sinon on ne saura jamais si les vidéos rapportent)
- Les visiteurs des Shorts arrivent **sans UTM** (lien tapé). `users/{uid}.acquisition.landing` enregistre déjà la page d'arrivée → vérifier que `/methode` y apparaît bien. Ajouter dans `frontend/lib/acquisition.js` : si `landing` commence par `/methode` et qu'aucune source n'est connue, `source='video'`, `campaign='methode'` (règle pure dans `api/_acquisition.mjs`, + un test).
- Ajouter une ligne « via /methode » dans `scripts/diag-acquisition.mjs` (relevé du dimanche), et la colonne source dans `diag-messages` (2.4 bis).
- Événements : `pixelTrack('Lead', { content_name: 'guide_methode' })` au téléchargement du PDF ; `CompleteRegistration` existe déjà.

### 2.6 Ce qu'on ne fait PAS
- Pas d'envoi du PDF par mail ni de séquence d'e-mails (plus tard si la page convertit).
- Pas de formulaire « e-mail seulement » : l'inscription express **est** le formulaire, et c'est elle qui compte dans le KPI.

---

## 3. Contrôles avant de livrer
1. `npm run build` + `npm test` (la fumée monte `Methode.jsx`).
2. `npm run dev` → `/methode` en largeur 360 px : CTA visible au premier écran, barre collante qui ne cache pas le bouton PDF.
3. Parcours complet en navigation privée : `/methode` → PDF → inscription Google → retour → téléchargement → `/search?subject=Maths`. **Et le parcours message** : `/methode` → « Écrire à un prof » → inscription express → chat ouvert avec le message pré-rempli → envoi → e-mail reçu par le prof ET par l’admin. Idem depuis la fiche d’un prof **sans créneau**.
4. Vérifier en base que le compte de test porte `acquisition.landing = /methode` et `campaign = methode`, puis **le supprimer** (cf. « compter la base hors comptes de test »).
5. `node scripts/diag-offre-profs.mjs` : au moins une matière du sélecteur a un prof réservable.

## 4. Après la mise en ligne (côté Joseph, 5 min)
- Commentaire épinglé sous chaque vidéo : « 📘 Le guide gratuit : tape **edukaraib.com/methode** ».
- Réponse type à chaque « MÉTHODE » : « Merci ! Le guide est sur **edukaraib.com/methode** 📘 (tu tapes l'adresse, YouTube ne laisse pas cliquer les liens sous les Shorts) ».
- Lien `edukaraib.com/methode?utm_source=youtube&utm_medium=chaine` dans les liens de la chaîne YouTube, et `?utm_source=instagram&utm_medium=bio` en bio Instagram.
- Brief agence suivant : la fin des vidéos affiche **edukaraib.com/methode** (une seule contrainte, elle remplace `edukaraib.com`).
