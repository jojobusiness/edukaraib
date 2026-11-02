/* ————————————————————————————————————————————————————————————
   Configs de campagne — une campagne = des phases datées, un hero par phase,
   des packs, des matières, une voix (tutoiement/vouvoiement), un SEO.
   Le composant de rendu est commun : `components/CampaignLanding.jsx`.

   Pourquoi une config plutôt qu’une copie de page : une duplication de
   `Bac.jsx` aurait donné deux pages à maintenir, deux fois les mêmes bugs, et
   la page bac qui pourrit. Ici `/bac` et `/rentree` partagent le même moteur ;
   toute amélioration profite aux deux.
   ———————————————————————————————————————————————————————————— */

/* ════════════ BAC — inchangé fonctionnellement (extrait de Bac.jsx) ════════ */

const DATE_ECRITS = new Date('2026-06-15T08:00:00+02:00');
const DATE_RESULTATS = new Date('2026-07-04T10:00:00+02:00');
const DATE_RATTRAPAGE = new Date('2026-07-07T08:00:00+02:00');
const FIN_RATTRAPAGE = new Date('2026-07-11T00:00:00+02:00');

export const BAC_CAMPAIGN = {
  id: 'bac',
  /* Repli si le comptage réel des profs échoue (cf. `scarcity` plus bas). */
  profsFallback: 12,
  /* Même règle que RENTREE_CAMPAIGN : une matière ne reste ici que si au moins
     un prof qui la couvre est RÉSERVABLE (`node scripts/diag-offre-profs.mjs`).

     Historique des retraits (mesures réelles) :
     - 14/09 : Philosophie, SVT, SES, Histoire-Géo — aucun prof réservable. */
  subjects: ['Maths', 'Français', 'Physique-Chimie', 'Anglais'],
  seo: {
    title: 'Soutien scolaire Bac — Guyane & Antilles | EduKaraib',
    description: 'Révisions intensives et rattrapage du bac avec des profs caribéens vérifiés. Visio ou présentiel, payable en 3x, satisfait ou remboursé.',
    url: 'https://edukaraib.com/bac',
  },
  pixelName: 'Landing Bac',

  getPhase(now = new Date()) {
    if (now < DATE_ECRITS) return 'revision';
    if (now < DATE_RESULTATS) return 'resultats';
    if (now < FIN_RATTRAPAGE) return 'rattrapage';
    return 'apres';
  },

  heroes: {
    revision: {
      title: 'Bac 2026 : la dernière ligne droite se joue maintenant.',
      subtitle: 'Des profs caribéens, en visio ou près de chez toi. Réserve tes heures intensives, paie en 3x.',
      countdownLabel: 'Écrits dans',
      countdownTarget: DATE_ECRITS,
    },
    resultats: {
      title: 'Résultats le 4 juillet. Prépare le rattrapage dès maintenant.',
      subtitle: 'Ne reste pas à attendre : un prof dispo cette semaine peut tout changer pour les oraux de rattrapage.',
      countdownLabel: 'Résultats dans',
      countdownTarget: DATE_RESULTATS,
    },
    rattrapage: {
      title: 'Rattrapage du bac : 48h pour tout jouer. On t’aide à le décrocher.',
      subtitle: 'Un prof dispo cette semaine, sessions intensives, satisfait ou remboursé.',
      countdownLabel: 'Rattrapage dans',
      countdownTarget: DATE_RATTRAPAGE,
    },
    apres: {
      title: 'Prépare ta rentrée avec un prof caribéen.',
      subtitle: 'Remise à niveau pendant les vacances, en visio ou près de chez toi. Paie en 3x.',
      countdownLabel: null,
      countdownTarget: null,
    },
  },

  packs: [
    {
      pack: 0,
      name: 'SOS 1 matière',
      tagline: 'Une matière qui coince',
      price: '≈ 30 €',
      priceNote: 'l’heure',
      points: ['Cours à l’unité, sans engagement', 'Prof vérifié, visio ou présentiel', 'Idéal pour débloquer un chapitre'],
      discount: '-2 € avec ton code partenaire',
      highlight: false,
      cta: 'Choisir ce format',
    },
    {
      pack: 5,
      name: 'Pack Intensif 5h',
      tagline: 'La dernière ligne droite',
      price: '≈ 150 €',
      priceNote: '6h de cours · soit ~25 €/h',
      points: ['+1h OFFERTE (6h au total)', 'Payable en 3x sans frais (Klarna)', 'Le format le plus choisi avant les épreuves'],
      discount: '-10 € avec ton code partenaire',
      highlight: true,
      cta: 'Choisir le Pack 5h',
    },
    {
      pack: 10,
      name: 'Pack Prépa 10h',
      tagline: 'Je sécurise mon bac',
      price: '≈ 300 €',
      priceNote: '12h de cours · soit ~25 €/h',
      points: ['+2h OFFERTES (12h au total)', 'Payable en 3x sans frais (Klarna)', 'Suivi complet sur plusieurs matières'],
      discount: '-20 € avec ton code partenaire',
      highlight: false,
      cta: 'Choisir le Pack 10h',
    },
  ],

  faq: [
    {
      q: 'Comment mon code partenaire est-il appliqué ?',
      a: 'Si tu es arrivé(e) ici avec le code d’un partenaire (ton association, ton établissement, un créateur), il est enregistré automatiquement : la remise s’applique toute seule au moment du paiement, tu n’as rien à taper.',
    },
    {
      q: 'Je peux vraiment payer en 3 fois ?',
      a: 'Oui — au paiement, choisis Klarna pour régler en 3 fois sans frais. Apple Pay et Google Pay sont aussi disponibles.',
    },
    {
      q: 'Et si le cours ne me convient pas ?',
      a: 'Première séance satisfait ou remboursé : tu peux demander le remboursement directement depuis ton espace, sans justification.',
    },
  ],

  /* Toutes les chaînes qui changent de voix (tutoiement ici, vouvoiement sur
     la rentrée où le payeur est le parent). Aucune ne doit rester en dur dans
     le composant, sinon les deux voix se mélangent dans la même page. */
  copy: {
    heroCtaPrimary: 'Choisir mon pack',
    heroCtaSecondary: 'Voir les profs dispo',
    profsTitle: 'Des profs dispo cette semaine',
    profsSubtitle: 'Caribéens, vérifiés — visio ou près de chez toi. Choisis, puis réserve tes heures.',
    profsCtaAll: 'Voir tous les profs',
    packsTitle: 'Choisis ton format',
    badgeLabel: '⭐ Le plus choisi',
    subjectsTitleIdle: 'Ta matière',
    subjectsTitleActive: '👇 Dernière étape : ta matière',
    subjectsNote: 'On te montre directement les profs dispo dans cette matière.',
    stepsTitle: 'Comment ça marche',
    steps: [
      { n: '1', t: 'Choisis ton pack', d: 'Et ta matière — 10 secondes.' },
      { n: '2', t: 'Inscris-toi en 30s', d: 'Email, mot de passe, prénom. C’est tout.' },
      { n: '3', t: 'Contacte ton prof', d: 'Message pré-rempli, il te propose un créneau cette semaine. Tu paies après confirmation.' },
    ],
    whyTitle: 'Pourquoi EduKaraib',
    why: [
      { icon: 'GraduationCap', t: 'Profs caribéens vérifiés', d: 'Des profs qui connaissent ta réalité — Guyane, Antilles, en ligne.' },
      { icon: 'Video', t: 'Visio ou présentiel', d: 'Cours depuis ton téléphone ou près de chez toi.' },
      { icon: 'CreditCard', t: 'Paiement en 3x sans frais', d: 'Klarna, Apple Pay, Google Pay — au choix.' },
      { icon: 'ShieldCheck', t: 'Satisfait ou remboursé', d: 'Première séance remboursable en 1 clic depuis ton espace.' },
    ],
    /* ⚠️ Témoignages inventés, conservés tels quels sur /bac pour ne rien
       changer au comportement existant. À remplacer par de vrais avis. */
    testimonials: [
      { txt: 'Mon fils a enfin compris les maths avant les épreuves. Le prof était dispo le soir même en visio.', who: 'Parent d’élève · Cayenne' },
      { txt: 'Le paiement en 3 fois m’a permis de prendre le pack 10h sans stresser le budget.', who: 'Élève de Terminale · Martinique' },
    ],
    proofPoints: null,
    faqTitle: 'Questions fréquentes',
    scarcity: ({ verifies, disponibles }) => (disponibles > 0
      ? `🔥 ${verifies} profs vérifiés · ${disponibles} avec des créneaux ouverts`
      : `🔥 ${verifies} profs caribéens vérifiés`),
    finalCta: (phase) => (phase === 'rattrapage'
      ? 'Le rattrapage ne t’attendra pas.'
      : 'Chaque jour compte avant les épreuves.'),
    stickyCta: 'Choisir mon pack',
  },
};

/* ══════════════════════════ RENTRÉE 2026 ═══════════════════════════════════ */

/* 02/11/2026 — « Rentrée de novembre » et page SIMPLIFIÉE à la demande de Joseph
   (« trop d'informations, on est perdu ») : un titre, les formules, la matière,
   3 lignes. Plus de profs, de FAQ ni de blocs qui répètent la même chose. */
export const RENTREE_CAMPAIGN = {
  id: 'rentree',
  sansProfs: true,
  profsFallback: 12,

  /* ⚠️ RÈGLE : une matière ne reste dans cette liste que si AU MOINS UN prof
     qui la couvre est RÉSERVABLE (affichable ET avec au moins un créneau
     coché). Un bouton dont aucun prof n’est réservable envoie le parent sur des
     profils qu’il ne peut pas réserver, au moment précis où il est décidé.
     Le contrôle est automatisé : `node scripts/diag-offre-profs.mjs` croise
     cette liste avec la base réelle et signale les matières orphelines.

     Historique des retraits (mesures réelles) :
     - 20/08 : SVT, Histoire-Géo, « Aide aux devoirs » — aucun prof.
     - 26/08 : « Informatique » — un seul prof la déclare (ajoutée à son profil
       le 26/08) et il n’a aucun créneau → 0 réservable. À rouvrir dès qu’il
       coche des créneaux.

     Comptabilité et Économie-Droit sont là parce que c’est la vraie force de la
     base : 6 profs sur 15 en compta / finance / droit / éco / RH / gestion, et
     le supérieur fait sa rentrée en septembre lui aussi. */
  subjects: [
    'Maths', 'Français', 'Anglais', 'Physique-Chimie',
    'Espagnol', 'Comptabilité', 'Économie-Droit',
  ],

  seo: {
    title: 'Rentrée de novembre : cours particuliers Guyane & Antilles | EduKaraib',
    description: 'Un prof caribéen pour bien démarrer l’année : collège, lycée, BTS. Visio ou présentiel, payable en 3x, satisfait ou remboursé.',
    url: 'https://edukaraib.com/rentree',
  },
  pixelName: 'Landing Rentrée',

  getPhase() { return 'novembre'; },

  heroes: {
    novembre: {
      title: 'Rentrée de novembre : reprenez l’année du bon pied.',
      subtitle: 'Un prof caribéen, en visio ou près de chez vous.',
      countdownLabel: null,
      countdownTarget: null,
    },
  },

  /* Valeurs `pack` identiques (0 / 5 / 10) → AUCUN changement côté paiement.
     Seul le badge de mise en avant se déplace sur le 10h : la marge plateforme
     est de 50 € sur un pack 5h contre 100 € sur un pack 10h (commission fixe
     de 10 €/h). Orienter le choix par défaut vers le 10h double la marge par
     conversion à trafic identique — et colle à l’intention rentrée, où le
     parent achète de la régularité, pas un sprint. */
  packs: [
    {
      pack: 0,
      name: 'À l’unité',
      tagline: 'Pour débloquer un chapitre',
      price: '',
      priceNote: 'l’heure',
      points: ['Sans engagement'],
      discount: '-2 € avec votre code partenaire',
      highlight: false,
      cta: 'Choisir',
    },
    {
      pack: 5,
      name: 'Pack 5h',
      tagline: 'Pour remettre les bases à niveau',
      price: '',
      priceNote: '6h de cours',
      points: ['1h offerte'],
      discount: '-10 € avec votre code partenaire',
      highlight: false,
      cta: 'Choisir',
    },
    {
      pack: 10,
      name: 'Pack 10h',
      tagline: 'Un cours par semaine jusqu’en janvier',
      price: '',
      priceNote: '12h de cours',
      points: ['2h offertes'],
      discount: '-20 € avec votre code partenaire',
      highlight: true,
      cta: 'Choisir',
    },
  ],

  faq: [],

  copy: {
    heroCtaPrimary: 'Choisir ma formule',
    packsTitle: 'Choisissez votre formule',
    packsNote: 'Prix les plus bas sur le site, frais inclus. Le prix exact dépend du prof et s’affiche sur son profil.',
    badgeLabel: '⭐ Recommandé',
    subjectsTitleIdle: 'Puis la matière',
    subjectsTitleActive: '👇 Maintenant, la matière',
    subjectsNote: '',
    stepsTitle: 'Ensuite',
    steps: [
      { n: '1', t: 'Écrivez au prof', d: 'Il vous propose un horaire.' },
      { n: '2', t: 'Payez une fois le cours accepté', d: 'En 3x sans frais sur les packs.' },
      { n: '3', t: 'Faites le cours', d: 'Première séance remboursable.' },
    ],
    why: [],
    testimonials: null,
    proofPoints: [],
    stickyCta: 'Choisir ma formule',
  },
};
