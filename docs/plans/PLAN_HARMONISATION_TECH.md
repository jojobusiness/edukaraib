# Plan d'harmonisation technique — EduKaraib ↔ Factur'Peyi

**Date : 01/08/2026.** Document miroir de `Factur'Peyi/HARMONISATION_TECH.md`.
Ici : ce qu'EduKaraib récupère de Factur'Peyi, et ce qui reste à faire.

---

## 1. Constat

Les deux projets ont divergé. Factur'Peyi a construit une **discipline de qualité**
(lint strict, 206 tests, headers de sécurité) après avoir payé 24 h de page blanche en
production le 29/07/2026. EduKaraib a construit une **observabilité** (Sentry, Meta CAPI,
Amplitude) que Factur'Peyi n'a pas.

EduKaraib avait **zéro test et zéro lint** sur 48 pages et 35 endpoints qui manipulent des
paiements. C'était le risque le plus élevé des deux repos.

---

## 2. Appliqué le 01/08/2026

### 2.1 ESLint — `eslint.config.js` créé

Repris de Factur'Peyi, adapté à l'architecture EduKaraib :
- `api/**/*.{js,mjs}` + `*.mjs` racine → globales Node, ESM
- `functions/**/*.js` → globales Node, **CommonJS** (`require`/`module`)
- `frontend/**` → globales navigateur + React
- `frontend/test/**` → Node + navigateur

Règle capitale, **à ne jamais retirer** :

```js
'react/jsx-no-undef': 'error'
```

`no-undef` ne voit pas les noms d'éléments JSX. Un composant utilisé sans import passe
`vite build` **et** le lint standard, puis lève une `ReferenceError` au rendu : page blanche
en production. Seule cette règle l'attrape.

Calibrage assumé : `no-empty` avec `allowEmptyCatch` (146 `catch {}` volontaires dans le
code — en erreur, ils noyaient les vrais signaux) et `no-unused-vars` en `warn`. Le principe :
**seul ce qui casse la production bloque**, sinon le gate devient rouge en permanence et
plus personne ne le lit.

Résultat : `npm run lint` → **exit 0**. Aucune erreur `jsx-no-undef` ni `no-undef` existante
dans EduKaraib (contrairement à Factur'Peyi qui, lui, avait le bug).

### 2.2 Tests de rendu — 0 → 59 tests

- `frontend/test/setup.js` — doubles Firebase (Firestore/Auth/Storage), **Sentry**, `fetch`,
  et les API navigateur absentes de jsdom (`IntersectionObserver`, `ResizeObserver`,
  `matchMedia`, **`JitsiMeetExternalAPI`** pour la visio)
- `frontend/test/rendre.jsx` — enveloppe `MemoryRouter` + double de `useAuth`
  (le vrai `AuthContext` resterait bloqué sur `authReady: false`, tous les tests
  passeraient sur un écran de chargement — donc sans rien vérifier)
- `frontend/test/pages.test.jsx` — découverte automatique via `import.meta.glob`,
  sous-dossiers `pay/` et `seo/` compris. **Toute nouvelle page est couverte sans rien ajouter.**
- `vite.config.js` — bloc `test` (jsdom, pool `threads`, timeout 15 s)

Chaque page est montée **sans aucune donnée** : c'est le scénario le plus dur, celui qui
révèle les accès non protégés (`docs[0].data()` sur une liste vide, etc.).

**Validé par mutation :** un composant fantôme injecté dans `FAQ.jsx` → `vite build` **vert**
(le piège), lint **rouge**, tests **rouges**. Le filet fonctionne.

### 2.3 Headers de sécurité — `vercel.json`

EduKaraib n'en avait **aucun**. Ajoutés via la syntaxe historique `routes` + `continue: true`
(le repo utilise `routes`, incompatible avec la clé `headers` de haut niveau — le routage
existant est donc intact) :

```
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self "https://8x8.vc"), microphone=(self "https://8x8.vc"), geolocation=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

⚠️ **Deux écarts volontaires avec Factur'Peyi**, à ne pas « réharmoniser » par erreur :
- **`camera` / `microphone` autorisent explicitement `https://8x8.vc`** — `VisioRoom.jsx`
  monte la visio JaaS dans une iframe **cross-origin** vers `8x8.vc` (`JAAS_DOMAIN`).
  Copier le `camera=()` de Factur'Peyi aurait coupé la caméra et le micro dans **toutes les
  leçons en visio**, sans la moindre erreur JS visible — juste un flux qui ne démarre jamais.
  Le lien avec un header de sécurité aurait été introuvable en debug.

  Note sur le choix de la valeur : l'allowlist par défaut de `camera` étant déjà `self` et la
  visio fonctionnant aujourd'hui sans aucun header, un simple `camera=(self)` serait
  vraisemblablement suffisant. La forme retenue est correcte **dans les deux lectures** de la
  spec de délégation cross-origin, pour ne pas parier sur une interprétation quand
  l'enjeu est le cœur du produit payant.
  **À confirmer sur une preview Vercel avec une vraie leçon avant mise en production.**
- `SAMEORIGIN` et non `DENY` — laisse la porte ouverte à un futur embed partenaire
  (roadmap institution), avec la même protection contre le clickjacking tiers.

### 2.4 Deux bugs réels corrigés (trouvés par le lint)

1. **`frontend/pages/Home.jsx`** — la regex de nettoyage des libellés contenait `🏝️` dans une
   classe de caractères. L'emoji s'y **décompose** en 🏝 + U+FE0F, la classe matchait donc le
   sélecteur de variante seul. Réécrit en `\u{FE0F}` explicite (🌐 et 🏝 étaient déjà couverts
   par la plage `\u{1F30D}-\u{1F5FA}`) : comportement identique, piège supprimé.
2. **`frontend/components/NotifList.jsx`** — espace insécable invisible U+202F dans un commentaire.

### 2.5 Scripts npm

```bash
npm run lint        # ESLint sur tout le projet
npm test            # 59 pages montées, échoue si l'une plante
npm run test:watch  # idem, en continu
```

---

## 3. Reste à faire

### 3.1 🔴 Montée de version — chantier à part, **jamais en une passe**

| Paquet | EduKaraib | Factur'Peyi | Nature |
|---|---|---|---|
| react / react-dom | 18.2 | **19.1** | migration majeure |
| vite | 4.5 | **6.3** | 2 majeures d'écart |
| react-router-dom | 6.14 | **7.6** | migration majeure |
| firebase | 10.14 | **11.9** | majeure |
| firebase-admin | 12.7 | **13.10** | majeure |
| stripe | 14.25 | **18.3** | 4 majeures — **touche l'encaissement** |

Ordre recommandé, **une majeure à la fois, avec `npm test` entre chaque** :

1. `vite` 4 → 5 → 6 (le moins risqué, gain de build immédiat)
2. `react` 18 → 19 (vérifier `StrictMode` et les refs)
3. `react-router-dom` 6 → 7
4. `firebase` 10 → 11 puis `firebase-admin` 12 → 13
5. `stripe` 14 → 18 **en dernier, avec test réel en mode test** — c'est la seule dépendance
   dont une régression se paie en euros

Les 59 tests de rendu sont précisément le filet qui rend cette migration faisable.
**Ne pas commencer avant qu'ils soient dans le repo.**

### 3.2 🟠 Tests sur les parcours argent

Les 59 tests couvrent le **montage** des pages. Non couvert, par ordre de coût d'un bug :
`stripe-webhook.mjs`, `create-checkout-session.mjs` (règle coupon : le prof ne doit **jamais**
payer la remise), `trigger-payout.mjs` (prorata pack), `refund.mjs`.

Modèle à copier : `Factur'Peyi/facturpeyi/src/test/invoiceLines.test.js` — 65 tests sur la
source unique des totaux.

### 3.3 🟠 Source unique pour les montants

Factur'Peyi a `src/utils/invoiceLines.js` et `paiements.js` : **un seul module** calcule les
totaux, utilisé par l'éditeur, le PDF, le portail, Stripe et le XML. EduKaraib recalcule les
montants à plusieurs endroits (`create-checkout-session.mjs`, `trigger-payout.mjs`,
`refund.mjs`, front). Un second calcul finit toujours par diverger.

À faire : extraire un `lib-server/montants.mjs` unique + tests. C'est la même dette que
Factur'Peyi a déjà remboursée.

### 3.4 🟡 `lib-server/` partagé

Factur'Peyi isole le code serveur réutilisable dans `lib-server/`. EduKaraib utilise la
convention `api/_xxx.mjs`, qui marche — faible priorité, purement cosmétique.

---

## 4. Ce qu'EduKaraib **garde** et n'aligne pas

Ces éléments sont propres au métier EduKaraib et n'ont pas d'équivalent chez Factur'Peyi.
Ils ne sont pas de la dette : ne pas les « harmoniser ».

- 5 rôles (`student`, `parent`, `teacher`, `admin`, `influencer`) + `RequireRole`
- Stripe Connect en **reversement** aux profs (Factur'Peyi fait l'inverse : encaissement)
- Système influenceurs, parrainage élève `REF-XXXXXX`, coupons `AVIS-`/`FILLEUL-`
- **Règle absolue** : un coupon ne réduit **jamais** `teacherAmountCents`, uniquement
  `site_fee_cents`
- Visio Jitsi + `jaas-token.mjs`
- `resolveEquivalentStudentIds()` (double ID élève)
- Pages SEO « cours particuliers <ville> »
- `sonner` + `lucide-react` (Factur'Peyi est sur `react-icons`)

---

## 5. Règle de livraison — des deux côtés

```bash
npm run lint && npm test && npm run build
```

> **Un build vert ne prouve pas qu'une page s'affiche.**

C'est le seul enseignement à retenir de l'incident Factur'Peyi du 29/07/2026, et il
s'applique désormais aux deux repos.
