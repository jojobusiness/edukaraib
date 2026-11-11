// Guides publics : une question précise, une réponse citable (11/11/2026).
//
// Pourquoi. Sur Factur'Peyi, les seules inscrites venues seules arrivent par
// ChatGPT ; ici, le site est une SPA : un robot qui ne lance pas JavaScript ne
// voyait que <div id="root">. Ces guides sont prérendus en HTML
// (scripts/prerendu-guides.mjs) et listés dans /llms.txt.
// Plan : docs/plans/PLAN_PAGES_CHATGPT_11-11-2026.md.
//
// Règles (testées dans frontend/test/guides.test.js) :
//   · les prix sont LUS dans frontend/data/tarifsGuides.json, écrit depuis la
//     base par scripts/tarifs-guides.mjs (profs réservables) — jamais un prix
//     « du marché » inventé ;
//   · un guide qui affirme une règle (examen, aide, procédure) cite au moins
//     une source officielle ; pas de source = pas de phrase ;
//   · jamais « certifié », jamais de nombre de profs ou d'élèves, rien sur le
//     crédit d'impôt (retiré le 04/11/2026).
//
// Même source pour la page React (pages/Guide.jsx) et pour le prérendu.

import tarifs from '../data/tarifsGuides.json';

export const SITE = 'https://www.edukaraib.com';
export const MAJ_GUIDES = '2026-11-11';
export const dateMajFr = () => new Date(`${MAJ_GUIDES}T12:00:00Z`)
  .toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const { tarifMin, tarifMax, fraisParHeure } = tarifs;
/** « entre 20 et 40 € de l'heure » : la fourchette réelle des profs réservables. */
export const FOURCHETTE = `entre ${tarifMin} et ${tarifMax} € de l'heure`;
const PRIX_TOTAL = `soit ${tarifMin + fraisParHeure} à ${tarifMax + fraisParHeure} € par heure de cours au total`;

const S = {
  brevet: { label: 'education.gouv.fr — Le diplôme national du brevet', url: 'https://www.education.gouv.fr/le-diplome-national-du-brevet-10613' },
  examens2026: { label: 'info.gouv.fr — Examens 2026 : ce qui change pour les élèves', url: 'https://www.info.gouv.fr/actualite/examens-2026-ce-qui-change-pour-les-eleves' },
  parcoursup: { label: 'Parcoursup, plateforme officielle', url: 'https://www.parcoursup.gouv.fr/' },
  onisepPs: { label: 'Onisep — Parcoursup 2027 : calendrier et étapes de la procédure', url: 'https://www.onisep.fr/orientation/l-enseignement-superieur/parcoursup-2027/parcoursup-2027-calendrier-et-etapes-de-la-procedure' },
  ladom: { label: "LADOM — Passeport pour la mobilité des études", url: 'https://www.ladom.fr/vie-etudiante/pme/' },
  aidesUltramarins: { label: 'etudiant.gouv.fr — Les aides financières pour les étudiants ultramarins', url: 'https://www.etudiant.gouv.fr/fr/les-aides-financieres-pour-les-etudiants-ultramarins-3288' },
  aefe: { label: "AEFE — Agence pour l'enseignement français à l'étranger", url: 'https://www.aefe.fr/' },
  cned: { label: "CNED — Centre national d'enseignement à distance", url: 'https://www.cned.fr/' },
  dunlosky: { label: 'Dunlosky et al. (2013), « Improving Students’ Learning With Effective Learning Techniques », Psychological Science in the Public Interest, 14(1)' },
  roediger: { label: 'Roediger et Karpicke (2006), « Test-Enhanced Learning », Psychological Science, 17(3)' },
};

/** Ce que fait la plateforme : des faits du produit, identiques sur chaque guide. */
const COMMENT_CA_MARCHE = [
  'Vous choisissez un professeur selon la matière, le niveau et ses créneaux, et vous voyez son tarif avant de réserver.',
  `Chaque professeur fixe son tarif. La famille paie ce tarif plus ${fraisParHeure} € de frais de service par heure.`,
  'Le paiement se fait en ligne, avant le cours. Une facture est disponible après chaque paiement.',
  'Le cours a lieu à domicile, quand le professeur se déplace, ou en visio, directement depuis le site, sans logiciel à installer.',
];

const territoire = ({ cle, nom, en, fuseau }) => ({
  slug: `soutien-scolaire-en-ligne-${cle}`,
  territoires: [cle],
  affirmeRegle: false,
  titre: `Soutien scolaire en ligne ${en} : comment ça marche et combien ça coûte`,
  title: `Soutien scolaire en ligne ${en} : fonctionnement et prix — EduKaraib`,
  description: `Cours particuliers en visio ${en} : comment se passe un cours, combien il coûte (${FOURCHETTE} sur EduKaraib, plus ${fraisParHeure} € de frais) et comment choisir un professeur.`,
  reponse: `${en === 'à La Réunion' ? 'À La Réunion' : `En ${nom}`}, le soutien scolaire en ligne se fait en visio avec un professeur particulier, depuis un ordinateur ou une tablette. Sur EduKaraib, les professeurs réservables fixent leur tarif ${FOURCHETTE}, auquel s'ajoutent ${fraisParHeure} € de frais de service par heure ; la famille paie en ligne avant le cours et reçoit une facture.`,
  sections: [
    { titre: 'Comment se passe un cours en visio', liste: COMMENT_CA_MARCHE },
    { titre: 'Combien ça coûte', paragraphes: [
      `Sur EduKaraib, les tarifs des professeurs réservables vont aujourd'hui de ${tarifMin} à ${tarifMax} € de l'heure, auxquels s'ajoutent ${fraisParHeure} € de frais de service, ${PRIX_TOTAL}. Le tarif exact de chaque professeur est affiché sur sa page avant la réservation.`,
    ] },
    { titre: `Ce qu'il faut vérifier ${en}`, liste: [
      'Le niveau et la matière exacts : un professeur de maths de lycée n’est pas forcément le bon pour un élève de CM2.',
      `L'heure du cours : ${fuseau}. Convenez de l'heure avec le professeur en tenant compte du décalage si vous n'êtes pas dans le même territoire.`,
      'Une connexion stable, un casque ou des écouteurs, et un cahier à portée de main.',
    ] },
  ],
  faqs: [
    { q: 'Le cours en visio est-il aussi efficace qu’à domicile ?', a: 'Pour la plupart des matières écrites (maths, français, langues), le contenu du cours est le même. La visio évite les déplacements et élargit le choix de professeurs au-delà de sa commune.' },
    { q: 'Faut-il installer un logiciel ?', a: 'Non. Sur EduKaraib, la visio s’ouvre depuis le navigateur, sur la page du cours.' },
    { q: 'Peut-on payer plusieurs heures d’un coup ?', a: 'Oui, des packs de 5 h et de 10 h sont proposés sur la page du professeur.' },
  ],
  sources: [],
  cta: 'search',
});

export const GUIDES = [
  territoire({ cle: 'guadeloupe', nom: 'Guadeloupe', en: 'en Guadeloupe', fuseau: "la Guadeloupe est à UTC−4, comme la Martinique" }),
  territoire({ cle: 'martinique', nom: 'Martinique', en: 'en Martinique', fuseau: "la Martinique est à UTC−4, comme la Guadeloupe" }),
  territoire({ cle: 'guyane', nom: 'Guyane', en: 'en Guyane', fuseau: 'la Guyane est à UTC−3, une heure de plus que les Antilles' }),
  territoire({ cle: 'reunion', nom: 'La Réunion', en: 'à La Réunion', fuseau: 'La Réunion est à UTC+4, huit heures de plus que les Antilles' }),

  {
    slug: 'prix-cours-particuliers-dom',
    territoires: ['guadeloupe', 'martinique', 'guyane', 'reunion'],
    affirmeRegle: false,
    titre: 'Combien coûte un cours particulier aux Antilles, en Guyane et à La Réunion ?',
    title: 'Prix d’un cours particulier dans les DOM — EduKaraib',
    description: `Prix réels d'un cours particulier sur EduKaraib : ${FOURCHETTE} selon le professeur, plus ${fraisParHeure} € de frais de service. Ce qui fait varier le prix et comment payer moins.`,
    reponse: `Sur EduKaraib, un cours particulier coûte le tarif du professeur, aujourd'hui ${FOURCHETTE} pour les professeurs réservables, plus ${fraisParHeure} € de frais de service par heure, ${PRIX_TOTAL}. Le prix est affiché avant la réservation et se paie en ligne, avant le cours.`,
    sections: [
      { titre: 'Ce qui fait varier le prix', liste: [
        'Le niveau : un cours de lycée ou de supérieur est en général plus cher qu’un cours de primaire.',
        'La matière et l’expérience du professeur : chaque professeur fixe librement son tarif.',
        'Le mode : certains professeurs ont un tarif différent en visio et à domicile.',
      ] },
      { titre: 'Comment payer moins', liste: [
        'Les packs de 5 h et de 10 h, proposés sur la page de chaque professeur.',
        'Les cours en visio, qui évitent les frais de déplacement du professeur.',
      ] },
      { titre: 'D’où viennent ces chiffres', paragraphes: [
        `La fourchette est celle des tarifs horaires des professeurs réservables sur EduKaraib, relevée le ${new Date(`${tarifs.majLe}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}. Ce n’est pas une moyenne du marché.`,
      ] },
    ],
    faqs: [
      { q: 'Les frais de service sont-ils payés par le professeur ?', a: `Non. Le professeur touche son tarif ; les ${fraisParHeure} € de frais de service par heure sont payés par la famille, en plus.` },
      { q: 'Quand paie-t-on ?', a: 'En ligne, au moment de la réservation, avant le cours. Une facture est disponible après le paiement.' },
    ],
    sources: [],
    cta: 'search',
  },

  {
    slug: 'prof-de-maths-en-ligne-college',
    territoires: ['guadeloupe', 'martinique', 'guyane', 'reunion', 'afrique'],
    affirmeRegle: false,
    titre: 'Trouver un prof de maths en ligne pour un collégien',
    title: 'Prof de maths en ligne pour un collégien — EduKaraib',
    description: 'Comment choisir un professeur de maths en visio pour un élève de la 6e à la 3e, à quel rythme, et à quoi ressemble une bonne séance.',
    reponse: `Pour un collégien, le bon professeur de maths en ligne est celui qui enseigne au niveau collège, qui reprend les exercices de la classe et qui fait travailler l'élève pendant la séance au lieu de faire à sa place. Une séance d'une heure par semaine suffit souvent à reprendre pied ; sur EduKaraib, les tarifs vont ${FOURCHETTE}, plus ${fraisParHeure} € de frais.`,
    sections: [
      { titre: 'Les questions à poser avant de réserver', liste: [
        'Le professeur enseigne-t-il au collège, et à quel niveau précis (6e, 4e, 3e) ?',
        'Travaille-t-il à partir du cahier et des contrôles de l’élève ?',
        'Propose-t-il des exercices entre deux séances ?',
      ] },
      { titre: 'À quoi ressemble une bonne séance', liste: [
        'L’élève refait un exercice raté, à voix haute, pendant que le professeur l’écoute raisonner.',
        'Le professeur corrige la méthode, pas seulement le résultat.',
        'La séance se termine par 2 ou 3 exercices du niveau du prochain contrôle.',
      ] },
      { titre: 'Le rythme', paragraphes: [
        'Une heure par semaine, régulière, vaut mieux que trois heures la veille d’un contrôle. Avant le brevet, on peut passer à deux séances par semaine sur les dernières semaines.',
      ] },
    ],
    faqs: [
      { q: 'Les maths en visio, ça marche pour un collégien ?', a: 'Oui, si l’élève a un cahier ouvert et une caméra : le professeur voit ce qu’il écrit et le fait travailler en direct.' },
      { q: 'Faut-il prendre un pack ?', a: 'Un pack de 5 h ou de 10 h revient moins cher à l’heure si le rythme est hebdomadaire. Faites d’abord un cours pour vérifier que le professeur convient.' },
    ],
    sources: [],
    cta: 'search',
  },

  {
    slug: 'aide-aux-devoirs-en-visio',
    territoires: ['guadeloupe', 'martinique', 'guyane', 'reunion', 'afrique'],
    affirmeRegle: false,
    titre: 'Aide aux devoirs en visio : comment se passe un cours',
    title: 'Aide aux devoirs en visio : déroulé d’un cours — EduKaraib',
    description: 'Ce qu’il faut pour un cours d’aide aux devoirs en visio, son déroulé, et comment savoir si ça marche.',
    reponse: 'Un cours d’aide aux devoirs en visio se passe comme à la maison : l’élève montre ses devoirs à la caméra, le professeur l’aide à les faire lui-même, puis vérifie qu’il sait refaire seul. Il faut un ordinateur ou une tablette avec caméra, une connexion stable et le cahier de textes ouvert.',
    sections: [
      { titre: 'Le matériel', liste: [
        'Un ordinateur ou une tablette avec caméra et micro.',
        'Un casque ou des écouteurs si la maison est bruyante.',
        'Le cahier de textes, les cahiers et le manuel à portée de main.',
      ] },
      { titre: 'Le déroulé d’une heure', liste: [
        '5 minutes : ce qu’il y a à faire pour les jours qui viennent.',
        '40 minutes : les devoirs, faits par l’élève, le professeur guide sans donner la réponse.',
        '15 minutes : l’élève refait seul un exercice proche, pour vérifier qu’il a compris.',
      ] },
      { titre: 'Comment savoir si ça marche', paragraphes: [
        'Au bout de quelques semaines, l’élève fait une partie de ses devoirs seul et les notes des contrôles remontent. Si rien ne bouge après un mois, parlez-en au professeur : le rythme ou la méthode doivent changer.',
      ] },
    ],
    faqs: [
      { q: 'Le parent doit-il être présent ?', a: 'Pas forcément, mais il est utile qu’il soit là au début du premier cours pour présenter les difficultés de l’enfant.' },
      { q: 'Faut-il installer un logiciel ?', a: 'Non. Sur EduKaraib, la visio s’ouvre depuis le navigateur, sur la page du cours.' },
    ],
    sources: [],
    cta: 'search',
  },

  {
    slug: 'comment-reviser-et-retenir-ses-lecons',
    territoires: [],
    affirmeRegle: false,
    titre: 'Comment réviser et retenir ses leçons',
    title: 'Comment réviser et retenir ses leçons : la méthode — EduKaraib',
    description: 'Pourquoi relire ne suffit pas, et les techniques qui marchent : se tester, espacer les révisions, la page blanche, expliquer à quelqu’un.',
    reponse: 'Pour retenir une leçon, il faut se tester plutôt que la relire : fermer le cahier, écrire ou réciter ce dont on se souvient, puis vérifier. Les révisions doivent être espacées dans le temps (le lendemain, quelques jours après, puis la semaine suivante) : les études en psychologie de l’apprentissage montrent que ces deux techniques sont parmi les plus efficaces.',
    sections: [
      { titre: 'Pourquoi relire ne suffit pas', paragraphes: [
        'Relire donne l’impression de connaître sa leçon parce qu’on la reconnaît. Mais au contrôle, il faut la retrouver de mémoire, sans le cahier : c’est cela qu’il faut entraîner.',
      ] },
      { titre: 'Les techniques qui marchent', liste: [
        'La page blanche : cahier fermé, écrire tout ce dont on se souvient, puis compléter en couleur ce qui manquait.',
        'La répétition espacée : revoir la leçon le lendemain, puis 3 jours après, puis 1 semaine après.',
        'Expliquer à quelqu’un : si on ne sait pas l’expliquer simplement, on ne l’a pas encore compris.',
        'Faire des exercices du niveau du contrôle, pas seulement ceux du cours.',
      ] },
      { titre: 'Un planning simple pour un contrôle dans une semaine', liste: [
        'J−7 : page blanche sur toute la leçon, repérer les trous.',
        'J−5 : exercices sur les points faibles.',
        'J−3 : nouvelle page blanche, plus courte.',
        'J−1 : 2 ou 3 exercices type contrôle, puis dormir.',
      ] },
    ],
    faqs: [
      { q: 'Faire des fiches, c’est utile ?', a: 'Oui si la fiche sert ensuite à se tester (on cache, on récite). Recopier le cours sans se tester est peu efficace.' },
      { q: 'Combien de temps réviser par jour ?', a: 'Des séances courtes et régulières, de 20 à 30 minutes, valent mieux qu’une longue séance la veille.' },
    ],
    sources: [S.dunlosky, S.roediger],
    cta: 'methode',
  },

  {
    slug: 'preparer-le-brevet',
    territoires: ['guadeloupe', 'martinique', 'guyane', 'reunion', 'afrique'],
    affirmeRegle: true,
    titre: 'Préparer le brevet : comment s’organiser',
    title: 'Préparer le brevet : calendrier de révision — EduKaraib',
    description: 'Comment le brevet est noté depuis la session 2026, et un calendrier de révision de janvier à juin pour un élève de 3e.',
    reponse: 'Depuis la session 2026, le brevet est noté à 60 % sur les épreuves finales et à 40 % sur le contrôle continu de 3e, et il faut au moins 10/20 de moyenne pour l’obtenir. Les épreuves écrites ont lieu fin juin : il vaut mieux commencer à réviser les épreuves dès janvier, à raison de quelques séances courtes par semaine.',
    sections: [
      { titre: 'Comment le brevet est noté', liste: [
        'Épreuves finales : 60 % de la note.',
        'Contrôle continu : 40 % de la note, à partir des moyennes de 3e.',
        'Le diplôme est obtenu avec une moyenne d’au moins 10/20.',
      ] },
      { titre: 'Un calendrier de janvier à juin', liste: [
        'Janvier–février : repérer les chapitres faibles en maths et en français, une séance de 30 minutes par matière et par semaine.',
        'Mars–avril : sujets des années précédentes, chronométrés, une fois par semaine.',
        'Mai : revoir les sujets ratés, page blanche sur les cours.',
        'Juin : deux sujets complets dans les conditions de l’examen, puis repos la veille.',
      ] },
      { titre: 'Les dates exactes', paragraphes: [
        'Les dates de chaque session sont publiées par le ministère de l’Éducation nationale. Vérifiez-les sur la page officielle du brevet avant de bâtir votre planning.',
      ] },
    ],
    faqs: [
      { q: 'Le contrôle continu compte-t-il encore ?', a: 'Oui, pour 40 % de la note depuis la session 2026 : les moyennes de 3e comptent, il ne faut pas les négliger.' },
      { q: 'Y a-t-il un rattrapage ?', a: 'Non. Un candidat qui n’obtient pas le brevet peut le repasser l’année suivante.' },
    ],
    sources: [S.brevet, S.examens2026],
    cta: 'search',
  },

  {
    slug: 'bac-parcoursup-depuis-les-dom',
    territoires: ['guadeloupe', 'martinique', 'guyane', 'reunion'],
    affirmeRegle: true,
    titre: 'Bac et Parcoursup depuis les DOM : les étapes',
    title: 'Parcoursup depuis les DOM : étapes et aides — EduKaraib',
    description: 'Les étapes de Parcoursup (inscription, vœux, confirmation, admission) pour un lycéen des Antilles, de Guyane ou de La Réunion, et l’aide de LADOM pour partir étudier.',
    reponse: 'Depuis les DOM, Parcoursup se déroule comme en métropole : inscription et vœux de janvier à mars, confirmation des vœux avant début avril, réponses à partir de juin. Un élève qui doit partir parce que sa formation n’existe pas ou est saturée sur son territoire peut demander le Passeport pour la mobilité des études de LADOM, qui prend en charge le billet de la première année.',
    sections: [
      { titre: 'Les étapes de Parcoursup', liste: [
        'Janvier : ouverture de la plateforme, inscription.',
        'Janvier à mars : formulation des vœux.',
        'Jusqu’à début avril : compléter le dossier et confirmer chaque vœu. Un vœu non confirmé est supprimé.',
        'À partir de juin : réponses des formations, phase d’admission, puis phase complémentaire.',
      ] },
      { titre: 'Partir étudier : l’aide de LADOM', paragraphes: [
        'Le Passeport pour la mobilité des études (PME) de LADOM concerne les étudiants de moins de 28 ans, bacheliers, dont la formation est inexistante ou saturée sur leur territoire. Il porte sur la première année d’études supérieures, sous conditions ; la demande se fait sur le site de LADOM.',
      ] },
      { titre: 'Les dates exactes', paragraphes: [
        'Le calendrier change chaque année : vérifiez les dates de votre session sur parcoursup.gouv.fr.',
      ] },
    ],
    faqs: [
      { q: 'Faut-il confirmer ses vœux ?', a: 'Oui. Formuler un vœu ne suffit pas : chaque vœu doit être confirmé avant la date limite, sinon il est supprimé.' },
      { q: 'Existe-t-il d’autres aides pour les étudiants ultramarins ?', a: 'Oui, le site etudiant.gouv.fr recense les aides financières destinées aux étudiants ultramarins.' },
    ],
    sources: [S.parcoursup, S.onisepPs, S.ladom, S.aidesUltramarins],
    cta: 'search',
  },

  {
    slug: 'soutien-scolaire-lycee-francais-afrique',
    territoires: ['afrique'],
    affirmeRegle: true,
    titre: 'Soutien scolaire en ligne pour les élèves des lycées français en Afrique',
    title: 'Soutien scolaire en ligne, lycées français en Afrique — EduKaraib',
    description: 'Cours particuliers en visio sur le programme français pour les élèves scolarisés dans un établissement français en Afrique : fonctionnement, prix, décalage horaire.',
    reponse: `Les établissements français à l'étranger du réseau de l'AEFE suivent les programmes français : un élève scolarisé en Afrique peut donc prendre des cours particuliers en visio avec un professeur qui enseigne ce programme. Sur EduKaraib, les tarifs vont ${FOURCHETTE}, plus ${fraisParHeure} € de frais, payés en ligne avant le cours.`,
    sections: [
      { titre: 'Pourquoi la visio', paragraphes: [
        'Les professeurs qui connaissent le programme français ne sont pas toujours disponibles sur place. La visio permet de travailler avec eux à distance, sur les mêmes chapitres et les mêmes types d’évaluations que la classe.',
      ] },
      { titre: 'Comment ça marche', liste: COMMENT_CA_MARCHE },
      { titre: 'Le décalage horaire', paragraphes: [
        'Les Antilles sont à UTC−4 et la Guyane à UTC−3 : avec l’Afrique de l’Ouest (UTC+0) ou centrale (UTC+1), l’écart est de 3 à 5 heures. Un cours en fin d’après-midi en Afrique tombe en fin de matinée ou en début d’après-midi aux Antilles : convenez de l’heure avec le professeur.',
      ] },
    ],
    faqs: [
      { q: 'Le CNED est-il une alternative ?', a: 'Le CNED propose un enseignement à distance complet ; les cours particuliers servent plutôt de soutien en plus de la classe.' },
      { q: 'Comment payer depuis l’étranger ?', a: 'Par carte bancaire en ligne, au moment de la réservation.' },
    ],
    sources: [S.aefe, S.cned],
    cta: 'search',
  },

  {
    slug: 'calcul-moyenne-trimestre',
    territoires: [],
    affirmeRegle: false,
    titre: 'Comment calculer sa moyenne, et la note qu’il faut au prochain contrôle',
    title: 'Calculer sa moyenne et la note à viser — EduKaraib',
    description: 'La formule de la moyenne avec coefficients, un exemple chiffré, et la formule pour savoir quelle note viser au prochain contrôle.',
    reponse: 'La moyenne avec coefficients se calcule en multipliant chaque note par son coefficient, en additionnant ces produits, puis en divisant par la somme des coefficients. Pour savoir quelle note viser au prochain contrôle : (moyenne visée × total des coefficients après ce contrôle − somme actuelle des notes × coefficients) ÷ coefficient du contrôle.',
    sections: [
      { titre: 'Un exemple', paragraphes: [
        'Notes : 12 (coef. 1), 8 (coef. 2) et 14 (coef. 1). Somme des produits : 12 + 16 + 14 = 42. Somme des coefficients : 4. Moyenne : 42 ÷ 4 = 10,5.',
      ] },
      { titre: 'La note à viser', paragraphes: [
        'Pour passer à 11 de moyenne avec un prochain contrôle de coefficient 2 : le total des coefficients devient 6, il faut 11 × 6 = 66 points, on en a 42, il manque 24 points, soit 24 ÷ 2 = 12/20 à ce contrôle.',
      ] },
      { titre: 'À savoir', paragraphes: [
        'Les coefficients sont fixés par chaque professeur : demandez-les en début de trimestre. La moyenne affichée par l’établissement fait foi.',
      ] },
    ],
    faqs: [
      { q: 'Et si la note à viser dépasse 20 ?', a: 'Alors la moyenne visée n’est pas atteignable avec un seul contrôle : il faut compter sur les suivants.' },
    ],
    sources: [],
    cta: 'search',
  },
];

/** Domaines acceptés comme source officielle (testé). */
export const DOMAINES_OFFICIELS = [
  'education.gouv.fr', 'info.gouv.fr', 'parcoursup.gouv.fr', 'onisep.fr', 'ladom.fr',
  'etudiant.gouv.fr', 'aefe.fr', 'cned.fr', 'service-public.fr', 'eduscol.education.fr',
];

export const guideParSlug = (slug) => GUIDES.find((g) => g.slug === slug) || null;
export const guidesDuTerritoire = (cle) => GUIDES.filter((g) => g.territoires.includes(cle));
export const urlGuide = (slug) => `${SITE}/guides/${slug}`;

/** Lien suivi : chaque visite venue d'un guide se lit dans l'admin (acquisition). */
export const lienGuide = (g) => {
  const utm = `utm_source=guide&utm_medium=seo&utm_campaign=${encodeURIComponent(g.slug)}`;
  return g.cta === 'methode' ? `/methode?${utm}` : `/search?${utm}`;
};

/** JSON-LD Article + FAQPage (lu par les moteurs et les assistants). */
export function jsonLdGuide(g) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: g.titre,
      description: g.description,
      dateModified: MAJ_GUIDES,
      inLanguage: 'fr-FR',
      mainEntityOfPage: urlGuide(g.slug),
      author: { '@type': 'Organization', name: 'EduKaraib', url: SITE },
      publisher: { '@type': 'Organization', name: 'EduKaraib', url: SITE },
      ...(g.sources.length ? { citation: g.sources.map((s) => s.url || s.label) } : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [{ q: g.titre, a: g.reponse }, ...g.faqs].map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ];
}
