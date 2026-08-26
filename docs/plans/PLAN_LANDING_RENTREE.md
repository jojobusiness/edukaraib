# PLAN — Landing RENTRÉE (variante de `/bac`)

---

## ✅ EXÉCUTÉ ET MIS EN LIGNE LE 20/08/2026 — commit `16db14c2`

`/rentree` est **en production**, vérifié sur le site réel et pas seulement en local :
page qui répond 200, bundle servi `index-d0b6fd0d.js` contenant le hero de phase
`preparation`, le « Pack Trimestre 10h », le badge « Recommandé pour l'année », la matière
« Économie-Droit » et l'event pixel « Landing Rentrée ». `/rentree` figure dans les **deux**
sitemaps servis (`/sitemap.xml` et `/api/sitemap`).

Le merge a embarqué au passage `chore/harmonisation-tech-facturpeyi` (`56b5f04b`), qui traînait
non fusionnée depuis le 01/08 : master porte désormais le lint et les tests.

Vérifié avant le merge : lint 0 erreur · **91 tests au vert (59 → 91)** · build 29 s.

Checklist du §6 : tout est fait, avec **trois écarts assumés** au plan initial, tous justifiés
par des mesures faites sur la base réelle le 20/08 :

1. **`CampaignLanding.jsx` est dans `components/`, pas dans `pages/`.** Le plan le plaçait dans
   `pages/`, mais le test de fumée (`frontend/test/pages.test.jsx`) monte automatiquement chaque
   fichier de `pages/**` **sans props** — un composant qui exige `config` y aurait rendu la suite
   de tests rouge.
2. **Matières recadrées sur l'offre réelle.** Le plan proposait SVT, Histoire-Géo et « Aide aux
   devoirs » : **aucun prof ne couvre ces trois matières**. Retirées. Ajoutées à la place :
   **Comptabilité** et **Économie-Droit**, où 6 profs sur 15 se trouvent (voir §Découverte).
3. **`profsDispo` n'est plus un nombre codé en dur** : la page affiche le nombre réel de profs
   affichables, avec repli sur `profsFallback` si le comptage échoue.

Ajouté hors plan, parce que le problème est apparu en vérifiant le §3.4 :

- **`fix(search)`** — `/search?subject=X` filtrait par sous-chaîne brute sur du texte libre :
  « Maths » ne matchait pas « Mathématiques », « Physique-Chimie » ne matchait ni
  « Physique, Chimie » ni « Physique chimie ». **Les boutons de matière des landings étaient
  largement décoratifs depuis le début** (le bug était invisible : faute de résultats, la liste
  non filtrée s'affichait sans en-tête). Corrigé par `frontend/lib/subjectMatch.js`.
- **`scripts/diag-offre-profs.mjs`** — état de l'offre, à relancer avant chaque envoi de trafic.

### 📊 Offre mesurée le 20/08/2026 (réponse aux §5.2 et §5.3)

| | |
|---|---|
| Profs inscrits | **15** |
| Passent le filtre qualité (photo OU ≥1 avis) | **12** → section profs affichée ✅ |
| Ont ≥1 créneau coché | **6** |
| **Réellement réservables** | **5** |

**Le goulot n'est pas la landing, c'est le planning des profs.**

### 🔑 Découverte — le catalogue n'est pas scolaire, il est BTS/supérieur

**6 profs sur 15 font compta / maths financières / droit / éco / RH / gestion / management.**
C'est une niche BTS-supérieur en Guyane, arrivée sans avoir été planifiée : panier plus élevé,
besoin récurrent, et rentrée en septembre elle aussi. À exploiter comme un segment à part entière,
pas comme un reliquat.

### Reste à faire (hors code)

1. ~~Merger dans master~~ ✅ fait le 20/08, en ligne et vérifié en production.
2. Relancer les profs (`makerting/MESSAGE_PROFS_RENTREE_31_07.md`) — objectif ≥ 8 réservables.
3. Confirmer la date de rentrée de l'académie de Guyane (`DATE_RENTREE` = 01/09/2026 par hypothèse).
4. Basculer les liens vidéo / DM vers `/rentree`.
5. Remplacer les 2 faux témoignages de `/bac` par de vrais avis.

---

> Rédigé le 01/08/2026. À exécuter depuis l'environnement de dev (pas depuis OneDrive).
> Basé sur la lecture réelle de `frontend/pages/Bac.jsx` (655 l.), `frontend/lib/bacCampaign.js`, `CLAUDE.md`.
> **Fenêtre : la rentrée est le pic annuel. Chaque jour de retard après le ~20 août est du trafic perdu jusqu'en janvier.**

---

## 0. Décision d'architecture (lire avant de coder)

**Ne PAS dupliquer `Bac.jsx`.** Une copie = deux pages à maintenir, deux fois les bugs, et la page bac qui pourrit.

**Ne PAS non plus se contenter de la phase `apres`.** Aujourd'hui `getPhase()` renvoie déjà `'apres'` (on est après le 11/07) et le hero affiche « Prépare ta rentrée avec un prof caribéen ». C'est un pansement : le reste de la page est resté 100 % bac (packs « Je sécurise mon bac », matières Philosophie/SES, CTA « avant les épreuves », SEO « Soutien scolaire Bac »). Un parent qui cherche du soutien pour son 5e atterrit sur une page de terminale.

**Solution retenue : paramétrer le composant existant par une config, et le monter sur deux routes.**

```
frontend/config/campaigns.js      ← NOUVEAU : BAC_CAMPAIGN + RENTREE_CAMPAIGN
frontend/pages/CampaignLanding.jsx ← Bac.jsx renommé + paramétré (99 % du code inchangé)
frontend/pages/Bac.jsx             ← devient un wrapper 3 lignes
frontend/pages/Rentree.jsx         ← NOUVEAU wrapper 3 lignes
```

Bénéfices : `/bac` continue de fonctionner à l'identique (et resservira en juin 2027 grâce à l'auto-switch de dates), `/rentree` a sa propre URL indexable, et toute amélioration future profite aux deux.

**Pourquoi une route séparée et pas juste une phase :** SEO (« soutien scolaire rentrée Guyane » n'est pas la même requête que « bac »), attribution propre des liens vidéo/DM, et possibilité de faire tourner les deux campagnes sans qu'une écrase l'autre.

---

## 1. Ce qui existe déjà — NE RIEN RECONSTRUIRE

Vérifié dans le code, tout ça est opérationnel et se réutilise tel quel :

| Brique | Fichier | État |
|---|---|---|
| Capture `?code=XXX` + survie 14 j | `lib/bacCampaign.js` (`saveCampaign`/`getCampaignCode`) | ✅ générique, réutilisable sans modif |
| Tunnel pack → matière → `/search` | `Bac.jsx` `choosePack()` / `chooseSubject()` | ✅ |
| Profs affichés AVANT la barrière prix | section `#profs-dispo` + `ProfPreviewCard` | ✅ |
| Filtre qualité profs (photo OU ≥1 avis) | `Bac.jsx` l.206-211 | ✅ |
| Coupon pré-rempli au paiement | `create-checkout-session.mjs` | ✅ |
| Klarna 3x / Apple Pay / Google Pay | Stripe | ✅ |
| Meta Pixel `ViewContent` | `lib/metaPixel.js` | ✅ |
| CTA collant mobile | `Bac.jsx` l.540-558 | ✅ (82 % du trafic est mobile) |

**Aucune modification du flux de paiement n'est nécessaire.** Ce plan ne touche ni `create-checkout-session.mjs`, ni le webhook, ni les prix. Zéro risque sur l'encaissement.

---

## 2. Étape 1 — Extraire la config (30 min)

Créer `frontend/config/campaigns.js` :

```js
/* ——————————————————————————————————————————————
   Configs de campagne. Une campagne = un hero par phase,
   des packs, des matières, un SEO. Le composant est commun.
   —————————————————————————————————————————————— */

/* ========== BAC (existant, inchangé) ========== */
const DATE_ECRITS      = new Date('2026-06-15T08:00:00+02:00');
const DATE_RESULTATS   = new Date('2026-07-04T10:00:00+02:00');
const DATE_RATTRAPAGE  = new Date('2026-07-07T08:00:00+02:00');
const FIN_RATTRAPAGE   = new Date('2026-07-11T00:00:00+02:00');

export const BAC_CAMPAIGN = {
  id: 'bac',
  profsDispo: 14,                    // ⚠️ voir §5.3 avant de toucher
  subjects: ['Maths','Français','Philosophie','Physique-Chimie','SVT','SES','Anglais','Histoire-Géo'],
  seo: {
    title: 'Soutien scolaire Bac — Guyane & Antilles | EduKaraib',
    description: 'Révisions intensives et rattrapage du bac avec des profs caribéens vérifiés. Visio ou présentiel, payable en 3x, satisfait ou remboursé.',
    url: 'https://edukaraib.com/bac',
  },
  pixelName: 'Landing Bac',
  getPhase(now = new Date()) {
    if (now < DATE_ECRITS)     return 'revision';
    if (now < DATE_RESULTATS)  return 'resultats';
    if (now < FIN_RATTRAPAGE)  return 'rattrapage';
    return 'apres';
  },
  heroes: { /* ——— reprendre HEROES tel quel depuis Bac.jsx l.58-83 ——— */ },
  packs:  { /* ——— reprendre PACKS tel quel depuis Bac.jsx l.85-119 ——— */ },
  faq:    { /* ——— reprendre FAQ_ITEMS tel quel ——— */ },
  finalCta: (phase) => phase === 'rattrapage'
    ? 'Le rattrapage ne t’attendra pas.'
    : 'Chaque jour compte avant les épreuves.',
};
```

Puis dans `CampaignLanding.jsx`, remplacer les constantes en tête de fichier par la prop :

```js
export default function CampaignLanding({ config }) {
  const phase = useMemo(() => config.getPhase(), [config]);
  const hero  = config.heroes[phase];
  // ... PACKS → config.packs, SUBJECTS_BAC → config.subjects,
  //     PROFS_DISPO → config.profsDispo, useSEO(config.seo),
  //     pixelTrack('ViewContent', { content_name: config.pixelName, ... })
```

**Règle de sécurité pour ce refactor :** ne changer AUCUNE chaîne de caractères ni classe Tailwind pendant l'extraction. Le seul objectif de l'étape 1 est que `/bac` rende exactement pareil qu'avant. Vérifier visuellement avant de passer à l'étape 2.

---

## 3. Étape 2 — La config RENTRÉE

### 3.1 Dates et phases

```js
/* ========== RENTRÉE ========== */
// ⚠️ CONFIRMER la date exacte de rentrée sur le calendrier de l'académie de Guyane
//    (elle peut différer de la métropole). Idem Martinique/Guadeloupe si ciblage large.
const DATE_RENTREE        = new Date('2026-09-01T08:00:00+02:00');
const FIN_PREMIERES_SEM   = new Date('2026-09-21T00:00:00+02:00');
const DATE_PREMIERES_NOTES= new Date('2026-10-05T00:00:00+02:00');
const FIN_CAMPAGNE        = new Date('2026-11-03T00:00:00+02:00'); // Toussaint

getPhase(now = new Date()) {
  if (now < DATE_RENTREE)         return 'preparation';
  if (now < FIN_PREMIERES_SEM)    return 'demarrage';
  if (now < DATE_PREMIERES_NOTES) return 'installation';
  if (now < FIN_CAMPAGNE)         return 'notes';
  return 'apres';
}
```

**Pourquoi 4 phases et pas une seule accroche :** l'intention d'achat d'un parent change complètement entre août (« j'anticipe ») et octobre (« mon fils a 6 de moyenne »). La phase `notes` est la plus rentable de toutes — c'est le moment où un parent passe à l'acte sans hésiter. Le code d'auto-switch existe déjà, il serait absurde de ne pas s'en servir.

### 3.2 Heroes

```js
heroes: {
  preparation: {
    title: 'La rentrée se prépare maintenant, pas en octobre.',
    subtitle: 'Reprenez les bases avant le jour J avec un prof caribéen — visio ou près de chez vous. Payable en 3x.',
    countdownLabel: 'Rentrée dans',
    countdownTarget: DATE_RENTREE,
  },
  demarrage: {
    title: 'Les premières semaines décident de toute l’année.',
    subtitle: 'Un prof dès maintenant, c’est une année qui démarre bien au lieu d’un rattrapage en décembre.',
    countdownLabel: null,
    countdownTarget: null,
  },
  installation: {
    title: 'Prenez de l’avance pendant que le programme est encore accessible.',
    subtitle: 'Un cours par semaine suffit à installer le rythme. Profs caribéens vérifiés, visio ou présentiel.',
    countdownLabel: 'Premières notes dans',
    countdownTarget: DATE_PREMIERES_NOTES,
  },
  notes: {
    title: 'Les premières notes sont tombées. Il est encore temps de corriger le tir.',
    subtitle: 'Une matière qui décroche se rattrape en octobre. En février, c’est une autre histoire.',
    countdownLabel: null,
    countdownTarget: null,
  },
  apres: {
    title: 'Un prof caribéen pour reprendre les bases, toute l’année.',
    subtitle: 'Visio ou près de chez vous, à votre rythme. Payable en 3x.',
    countdownLabel: null,
    countdownTarget: null,
  },
},
```

### 3.3 Packs — le levier de marge le plus direct du plan

Structure identique (même valeurs `pack: 0/5/10` → aucun changement côté paiement), **taglines rentrée** et surtout : **le badge de mise en avant passe du pack 5h au pack 10h.**

```js
packs: [
  {
    pack: 0,
    name: 'Coup de pouce',
    tagline: 'Une matière qui coince',
    price: '≈ 30 €', priceNote: 'l’heure',
    points: ['Cours à l’unité, sans engagement', 'Prof vérifié, visio ou présentiel', 'Pour débloquer un chapitre précis'],
    discount: '-5 € avec votre code promo',
    highlight: false,
    cta: 'Choisir ce format',
  },
  {
    pack: 5,
    name: 'Pack Démarrage 5h',
    tagline: 'Bien lancer l’année',
    price: '≈ 150 €', priceNote: '6h de cours · soit ~25 €/h',
    points: ['+1h OFFERTE (6h au total)', 'Payable en 3x sans frais (Klarna)', 'De quoi remettre les bases à niveau'],
    discount: '-10 € avec votre code promo',
    highlight: false,
    cta: 'Choisir le Pack 5h',
  },
  {
    pack: 10,
    name: 'Pack Trimestre 10h',
    tagline: 'Un cours par semaine jusqu’à la Toussaint',
    price: '≈ 300 €', priceNote: '12h de cours · soit ~25 €/h',
    points: [
      '+2h OFFERTES (12h au total)',
      'Le rythme qui fait vraiment progresser : 1h/semaine',
      'Payable en 3x sans frais (Klarna)',
    ],
    discount: '-30 € avec votre code promo',
    highlight: true,           // ⬅️ CHANGEMENT CLÉ
    cta: 'Choisir le Pack Trimestre',
  },
],
```

**Pourquoi ce déplacement du badge compte :** marge plateforme = **50 € sur un pack 5h, 100 € sur un pack 10h** (commission fixe 10 €/h, cf `DOSSIER_EDUKARAIB_CONSOLIDE.md` l.33-36). Orienter le choix par défaut vers le 10h **double la marge par conversion, à trafic identique**. Et c'est cohérent avec l'intention rentrée : un parent qui organise son année achète de la régularité, pas un sprint. Sur le bac, le 5h restait le bon choix (urgence courte) — d'où deux configs distinctes.

⚠️ **Le libellé du badge doit changer.** Dans `CampaignLanding.jsx`, le badge est écrit en dur « ⭐ Le plus choisi » (l.358). Sur la rentrée, cette affirmation n'est pas vérifiable → la remplacer par un champ de config `badgeLabel`, avec `'⭐ Recommandé pour l’année'` côté rentrée. Même effet d'orientation, aucune affirmation invérifiable. (Cf. la leçon FacturPeyi : un concurrent lit ces pages.)

### 3.4 Matières — le point le plus sous-estimé

`SUBJECTS_BAC` contient Philosophie et SES : deux matières de terminale, inutiles pour l'essentiel de la demande rentrée (primaire + collège). Un parent de 6e ne se reconnaît pas dans cette liste et part.

```js
subjects: [
  'Maths', 'Français', 'Anglais', 'Physique-Chimie',
  'SVT', 'Histoire-Géo', 'Espagnol', 'Aide aux devoirs',
],
```

`'Aide aux devoirs'` couvre le primaire, qui est le segment le plus facile à convertir (parent décideur, budget modeste, pas d'enjeu d'orientation).

⚠️ **Vérifier avant de livrer que ces libellés matchent ceux utilisés par les profs dans `/search`** (`chooseSubject` navigue vers `/search?subject=X`). Si aucun prof n'a « Aide aux devoirs » en matière, le clic mène à une page vide — pire que pas de bouton. À croiser avec la campagne profs (`makerting/MESSAGE_PROFS_RENTREE_31_07.md`).

### 3.5 SEO + Pixel

```js
seo: {
  title: 'Soutien scolaire rentrée 2026 — Guyane & Antilles | EduKaraib',
  description: 'Un prof caribéen pour bien démarrer l’année : primaire, collège, lycée. Visio ou présentiel, payable en 3x, satisfait ou remboursé.',
  url: 'https://edukaraib.com/rentree',
},
pixelName: 'Landing Rentrée',
finalCta: (phase) => phase === 'notes'
  ? 'Une note qui décroche se rattrape maintenant.'
  : 'L’année se joue dans les premières semaines.',
```

### 3.6 FAQ — 2 ajouts spécifiques rentrée

Garder les 3 questions existantes (code promo, 3x, satisfait ou remboursé) et ajouter :

```js
{
  q: 'À quelle fréquence faut-il prendre des cours ?',
  a: 'Une heure par semaine suffit dans la grande majorité des cas — c’est la régularité qui fait progresser, pas l’intensité. C’est exactement ce que couvre le Pack Trimestre.',
},
{
  q: 'Mon enfant est au primaire / au collège, c’est possible ?',
  a: 'Oui. Nos profs couvrent du primaire au lycée, y compris l’aide aux devoirs. Choisissez la matière, on vous montre directement les profs disponibles.',
},
```

---

## 4. Étape 3 — Routing, footer, sitemap

`CLAUDE.md` du repo impose 3 vérifications pour toute nouvelle page. À faire dans l'ordre :

1. **Route** dans `frontend/App.jsx` :
   ```js
   const Rentree = lazy(() => import('./pages/Rentree'));
   // ...
   <Route path="/rentree" element={<Rentree />} />
   ```
   Garder `/bac` et son alias `/rattrapage` intacts.

2. **Footer + sitemap** : ajouter `/rentree` (page publique SEO).

3. **Test manuel** `npm run dev` → `http://localhost:5173/rentree` : la page s'affiche, pas de 404, pas de crash.

Wrappers :

```js
// frontend/pages/Rentree.jsx
import CampaignLanding from './CampaignLanding';
import { RENTREE_CAMPAIGN } from '../config/campaigns';
export default function Rentree() { return <CampaignLanding config={RENTREE_CAMPAIGN} />; }
```

---

## 5. Points de vigilance (à traiter, pas à ignorer)

### 5.1 Témoignages fabriqués
`CampaignLanding.jsx` l.473 porte déjà l'avertissement `⚠️ À remplacer par de vrais avis clients`. Les deux témoignages actuels sont inventés **et** bac-flavored (« avant les épreuves », « Terminale »). Trois options, par ordre de préférence :
1. **Vrais avis** — demander un retour écrit aux profs actifs et à l'élève inscrite, publier avec prénom + commune. C'est faisable cette semaine.
2. **Remplacer par de la preuve vérifiable** — nombre de profs vérifiés, note moyenne réelle, « paiement en 3x », « satisfait ou remboursé ».
3. **Masquer la section** en attendant.

Ne pas se contenter de réécrire les faux témoignages en version rentrée. Un concurrent lit ces pages, et la crédibilité est l'actif principal d'une marketplace de soutien scolaire.

### 5.2 Section profs cachée sous 3 profs
`showProfsSection = profsLoading || profs.length >= 3` (l.261), avec un filtre qualité exigeant **photo OU ≥1 avis** (l.206-211). Sur 14 profs inscrits, combien passent ce filtre ?

**À vérifier avant de lancer le trafic.** Si moins de 3 passent, la meilleure section de la page disparaît et il ne reste qu'un mur de prix. C'est le lien direct avec la campagne profs : **photo de profil + créneaux cochés ne sont pas du confort, ce sont les conditions d'affichage de la landing.**

### 5.3 `PROFS_DISPO` codé en dur à 12
Devient `config.profsDispo`. Mais surtout : la phrase affichée est « 🔥 X profs disponibles cette semaine » (l.523). **N'y mettre que le nombre de profs ayant réellement des créneaux ouverts**, pas le nombre d'inscrits. Annoncer 14 profs disponibles quand aucun n'a rempli son planning est un mensonge que l'utilisateur découvre au clic suivant. Mettre à jour ce chiffre après la campagne profs, pas avant.

### 5.4 Tutoiement → vouvoiement
`/bac` tutoie (l'élève achète). À la rentrée, **le payeur est le parent**. Les textes rentrée ci-dessus sont au vouvoiement, volontairement. Vérifier qu'aucune chaîne en dur du composant ne tutoie encore — sinon la sortir en config. À l'inverse, si tu cibles d'abord les lycéens/étudiants, bascule tout au tutoiement : l'important est qu'il n'y ait **pas de mélange** dans la page.

### 5.5 Ce qu'on ne fait PAS dans ce plan
- **Pas d'abonnement mensuel récurrent.** Il n'est pas développé (`CLAUDE.md`, priorité CA n°11, non fait). Le Pack Trimestre en est la version vendable dès aujourd'hui avec la plomberie existante. Ne pas afficher un produit qui n'existe pas.
- **Pas de sélecteur de niveau** (Primaire/Collège/Lycée). Utile, mais Phase 2 : ça ajoute du filtrage dans `/search` et retarde la mise en ligne. La liste de matières fait le job pour la v1.
- **Pas de refonte du tunnel de paiement.** Rien à y toucher.

---

## 6. Checklist de livraison

- [ ] Étape 1 faite : `/bac` rend **exactement** comme avant après extraction de la config
- [ ] `RENTREE_CAMPAIGN` complète (dates, 5 heroes, 3 packs, matières, FAQ, SEO, badgeLabel)
- [ ] Badge « le plus choisi » sorti en config, libellé rentrée non-invérifiable
- [ ] Highlight sur le pack 10h
- [ ] Route `/rentree` + footer + sitemap
- [ ] Libellés de matières vérifiés contre les matières réelles des profs dans `/search`
- [ ] Nombre de profs passant le filtre qualité vérifié (≥ 3 sinon la section saute)
- [ ] `profsDispo` = nombre de profs **avec créneaux**, pas d'inscrits
- [ ] Témoignages : vrais, remplacés, ou masqués — pas réécrits en faux
- [ ] Test manuel mobile (82 % du trafic) : hero → packs → matière → `/search` sans blocage
- [ ] Meta Pixel : `ViewContent` « Landing Rentrée » visible dans Test Events
- [ ] Test `?code=TEST123` → bandeau code affiché → remise appliquée au checkout

---

## 7. Séquence recommandée

| Quand | Quoi |
|---|---|
| **Cette semaine** | Étape 1 (extraction config) + campagne profs en parallèle (`makerting/MESSAGE_PROFS_RENTREE_31_07.md`) |
| **~10 août** | Étape 2 + 3, mise en ligne de `/rentree`, phase `preparation` active avec compte à rebours |
| **~20 août** | Bascule de l'effort contenu sur la demande parents, tous les liens vidéo/DM pointent vers `/rentree` |
| **1er sept.** | Phase `demarrage` automatique |
| **~5 oct.** | Phase `notes` automatique — **le pic d'intention d'achat de toute la campagne** |

**Métrique de la landing** (à lire dans Amplitude/Vercel) : taux `/rentree` → `/search`. Sur `/bac` la fuite mesurée était de **-78 %** (9 → 2). Tout ce qui est au-dessus de 22 % est déjà un progrès ; l'objectif est 40 %.

**Ne pas envoyer de trafic sur `/rentree` avant que la section profs s'affiche.** L'ordre est : profs → landing → trafic. Une marketplace vide ne se rattrape pas avec du copywriting.
