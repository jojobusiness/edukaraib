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
  subjects: [
    'Maths', 'Français', 'Philosophie', 'Physique-Chimie',
    'SVT', 'SES', 'Anglais', 'Histoire-Géo',
  ],
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
      discount: '-5 € avec ton code promo',
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
      discount: '-10 € avec ton code promo',
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
      discount: '-30 € avec ton code promo',
      highlight: false,
      cta: 'Choisir le Pack 10h',
    },
  ],

  faq: [
    {
      q: 'Comment mon code promo est-il appliqué ?',
      a: 'Si tu es arrivé(e) ici avec un code (lien d’un créateur), il est enregistré automatiquement : la remise s’applique toute seule au moment du paiement, tu n’as rien à taper.',
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
    scarcity: (n) => `🔥 ${n} profs disponibles cette semaine`,
    finalCta: (phase) => (phase === 'rattrapage'
      ? 'Le rattrapage ne t’attendra pas.'
      : 'Chaque jour compte avant les épreuves.'),
    stickyCta: 'Choisir mon pack',
  },
};

/* ══════════════════════════ RENTRÉE 2026 ═══════════════════════════════════ */

/* ⚠️ À CONFIRMER : date de rentrée de l’académie de Guyane (elle peut différer
   de la métropole et des Antilles). Le 01/09 est une hypothèse de travail ;
   elle ne change que la bascule preparation → demarrage, pas le tunnel. */
const DATE_RENTREE = new Date('2026-09-01T07:00:00-03:00');
const FIN_PREMIERES_SEM = new Date('2026-09-21T00:00:00-03:00');
const DATE_PREMIERES_NOTES = new Date('2026-10-05T00:00:00-03:00');
const FIN_CAMPAGNE = new Date('2026-11-03T00:00:00-03:00'); // Toussaint

export const RENTREE_CAMPAIGN = {
  id: 'rentree',
  profsFallback: 12,

  /* ⚠️ Liste alignée sur l’OFFRE RÉELLE mesurée le 20/08/2026 (15 profs) :
     SVT, Histoire-Géo et « Aide aux devoirs » ont été retirés du plan initial
     car AUCUN prof ne les couvre — un bouton qui mène à une liste sans prof de
     la matière coûte plus cher qu’un bouton absent.
     Comptabilité et Économie-Droit sont ajoutés : c’est la vraie force de la
     base (6 profs sur 15 en compta / finance / droit / éco / RH / gestion), et
     le supérieur fait sa rentrée en septembre lui aussi.
     À rouvrir dès que des profs de ces matières sont recrutés. */
  subjects: [
    'Maths', 'Français', 'Anglais', 'Physique-Chimie',
    'Espagnol', 'Comptabilité', 'Économie-Droit', 'Informatique',
  ],

  seo: {
    title: 'Soutien scolaire rentrée 2026 — Guyane & Antilles | EduKaraib',
    description: 'Un prof caribéen pour bien démarrer l’année : collège, lycée, BTS. Visio ou présentiel, payable en 3x, satisfait ou remboursé.',
    url: 'https://edukaraib.com/rentree',
  },
  pixelName: 'Landing Rentrée',

  getPhase(now = new Date()) {
    if (now < DATE_RENTREE) return 'preparation';
    if (now < FIN_PREMIERES_SEM) return 'demarrage';
    if (now < DATE_PREMIERES_NOTES) return 'installation';
    if (now < FIN_CAMPAGNE) return 'notes';
    return 'apres';
  },

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

  /* Valeurs `pack` identiques (0 / 5 / 10) → AUCUN changement côté paiement.
     Seul le badge de mise en avant se déplace sur le 10h : la marge plateforme
     est de 50 € sur un pack 5h contre 100 € sur un pack 10h (commission fixe
     de 10 €/h). Orienter le choix par défaut vers le 10h double la marge par
     conversion à trafic identique — et colle à l’intention rentrée, où le
     parent achète de la régularité, pas un sprint. */
  packs: [
    {
      pack: 0,
      name: 'Coup de pouce',
      tagline: 'Une matière qui coince',
      price: '≈ 30 €',
      priceNote: 'l’heure',
      points: ['Cours à l’unité, sans engagement', 'Prof vérifié, visio ou présentiel', 'Pour débloquer un chapitre précis'],
      discount: '-5 € avec votre code promo',
      highlight: false,
      cta: 'Choisir ce format',
    },
    {
      pack: 5,
      name: 'Pack Démarrage 5h',
      tagline: 'Bien lancer l’année',
      price: '≈ 150 €',
      priceNote: '6h de cours · soit ~25 €/h',
      points: ['+1h OFFERTE (6h au total)', 'Payable en 3x sans frais (Klarna)', 'De quoi remettre les bases à niveau'],
      discount: '-10 € avec votre code promo',
      highlight: false,
      cta: 'Choisir le Pack 5h',
    },
    {
      pack: 10,
      name: 'Pack Trimestre 10h',
      tagline: 'Un cours par semaine jusqu’à la Toussaint',
      price: '≈ 300 €',
      priceNote: '12h de cours · soit ~25 €/h',
      points: [
        '+2h OFFERTES (12h au total)',
        'Le rythme qui fait progresser : 1h par semaine',
        'Payable en 3x sans frais (Klarna)',
      ],
      discount: '-30 € avec votre code promo',
      highlight: true,
      cta: 'Choisir le Pack Trimestre',
    },
  ],

  faq: [
    {
      q: 'Comment mon code promo est-il appliqué ?',
      a: 'Si vous êtes arrivé(e) ici avec un code (lien d’un créateur), il est enregistré automatiquement : la remise s’applique toute seule au moment du paiement, vous n’avez rien à taper.',
    },
    {
      q: 'À quelle fréquence faut-il prendre des cours ?',
      a: 'Une heure par semaine suffit dans la grande majorité des cas — c’est la régularité qui fait progresser, pas l’intensité. C’est exactement ce que couvre le Pack Trimestre.',
    },
    {
      q: 'Mon enfant est au collège ou au lycée, c’est possible ?',
      a: 'Oui. Nos profs couvrent le collège, le lycée et le supérieur (BTS, licence — comptabilité, gestion, droit, économie). Choisissez la matière, on vous montre directement les profs disponibles.',
    },
    {
      q: 'Je peux vraiment payer en 3 fois ?',
      a: 'Oui — au paiement, choisissez Klarna pour régler en 3 fois sans frais. Apple Pay et Google Pay sont aussi disponibles.',
    },
    {
      q: 'Et si le cours ne convient pas ?',
      a: 'Première séance satisfait ou remboursé : vous pouvez demander le remboursement directement depuis votre espace, sans justification.',
    },
  ],

  copy: {
    heroCtaPrimary: 'Choisir ma formule',
    heroCtaSecondary: 'Voir les profs disponibles',
    profsTitle: 'Des profs disponibles pour cette rentrée',
    profsSubtitle: 'Caribéens, vérifiés — visio ou près de chez vous. Choisissez, puis réservez vos heures.',
    profsCtaAll: 'Voir tous les profs',
    packsTitle: 'Choisissez votre formule',
    /* Pas de « le plus choisi » ici : l’affirmation ne serait pas vérifiable
       sur une campagne qui démarre. Même effet d’orientation, zéro mensonge. */
    badgeLabel: '⭐ Recommandé pour l’année',
    subjectsTitleIdle: 'La matière',
    subjectsTitleActive: '👇 Dernière étape : la matière',
    subjectsNote: 'On vous montre directement les profs disponibles dans cette matière.',
    stepsTitle: 'Comment ça marche',
    steps: [
      { n: '1', t: 'Choisissez la formule', d: 'Et la matière — 10 secondes.' },
      { n: '2', t: 'Créez le compte en 30s', d: 'Email, mot de passe, prénom. C’est tout.' },
      { n: '3', t: 'Contactez le prof', d: 'Message pré-rempli, il vous propose un créneau cette semaine. Vous payez après confirmation.' },
    ],
    whyTitle: 'Pourquoi EduKaraib',
    why: [
      { icon: 'GraduationCap', t: 'Profs caribéens vérifiés', d: 'Des profs qui connaissent la réalité d’ici — Guyane, Antilles, en ligne.' },
      { icon: 'Video', t: 'Visio ou présentiel', d: 'Depuis la maison ou près de chez vous, selon vos horaires.' },
      { icon: 'CreditCard', t: 'Paiement en 3x sans frais', d: 'Klarna, Apple Pay, Google Pay — au choix.' },
      { icon: 'ShieldCheck', t: 'Satisfait ou remboursé', d: 'Première séance remboursable en 1 clic depuis votre espace.' },
    ],
    /* Pas de témoignages inventés sur une page neuve : un concurrent lit ces
       pages, et la crédibilité est l’actif principal d’une marketplace de
       soutien scolaire. On affiche à la place des preuves vérifiables.
       À basculer sur de vrais avis (prénom + commune) dès les premières
       ventes rentrée. */
    testimonials: null,
    proofPoints: [
      { t: 'Le prof touche 100 % de son tarif', d: 'Notre commission s’ajoute au prix, elle n’est jamais prélevée sur le prof. C’est ce qui nous permet d’attirer les bons profs d’ici.' },
      { t: 'Paiement après confirmation du créneau', d: 'Vous échangez avec le prof, vous validez l’horaire, et seulement ensuite vous payez.' },
      { t: 'Facture téléchargeable immédiatement', d: 'Chaque paiement génère une facture PDF depuis votre espace.' },
      { t: 'Remboursement en 1 clic sur la première séance', d: 'Sans justification à fournir, depuis votre espace.' },
    ],
    faqTitle: 'Questions fréquentes',
    scarcity: (n) => `🔥 ${n} profs vérifiés prêts pour la rentrée`,
    finalCta: (phase) => (phase === 'notes'
      ? 'Une note qui décroche se rattrape maintenant.'
      : 'L’année se joue dans les premières semaines.'),
    stickyCta: 'Choisir ma formule',
  },
};
