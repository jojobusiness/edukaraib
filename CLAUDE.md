# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Objectif business

**Maximiser le chiffre d'affaires d'EduKaraib.** Chaque décision technique doit servir cet objectif : conversion, rétention des profs, fidélisation des familles, ou acquisition. Avant d'implémenter quoi que ce soit, demande-toi quel impact ça a sur le GMV (Gross Merchandise Value). Le fichier `../AUDIT_EDUKARAIB.md` contient l'audit complet avec la roadmap priorisée.

---

## Commandes de développement

```bash
# Frontend (React + Vite) — dev local sur http://localhost:5173
npm run dev

# Build de production (génère dist/ à la racine)
npm run build

# Firebase Functions — linter avant deploy
npm --prefix functions run lint

# Deploy Functions
firebase deploy --only functions

# Générer les codes parrain profs (one-shot, ne relancer qu'une seule fois)
node generate-referral-codes.mjs

# Cron de release des payouts (à lancer manuellement ou via Vercel Cron)
node release-payouts-cron.mjs
```

Pas de suite de tests dans ce projet. La validation se fait par test manuel sur le site.

---

## Architecture

### Vue d'ensemble

Monorepo mixte : frontend SPA + API serverless Vercel + Firebase Cloud Functions.

```
/                       ← racine Vite (index.html ici)
├── frontend/           ← React 18 + React Router 6 + Tailwind
│   ├── pages/          ← une page = une route (40+ pages)
│   ├── components/     ← composants réutilisables
│   ├── contexts/       ← AuthContext (état user global)
│   ├── hooks/          ← useSEO (meta tags dynamiques)
│   ├── lib/            ← firebase.js (client), paymentNotifications.js
│   └── routes/         ← RequireRole (garde multi-rôles)
├── api/                ← Vercel Serverless Functions (Node, ESM .mjs)
│   ├── _firebaseAdmin.mjs   ← singleton Admin SDK + verifyAuth()
│   ├── _stripe.mjs          ← singleton Stripe
│   ├── pay/                 ← create-checkout-session.mjs, session-status.mjs
│   ├── stripe-webhook.mjs   ← webhook Stripe (bodyParser désactivé)
│   ├── trigger-payout.mjs   ← virement prof via Stripe Connect
│   └── ...
├── functions/          ← Firebase Cloud Functions (CommonJS)
│   └── index.js        ← onNotificationCreated (email Postmark), onReviewCreatedGivePromo
├── dist/               ← build Vite (ignoré git)
└── vercel.json         ← routing : /api/* → serverless, reste → index.html
```

### Flux de paiement (critique)

1. **Frontend** `PayButton` → POST `/api/pay/create-checkout-session`
2. **`create-checkout-session.mjs`** : valide auth Firebase, résout les IDs élèves, applique le code influenceur/promo, crée la session Stripe Checkout
3. **Stripe** redirige vers `/pay/success` ou `/pay/cancel`
4. **`stripe-webhook.mjs`** reçoit `checkout.session.completed` → marque `is_paid` dans Firestore, crédite la commission influenceur, déclenche le bonus de parrainage
5. **Prof** déclenche manuellement `/api/trigger-payout` après la leçon complétée → Stripe Connect Transfer ou `payout_pending_rib` si pas de compte Connect

**Point de vigilance :** Le webhook doit avoir `bodyParser: false` (`export const config = { api: { bodyParser: false } }`) pour que la vérification de signature Stripe fonctionne.

### Gestion des identifiants élèves (complexe)

Un élève peut avoir deux IDs distincts dans Firestore (`students.uid` vs `students.user_id`). La fonction `resolveEquivalentStudentIds()` dans `create-checkout-session.mjs` fait les alias. Ne jamais comparer un `student_id` directement — utiliser toujours cette résolution.

### Système de rôles

5 rôles : `student`, `parent`, `teacher`, `admin`, `influencer`.
- Les gardes de routes sont dans `frontend/components/[Role]Route.jsx` et `frontend/routes/RequireRole.jsx`
- Les APIs vérifient le rôle via `verifyAuth()` → token Firebase → lookup `users/{uid}.role` dans Firestore

### Notifications & Emails (double pipeline — attention aux doublons)

- **Postmark** : Cloud Function `onNotificationCreated` (Firestore trigger) → email automatique à chaque document créé dans `notifications/`
- **Resend** : API `/api/notify-email.js` pour les envois manuels/ponctuels
- Le flag `email_sent: true` sur le document notification empêche le re-envoi. Si tu ajoutes un nouvel envoi d'email, vérifier que les deux pipelines ne se déclenchent pas sur le même événement.

### Système influenceurs

- Collection `influencers` : code unique, IBAN, `pendingPayout`, `conversions`
- Limite : 2 utilisations max par payeur (`influencer_usages`), 1 par IP (vérifiée au checkout seulement — voir bug connu)
- Remise client : -5€ (leçon solo), -10€ (pack 5h), -30€ (pack 10h)
- Commission influenceur : +5€, +10€, +20€ respectivement
- Payout via `trigger-influencer-payout.mjs` (admin uniquement, virement SEPA Stripe)

---

## Variables d'environnement requises (Vercel)

| Variable | Source |
|---|---|
| `FIREBASE_PROJECT_ID` | Firebase Console |
| `FIREBASE_CLIENT_EMAIL` | Compte de service Firebase |
| `FIREBASE_PRIVATE_KEY` | Compte de service Firebase (les `\n` sont transformés automatiquement) |
| `FIREBASE_STORAGE_BUCKET` | Firebase Console |
| `STRIPE_SECRET_KEY` | Stripe Dashboard |
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhooks |
| `RESEND_API_KEY` | Resend |
| `APP_BASE_URL` | `https://edukaraib.com` |
| `INTERNAL_API_SECRET` | Secret arbitraire pour protéger `/api/notify-email` |
| `CRON_SECRET` | Secret pour `/api/release-payouts` |
| `ADMIN_COUPON_SECRET` | Secret pour `/api/create-manual-coupon` |

Firebase Functions : configurer via `firebase functions:config:set postmark.key=XX mail.from=XX`

---

## Conventions de code

- Toutes les API routes sont en **ESM** (`.mjs`) sauf `functions/` qui est CommonJS (`.js`)
- Les API routes exportent `export default async function handler(req, res)`
- `verifyAuth(req, res)` retourne le décodé du token ou `null` (et envoie le 401 lui-même si null)
- Les pages React utilisent `useSEO({ title, description, url })` pour les meta tags
- Tailwind uniquement pour le styling — pas de CSS modules ni styled-components
- `sonner` pour les toasts (pas `react-hot-toast` ni `react-toastify`)
- `lucide-react` pour toutes les icônes

---

## Bugs connus (ne pas reintroduire)

1. **IP rate limiting influenceur** ✅ CORRIGÉ — IP extraite avant le bloc coupon dans `create-checkout-session.mjs` et passée en `metadata.client_ip`; lue dans `stripe-webhook.mjs` via `md.client_ip`.
2. **Pack payout bloqué** ✅ CORRIGÉ — `trigger-payout.mjs` utilise désormais un calcul prorata (`completedCount / totalCount`) + remboursement Stripe automatique pour les leçons non faites.
3. **Double email** ✅ CORRIGÉ — toutes les créations de notifications Firestore depuis le front passent `email_disabled: true` pour bloquer l'envoi Postmark quand Resend envoie déjà.
4. **ErrorBoundary désactivé** ✅ CORRIGÉ — `AppGuards` activé dans `main.jsx` (importe `mobile-and-errors.jsx`).
5. **Toast pour toutes les erreurs** ✅ CORRIGÉ — `mobile-and-errors.jsx` filtre les toasts aux requêtes `/api/` uniquement ; ignore Firebase, Stripe, AbortError, ResizeObserver.
6. **`node_modules/` tracké dans git** ✅ CORRIGÉ — `git rm -r --cached node_modules/` + `.gitignore` mis à jour. Ne jamais committer `node_modules/` — Vercel utilise les fichiers git et ignore `npm install` si les modules sont présents.
7. **`bodyParser: false` requis pour les endpoints stream** — `stripe-webhook.mjs` ET `analytics-drain.js` doivent tous deux avoir `export const config = { api: { bodyParser: false } }`. Sans ça, Vercel consomme le stream avant que `readRawBody` puisse le lire → body vide, signature invalide.
8. **Vercel Log Drain — ne pas utiliser le domaine custom** — `edukaraib.com` redirige vers `www.edukaraib.com` (307), ce qui casse le drain. Utiliser `https://edukaraib.vercel.app/api/analytics-drain` comme URL du drain.
9. **`tab` non défini dans les sous-composants de AdminDashboard** — `tab` est un état local de `AdminDashboard`. Les sous-composants (`StatsTab`, `SiteVisitsSection`, etc.) n'y ont pas accès. Toujours placer les conditions `{tab === 'xxx' && ...}` dans le JSX retourné par `AdminDashboard` directement, jamais dans un sous-composant.
10. **IBAN mal formé** — `trigger-influencer-payout.mjs` valide maintenant l'IBAN via mod97 avant tout virement. Ne jamais supprimer cette validation.

---

## Priorités CA (référence AUDIT_EDUKARAIB.md)

Les features à plus fort impact sur le chiffre d'affaires, dans l'ordre :

1. **Email de confirmation de paiement** — déclencher depuis `stripe-webhook.mjs` après `checkout.session.completed`
2. **Paiement en 3x** — activer Stripe Payment Installments ou intégrer Alma
3. **Remboursement self-service** — bouton dans `ParentPayments.jsx` / `StudentPayments.jsx` appelant `api/refund.mjs`
4. **Facture PDF téléchargeable** — les familles françaises déduisent 50% des cours particuliers (crédit impôt)
5. **Pages SEO locales** — `/cours-maths-martinique`, `/cours-anglais-guadeloupe`, etc.
6. **Apple Pay / Google Pay** — activer dans le dashboard Stripe (0 code à écrire)
7. **Parrainage étudiant** — même mécanique que le code PARRAIN prof mais pour les familles
