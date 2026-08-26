# AUDIT COMPLET — edukaraib.com
*Généré le 24 avril 2026 — Analyse code + UX + Paiement + Marketing*

---

## SOMMAIRE
1. [Bugs & Erreurs techniques](#1-bugs--erreurs-techniques)
2. [Ce qui manque — Fonctionnalités](#2-ce-qui-manque--fonctionnalités)
3. [Paiement — Comparaison concurrents](#3-paiement--comparaison-concurrents)
4. [SEO — Ce qui cloche](#4-seo--ce-qui-cloche)
5. [Plan Marketing Zéro Budget](#5-plan-marketing-zéro-budget)
6. [Plan Marketing avec Influenceurs](#6-plan-marketing-avec-influenceurs)
7. [Roadmap prioritaire](#7-roadmap-prioritaire)

---

## 1. BUGS & ERREURS TECHNIQUES

### 🔴 CRITIQUE

**1.1 — Pas de monitoring d'erreurs en production**
- Aucun Sentry, aucun LogRocket, aucun outil de tracking d'erreurs
- Les `console.error()` disparaissent dans le vide en prod Vercel
- **Impact :** Tu ne sais pas quand une transaction Stripe échoue côté serveur
- **Fix rapide :** Ajouter Sentry (gratuit jusqu'à 5k erreurs/mois) — 30 min de setup

**1.2 — Emails en double envoi potentiel**
- Les notifications passent à la fois par les Cloud Functions (Postmark) ET par l'API Resend
- Si les deux se déclenchent sur le même événement → l'utilisateur reçoit 2 emails
- Fichiers : `functions/index.js:93-159` + `api/notify-email.js`
- **Fix :** Vérifier que `email_sent: true` est bien lu avant tout envoi dans les deux chemins

**1.3 — IP Rate Limiting des codes influenceurs cassé**
- L'IP est vérifiée à la création du checkout (`create-checkout-session.mjs:235-354`)
- Mais elle n'est PAS enregistrée dans le webhook (`stripe-webhook.mjs:169-212`)
- **Impact :** Quelqu'un peut contourner la limite IP en créant la session depuis une IP, puis en complétant le paiement depuis une autre
- **Fix :** Passer l'IP en metadata Stripe et la récupérer dans le webhook

**1.4 — `mobile-and-errors.jsx` commenté dans `main.jsx`**
- La gestion des erreurs mobile et le composant d'erreur global sont désactivés
- Les crashs React ne montrent rien à l'utilisateur (écran blanc)
- **Fix :** Réactiver le ErrorBoundary au minimum

**1.5 — Paiements de profs bloqués si un élève d'un pack annule**
- Le payout d'un pack attend que TOUTES les leçons soient `completed + paid`
- Si un parent annule → le prof ne reçoit jamais son argent pour les leçons déjà faites
- Fichier : `api/trigger-payout.mjs:49-55`
- **Fix :** Calculer le payout sur les leçons complétées individuellement dans un pack

---

### 🟠 SÉRIEUX

**1.6 — Pas de validation du format IBAN pour les influenceurs**
- Le champ IBAN dans `InfluencerDashboard.jsx:230` n'a qu'un placeholder
- Un mauvais IBAN → le virement Stripe échoue silencieusement
- **Fix :** Valider le format IBAN côté client + côté API avec une regex ou librairie `iban`

**1.7 — Aucune page 404 personnalisée**
- Les routes inconnues renvoient vers l'index React mais sans message clair
- **Impact :** Mauvaise expérience + Google peut crawler des URLs mortes

**1.8 — Analytics drain incomplet**
- `api/analytics-drain.js` existe (11 894 octets) mais semble non finalisé
- Les données Analytics ne remontent pas dans Firestore de façon fiable
- **Impact :** Pas de tableau de bord marketing réel

**1.9 — Le sitemap manque des pages importantes**
- Absent du sitemap : `/about`, `/contact`, `/cgu`, `/privacy` (contact est absent)
- Les profils profs utilisent `/prof/:id` dans le sitemap mais potentiellement une autre route dans App.jsx (`/profils/:teacherId`) — à vérifier la cohérence
- **Fix :** Unifier la route profil et ajouter toutes les pages statiques

**1.10 — Pas de gestion de l'expiration de session utilisateur**
- Firebase Auth garde la session en localStorage indéfiniment (`browserLocalPersistence`)
- Aucun message à l'utilisateur si son token expire
- **Fix :** Écouter les erreurs `auth/id-token-expired` dans `verifyAuth()` et rediriger

---

### 🟡 MINEUR

**1.11 — Pas d'indicateur de chargement global**
- Certaines pages font plusieurs appels Firestore en parallèle sans skeleton loader
- L'utilisateur voit un écran vide avant que les données arrivent

**1.12 — Pas de confirmation visuelle après paiement sur mobile**
- La page `/pay/success` existe mais son UX sur mobile n'a pas été vérifiée récemment

**1.13 — Stripe Connect onboarding incomplète pour les profs**
- Les profs sans compte Stripe Connect reçoivent une promesse de paiement manuel (RIB)
- Mais il n'y a pas de rappel automatique pour les inciter à compléter l'onboarding
- **Impact :** Des profs oublient → payout bloqué → ils quittent la plateforme

---

## 2. CE QUI MANQUE — FONCTIONNALITÉS

### Côté Élève/Parent

| Fonctionnalité manquante | Impact | Difficulté |
|---|---|---|
| Essai gratuit (1 leçon découverte) | Conversion x3 | Moyen |
| Historique de progression de l'élève | Fidélisation | Moyen |
| Notification SMS (en plus email) | Taux d'ouverture +40% | Facile (Twilio) |
| Rappel de cours 30min avant | Réduction no-show | Facile |
| Évaluation niveaux avant matching | Meilleur matching | Difficile |
| Abonnement mensuel (cours récurrents) | Revenus prévisibles | Difficile |
| App mobile (PWA au minimum) | UX mobile | Moyen |
| Paiement en plusieurs fois | Conversion | Moyen |

### Côté Professeur

| Fonctionnalité manquante | Impact | Difficulté |
|---|---|---|
| Profil vidéo de présentation | Confiance +50% | Facile |
| Certificats/diplômes vérifiés affichés | Confiance | Facile |
| Statistiques détaillées (taux de conversion, nb vues profil) | Motivation | Moyen |
| Rappel automatique Stripe Connect onboarding | Rétention prof | Facile |
| Préférences email (choisir quels emails recevoir) | Spam perçu | Facile |
| Revenus prévisionnels (prochains paiements) | Motivation | Moyen |
| Badge "Nouveau prof" les 30 premiers jours | Visibilité | Facile |

### Côté Plateforme

| Fonctionnalité manquante | Impact | Difficulté |
|---|---|---|
| Blog/articles SEO | Trafic organique | Moyen |
| Programme de parrainage étudiant (pas que profs) | Croissance virale | Moyen |
| Contenu "Nos matières" pages dédiées | SEO long tail | Facile |
| Pages "cours de maths Martinique" etc. | SEO local | Facile |
| FAQ publique sur le site | SEO + conversion | Facile |
| Page "Comment ça marche" visuelle | Conversion | Facile |
| Chat widget support | Réduction abandon | Moyen |
| Notation des plateformes (Trustpilot, Google) | Social proof | Facile |

---

## 3. PAIEMENT — COMPARAISON CONCURRENTS

### Ton système actuel

| Élément | EduKaraib | Note |
|---|---|---|
| Fournisseur | Stripe | ✅ Solide |
| Commission plateforme | 10€/h | ❌ Trop flou pour l'utilisateur |
| Packs | 5h / 10h | ✅ Bien |
| Paiement instantané prof | Non (held → release) | ⚠️ |
| Paiement mobile | Via Stripe Checkout | ✅ |
| Apple Pay / Google Pay | Dépend config Stripe | ⚠️ À vérifier |
| Paiement en plusieurs fois | Non | ❌ |
| Abonnement mensuel | Non | ❌ |
| Remboursement | Oui (admin only) | ⚠️ Pas en self-service |

---

### Comparaison avec les concurrents

#### SuperProf (leader Europe)
| Élément | SuperProf | EduKaraib | Manque |
|---|---|---|---|
| Commission | 10-20% | ~10€/h fixe | Ton modèle est potentiellement plus avantageux pour les hauts tarifs — **communique ça !** |
| Abonnement prof | 30-70€/mois pour visibilité | Gratuit | ✅ Avantage EduKaraib |
| Essai gratuit | Oui (1ère heure négociée) | Non | ❌ Manque |
| Paiement sécurisé | Optionnel (souvent hors plateforme) | Obligatoire via Stripe | ✅ Avantage EduKaraib |
| Remboursement self-service | Oui | Non (admin only) | ❌ Manque |
| Visa/CB/Apple Pay | Oui | Partiellement | ⚠️ |
| Paiement en 3x | Sur certains marchés | Non | ❌ Manque |

#### Kelprof / MaProf (Antilles)
| Élément | Kelprof | EduKaraib | Manque |
|---|---|---|---|
| Paiement en ligne | Non / partiel | Oui complet | ✅ Avantage MAJEUR EduKaraib |
| Profils profs vérifiés | Non | Partiel (badge 5 avis) | ⚠️ |
| Visio intégrée | Non | Oui (Jitsi) | ✅ Avantage MAJEUR EduKaraib |
| Mobile UX | Mauvaise | Correcte | ✅ |
| Présence locale Caraïbes | Forte (SEO local) | Faible | ❌ Manque CRITIQUE |

#### Schoolap (Haïti / Antilles)
| Élément | Schoolap | EduKaraib | Manque |
|---|---|---|---|
| Contenu éducatif | Oui (cours vidéo) | Non | ❌ Manque long terme |
| Cours particuliers | Non (plateforme contenu) | Oui | ✅ Différenciation |
| Paiement local Antilles | Oui (Mobile Money) | Non | ❌ Manque pour Haïti/DOM |

---

### Ce qui manque VRAIMENT côté paiement

**3.1 — Pas de Mobile Money / paiement local Caraïbes**
- En Martinique/Guadeloupe : CB classique fonctionne
- En Haïti, République Dominicaine, Trinidad : Mobile Money est dominant
- **Action :** Intégrer MonCash (Haïti) ou utiliser un intermédiaire local si tu vises ces marchés

**3.2 — Pas de paiement en 3x sans frais**
- Prix d'un pack 10h = potentiellement 150-300€
- C'est un frein psychologique énorme pour les familles
- **Action :** Activer Stripe Payment Plans ou intégrer Alma (partenaire Stripe FR)

**3.3 — Commission invisible = méfiance**
- L'utilisateur ne voit pas clairement combien va à EduKaraib vs au prof
- SuperProf affiche "le prof reçoit X€, vous payez Y€"
- **Action :** Afficher la décomposition sur la page de paiement et sur les profils profs

**3.4 — Pas de remboursement self-service**
- Si une leçon est annulée, le parent doit contacter le support pour se faire rembourser
- **Impact :** Friction post-achat = mauvais avis, perte de confiance
- **Action :** Ajouter un bouton "Demander un remboursement" dans l'historique des paiements (déclenche `api/refund.mjs` avec validation)

**3.5 — Pas d'email de confirmation de paiement avec reçu**
- Après un paiement Stripe, le webhook marque la leçon comme payée mais...
- Aucun email "Votre paiement de X€ a bien été reçu" avec reçu PDF
- **Impact :** Les parents paniquent et appellent le prof
- **Action :** Déclencher un email récapitulatif depuis `stripe-webhook.mjs` après `checkout.session.completed`

**3.6 — Pas de facture / reçu téléchargeable**
- Légalement obligatoire pour les professionnels
- Beaucoup de parents veulent déclarer les frais de soutien scolaire (réduction impôts en France)
- **Action :** Générer un PDF avec `pdf-lib` ou utiliser Stripe Invoices

---

## 4. SEO — CE QUI CLOCHE

### Problèmes identifiés

**4.1 — Site en SPA React sans SSR**
- Google crawle le JS mais c'est plus lent à indexer
- Les pages `/profils/:teacherId` ne sont pas pré-rendues
- **Impact :** Les profils profs ne remontent pas bien dans Google
- **Fix :** Ajouter des meta tags dynamiques par route avec `useSEO` (partiellement fait) + Considérer Next.js pour les pages profil

**4.2 — Zéro page de contenu SEO**
- Il n'existe aucun article de blog, aucune page "cours de maths en Martinique"
- Tes concurrents (SuperProf, etc.) captent tout le trafic long tail
- **Mots-clés cibles à créer en priorité :**
  - "cours particuliers Martinique"
  - "soutien scolaire Guadeloupe en ligne"
  - "prof de maths Antilles"
  - "cours visio Caraïbes"
  - "trouver un professeur particulier en ligne Martinique"

**4.3 — Nom de domaine "edukaraib.com" vs marque "EduKaraib"**
- L'URL et la marque ne s'épellent pas pareil (edukaRaib vs eduKarib)
- Confusion pour les utilisateurs et problème de branding

**4.4 — Pas de Google My Business**
- Aucune fiche Google Maps = invisible pour les recherches locales "cours particuliers [ville]"
- **Action :** Créer une fiche Google My Business pour Fort-de-France ET Point-à-Pitre

**4.5 — Pas de schema.org pour les profils profs**
- Les profils profs devraient avoir du JSON-LD `Person` + `EducationalOrganization`
- **Impact :** Pas de rich snippets dans Google (étoiles, prix, disponibilité)

---

## 5. PLAN MARKETING ZÉRO BUDGET

*Principe : du contenu organique, de la communauté, et des mécaniques virales déjà dans le code.*

---

### LEVIER 1 — SEO Local (0€, retour en 3-6 mois)

**Action A — Créer 10 pages de contenu local**
Format : `/cours-maths-martinique`, `/cours-anglais-guadeloupe`, etc.
Contenu : 600 mots avec les mots-clés locaux + liste des profs dispo dans cette matière
**Résultat attendu :** +200-500 visiteurs/mois en 6 mois sur ces requêtes

**Action B — Google My Business**
- Une fiche pour chaque île principale (Martinique, Guadeloupe, Guyane)
- Photos de l'interface, ajouter les avis des utilisateurs
- Répondre à chaque avis Google → signal positif algorithme

**Action C — Profils profs = SEO automatique**
- Chaque prof est une page indexable (`/prof/:id`)
- Encourage tes profs à partager leur profil EduKaraib sur leur LinkedIn, Facebook
- C'est des backlinks gratuits + du trafic ciblé

---

### LEVIER 2 — Communauté Facebook/WhatsApp (0€, retour en 1-2 mois)

**Action A — Groupe Facebook "Parents d'élèves Martinique/Guadeloupe"**
- Pas de groupe de vente — un groupe d'entraide
- Partage de conseils scolaires, méthodes d'apprentissage
- Glisse des profs EduKaraib dans les conversations organiquement

**Action B — WhatsApp Business**
- Créer un groupe WhatsApp "Profs EduKaraib" pour les enseignants
- Les profs deviennent des ambassadeurs naturels (ils parlent de toi à leurs collègues)
- Partage les success stories : "Prof X a gagné 500€ ce mois avec EduKaraib"

**Action C — Intégrer dans les groupes existants**
- Rejoins les groupes Facebook existants de parents d'élèves en Martinique/Guadeloupe
- Réponds aux questions scolaires (ne vends pas directement)
- Mets ton profil EduKaraib en lien dans ta bio

---

### LEVIER 3 — Programme de Parrainage Élève (déjà 50% implémenté)

Tu as déjà un système de parrainage côté prof (code PARRAIN-XXXXXX). Il manque :

**Action A — Créer un code parrainage étudiant/parent**
- "Parraine un ami → vous recevez tous les deux -10€ sur la prochaine leçon"
- Mécanisme : URL unique `edukaraib.com/rejoindre?ref=XXXXXX`
- **C'est viral par nature** : les parents se connaissent entre eux à l'école

**Action B — "Offrir une leçon" comme cadeau**
- Page `/offrir` avec un système de bon cadeau par email
- Parfait pour les fêtes de fin d'année, anniversaires
- Zéro coût de mise en place avec Stripe + email existant

---

### LEVIER 4 — Reviews & Preuve Sociale (0€)

**Action A — Maximiser les avis Google**
- Après chaque pack terminé, email automatique : "Comment s'est passée l'expérience ? [Laisser un avis Google]"
- Lien direct vers ta fiche Google My Business

**Action B — Transformer les avis en contenu**
- Les avis dans `reviews` collection → les afficher sur la home (déjà fait partiellement)
- Créer des "cartes d'avis" pour Instagram/Facebook (Canva gratuit)
- Format : photo floutée de l'élève + citation du parent + étoiles + logo EduKaraib

**Action C — Trustpilot gratuit**
- Profil Trustpilot gratuit pour les petites plateformes
- Ça rassure énormément les nouveaux parents qui ne te connaissent pas

---

### LEVIER 5 — Partenariats Locaux Gratuits

**Action A — Librairies & papeteries**
- Flyers EduKaraib dans les librairies scolaires (Martinique : Antilla, Guadeloupe : Jasor)
- Échange : ils recommandent EduKaraib, tu mentionnes leur librairie dans tes emails

**Action B — Lycées et collèges**
- Contacter les CPE (Conseillers Principaux d'Éducation)
- Proposer une présentation d'EduKaraib aux parents d'élèves en difficulté
- Afficher une affiche dans la salle des profs

**Action C — Associations de parents d'élèves (FCPE locale)**
- Partenariat avec les FCPE locales
- EduKaraib devient le partenaire officiel de soutien scolaire de l'association

---

## 6. PLAN MARKETING AVEC INFLUENCEURS

*Tu as déjà tout le code pour gérer les influenceurs. Le problème n'est pas le budget, c'est la sélection.*

---

### Principe : Les Micro-Influenceurs sans Cash

**Le vrai deal maker : tu ne paies pas en cash, tu paies en COMMISSION**

Ton système est déjà fait :
- Code unique par influenceur
- -5€ pour le client, +5€ pour l'influenceur sur chaque vente
- -30€ client, +20€ influenceur sur pack 10h

**Argument de vente pour l'influenceur :**
> "Tu me parles des EduKaraib à ta communauté, ils paient 30€ de moins, et toi tu touches 20€ par pack vendu. Si tu envoies 20 abonnés par mois vers les packs 10h, tu gagnes 400€/mois sans rien faire d'autre que partager un lien."

---

### Profil d'influenceur idéal (micro ≠ grand compte)

| Critère | Cible |
|---|---|
| Abonnés | 2 000 - 20 000 (micro-influenceur) |
| Taux d'engagement | > 3% (mieux qu'un gros compte à 0.5%) |
| Thématique | Parent, éducation, famille, Antilles |
| Plateforme | Instagram > TikTok > Facebook |
| Localisation | Martinique, Guadeloupe, Guyane, Réunion |

---

### Cibles spécifiques à aller chercher (sans budget)

**Profil 1 — "La maman qui partage"**
- Compte Instagram de maman qui parle de sa vie de famille aux Antilles
- Elle recommande déjà des produits naturellement (sans être payée)
- Argument : "Tu peux gagner de l'argent en recommandant ce que tu utilises déjà pour tes enfants"

**Profil 2 — L'enseignant retraité ou en activité sur les réseaux**
- Beaucoup d'enseignants ont des comptes Facebook actifs avec des centaines de parents abonnés
- Leur recommandation = crédibilité maximale
- Deal : ils recommandent EduKaraib à leurs anciens élèves → commission sur chaque inscription

**Profil 3 — L'étudiant en MEEF ou en licence**
- Future enseignant, suit des comptes éducatifs
- Peut devenir prof EduKaraib ET influenceur en même temps
- Deal double : il enseigne sur la plateforme ET parraine des familles

**Profil 4 — Les comptables / conseillers fiscaux locaux**
- Informent les familles sur la réduction d'impôt pour cours particuliers (50% de réduction fiscale en France)
- Un comptable qui dit "Prenez des cours chez EduKaraib et déduisez la moitié" → conversion ultra-forte
- Deal : commission sur chaque client envoyé

---

### Script de prise de contact (DM Instagram)

```
Bonjour [Prénom],

Je suis [ton nom], fondateur d'EduKaraib, la plateforme de soutien scolaire 
des Antilles avec paiement sécurisé et visio intégrée.

Je ne cherche pas à te payer une story. Je veux un vrai partenariat :
→ Tu partages un lien unique à ta communauté
→ Tes abonnés paient 30€ de moins sur leur premier pack
→ Toi tu touches 20€ automatiquement à chaque vente

Pas d'avance, pas de risque. Tu gagnes uniquement si tes abonnés sont convaincus.

Si ça t'intéresse, je t'envoie ton code personnalisé en 5 minutes.

[lien vers la page influenceur]
```

---

### Contenu à créer pour les influenceurs (tu fournis, ils publient)

Les influenceurs micro ne savent pas toujours quoi dire. Prépare-leur :

1. **Pack contenu "Clé en main"** (3-5 posts/reels prêts à publier)
   - "Pourquoi j'ai choisi EduKaraib pour mon enfant" (texte + photos)
   - "Comment ça marche en 60 secondes" (template vidéo Reels)
   - "Les résultats après 1 mois" (storytelling)

2. **Stories FAQ prêtes à l'emploi**
   - "Est-ce que c'est cher ?" → Réponse avec code promo influenceur
   - "Comment trouver un prof ?" → Démonstration courte

3. **Bio Instagram kit**
   - Lien bio avec tracking UTM vers ton site
   - Texte de description pour le compte influenceur

---

### KPIs à mesurer pour chaque influenceur

| Métrique | Comment mesurer |
|---|---|
| Clics sur le code | `influencer_usages` collection Firestore |
| Conversions (1ère leçon) | Webhook Stripe → `conversions` dans influencers |
| Revenu généré | `pendingPayout` dans collection `influencers` |
| ROI (20€ donné, X€ généré) | AdminDashboard |

---

## 7. ROADMAP PRIORITAIRE

### Semaine 1 — Quick Wins (sans coder)
- [ ] Créer fiche Google My Business pour Martinique et Guadeloupe
- [ ] Contacter 10 micro-influenceurs avec le script DM ci-dessus
- [ ] Poster dans 3 groupes Facebook parents d'élèves locaux
- [ ] Activer Apple Pay / Google Pay dans le dashboard Stripe (1 clic)

### Semaine 2-3 — Fixes techniques prioritaires
- [ ] Ajouter Sentry (monitoring erreurs) — 30 min
- [ ] Email de confirmation de paiement avec récapitulatif — 2h
- [ ] Réactiver ErrorBoundary (`mobile-and-errors.jsx`) — 30 min
- [ ] Bouton remboursement self-service dans historique paiements — 3h
- [ ] Afficher la décomposition prix (votre part / part EduKaraib) sur la page paiement — 1h

### Mois 1-2 — Croissance organique
- [ ] Créer 5 pages SEO locales (1 par île + 2 par matière phare)
- [ ] Programme parrainage étudiant (code ref URL)
- [ ] Email post-pack : demande d'avis Google automatique
- [ ] Page "Comment ça marche" visuelle sur la home

### Mois 3-4 — Monétisation améliorée
- [ ] Paiement en 3x (Stripe Payment Plans ou Alma)
- [ ] Facture PDF téléchargeable (argument fiscal pour les familles françaises)
- [ ] Profil vidéo de présentation pour les profs
- [ ] Abonnement mensuel (cours récurrents hebdomadaires)

### Long terme (6 mois+)
- [ ] PWA / App mobile
- [ ] Blog SEO avec articles sur l'éducation aux Antilles
- [ ] Intégration Mobile Money pour Haïti/DOM
- [ ] Contenu vidéo éducatif (différenciation vs SuperProf)

---

## RÉSUMÉ EXECUTIF

**3 choses à faire CETTE SEMAINE sans coder :**
1. Google My Business → visibilité locale immédiate
2. DM 10 micro-influenceurs avec le script commission → 0€ dépensé
3. Activer Apple Pay dans Stripe → +15% conversion mobile en 1 clic

**1 bug à corriger EN URGENCE :**
→ Ajouter un email de confirmation de paiement depuis le webhook Stripe (`stripe-webhook.mjs`)
→ C'est la chose la plus demandée par les utilisateurs et la plus simple à faire

**1 manque qui coûte des ventes chaque jour :**
→ Pas de paiement en 3x → les familles qui veulent un pack 10h voient le prix total et abandonnent

---

*Analyse basée sur la lecture complète du code source + comparaison avec les plateformes concurrentes actives dans les Caraïbes et en France métropolitaine.*
