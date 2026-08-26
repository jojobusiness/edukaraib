// Tests des landings de campagne (`/bac`, `/rentree`) et du moteur commun.
//
// Ce qu'on protège ici, dans l'ordre d'importance business :
//   1. Les valeurs `pack` (0/5/10) — elles sont la clé du tunnel de paiement.
//      Les renommer casserait l'encaissement en silence.
//   2. L'absence de témoignages fabriqués sur une campagne neuve.
//   3. Les matières affichées : un bouton de matière qui ne correspond à aucun
//      libellé de prof envoie l'utilisateur sur une liste sans rapport.
//   4. La cohérence des phases datées (un hero pour chaque phase possible).

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { rendre } from './rendre';
import { BAC_CAMPAIGN, RENTREE_CAMPAIGN } from '../config/campaigns';
import { subjectMatches, normalizeSubject } from '../lib/subjectMatch';
import { nbCreneaux } from '../components/CampaignLanding';
import Rentree from '../pages/Rentree';
import Bac from '../pages/Bac';

const CAMPAGNES = [
  ['bac', BAC_CAMPAIGN],
  ['rentree', RENTREE_CAMPAIGN],
];

describe.each(CAMPAGNES)('config campagne « %s »', (nom, config) => {
  it('garde les valeurs de pack attendues par le tunnel de paiement', () => {
    // create-checkout-session.mjs raisonne sur ces entiers : 0 = cours à
    // l'unité, 5 = pack 5h, 10 = pack 10h. Toute autre valeur = paiement cassé.
    expect(config.packs.map((p) => p.pack)).toEqual([0, 5, 10]);
  });

  it('met exactement un pack en avant', () => {
    expect(config.packs.filter((p) => p.highlight)).toHaveLength(1);
  });

  it('a un hero pour chacune des phases que getPhase peut renvoyer', () => {
    // On balaie 14 mois autour de la campagne : toute phase atteignable doit
    // avoir son hero, sinon la page s'affiche sans titre le jour de la bascule.
    const debut = new Date('2026-01-01T00:00:00Z').getTime();
    for (let jour = 0; jour < 430; jour += 1) {
      const phase = config.getPhase(new Date(debut + jour * 86400000));
      expect(config.heroes[phase], `${nom} : phase « ${phase} » sans hero`).toBeTruthy();
    }
  });

  it('déclare une URL SEO cohérente avec son identifiant', () => {
    expect(config.seo.url).toContain(config.id === 'bac' ? '/bac' : '/rentree');
    expect(config.seo.title.length).toBeLessThanOrEqual(70);
  });

  it('affiche soit de vrais témoignages, soit des preuves vérifiables', () => {
    const { testimonials, proofPoints } = config.copy;
    expect(Boolean(testimonials?.length) || Boolean(proofPoints?.length)).toBe(true);
  });
});

describe('campagne rentrée — alignement sur l’offre réelle', () => {
  it('ne propose aucune matière sans prof réservable (constats 20/08 et 26/08)', () => {
    // Règle : une matière ne reste dans la config que si au moins un prof qui la
    // couvre est RÉSERVABLE (affichable + au moins un créneau coché).
    //   20/08 : SVT, Histoire-Géo, « Aide aux devoirs » — aucun prof.
    //   26/08 : Informatique — un prof la déclare depuis ce jour, mais sans
    //           aucun créneau, donc 0 réservable.
    // Le contrôle vivant est `node scripts/diag-offre-profs.mjs`.
    const sansProfReservable = ['SVT', 'Histoire-Géo', 'Aide aux devoirs', 'Informatique'];
    for (const matiere of sansProfReservable) {
      expect(RENTREE_CAMPAIGN.subjects).not.toContain(matiere);
    }
  });

  it('annonce des profs disponibles sans jamais gonfler le chiffre', () => {
    // Le compteur reçoit deux nombres réels et ne doit pas présenter des profs
    // simplement « vérifiés » comme étant disponibles.
    const avecDispos = RENTREE_CAMPAIGN.copy.scarcity({ verifies: 12, disponibles: 5 });
    expect(avecDispos).toContain('12');
    expect(avecDispos).toContain('5');

    // Cas limite : aucun prof avec créneau → ne rien affirmer sur la dispo.
    const sansDispo = RENTREE_CAMPAIGN.copy.scarcity({ verifies: 12, disponibles: 0 });
    expect(sansDispo).toContain('12');
    expect(sansDispo).not.toMatch(/disponible|créneau/i);
    expect(sansDispo).not.toContain('0 ');
  });

  it('met en avant le pack 10h (marge plateforme doublée vs le 5h)', () => {
    expect(RENTREE_CAMPAIGN.packs.find((p) => p.highlight).pack).toBe(10);
  });

  it('n’affiche aucun témoignage fabriqué', () => {
    expect(RENTREE_CAMPAIGN.copy.testimonials).toBeFalsy();
    expect(RENTREE_CAMPAIGN.copy.proofPoints.length).toBeGreaterThan(0);
  });

  it('vouvoie partout — le payeur est le parent, pas l’élève', () => {
    // Un mélange tutoiement/vouvoiement dans la même page se voit et décrédibilise.
    const textes = [
      ...Object.values(RENTREE_CAMPAIGN.heroes).flatMap((h) => [h.title, h.subtitle]),
      ...RENTREE_CAMPAIGN.packs.flatMap((p) => [p.tagline, ...p.points, p.discount, p.cta]),
      ...RENTREE_CAMPAIGN.faq.flatMap((f) => [f.q, f.a]),
      ...RENTREE_CAMPAIGN.copy.steps.flatMap((s) => [s.t, s.d]),
      ...RENTREE_CAMPAIGN.copy.why.flatMap((w) => [w.t, w.d]),
      RENTREE_CAMPAIGN.copy.profsSubtitle,
      RENTREE_CAMPAIGN.copy.subjectsNote,
    ];
    // « tu / ton / ta / tes / toi » en mot isolé = tutoiement résiduel.
    // Frontières unicode obligatoires : le `\b` de JS coupe sur les lettres
    // accentuées, donc « êtes » se lit « ê | tes » et déclenche un faux positif.
    const tutoiement = /(?<!\p{L})(tu|ton|ta|tes|toi)(?!\p{L})/iu;
    for (const texte of textes) {
      expect(tutoiement.test(texte), `tutoiement résiduel : « ${texte} »`).toBe(false);
    }
  });

  it('a des libellés de matière qui correspondent aux profs réels', () => {
    // Échantillon des libellés exacts saisis par les profs (relevé du 20/08).
    const libellesReels = [
      'Math, Physique',
      'Maths financières / comptabilité',
      'Maths, Physique chimie, Francais,',
      'Physique, Chimie',
      'Comptabilité; mathématiques financières',
      'Economie, droit, ressources humaines, management, marketing',
      'Anglais, français, espagnol, comptabilité, RH, contrôle de gestion',
      'Maths',
    ].join(' | ');

    for (const matiere of RENTREE_CAMPAIGN.subjects) {
      expect(
        subjectMatches(matiere, libellesReels),
        `« ${matiere} » ne correspond à aucun libellé prof connu`,
      ).toBe(true);
    }
  });
});

describe('classement des profs par disponibilité réelle', () => {
  it('compte les créneaux quel que soit le format d’availability', () => {
    // Le champ mélange l'ancien et le nouveau format dans la même base.
    expect(nbCreneaux(undefined)).toBe(0);
    expect(nbCreneaux(null)).toBe(0);
    expect(nbCreneaux([])).toBe(0);
    expect(nbCreneaux(['lundi-18h', 'mardi-18h'])).toBe(2);
    expect(nbCreneaux({ lundi: ['18h', '19h'], mardi: ['18h'] })).toBe(3);
    expect(nbCreneaux({ lundi: true, mardi: false })).toBe(1);
  });

  it('fait remonter les profs réservables avant les mieux notés', () => {
    // Mesure du 26/08 : sur « Maths », 9 profs affichés pour 3 réservables. Un
    // prof très bien noté mais sans créneau ne doit plus passer devant un prof
    // réservable — le parent est décidé, il ne doit pas tomber sur un mur.
    const profs = [
      { id: 'a', reviewsCount: 8, avgRating: 5, reservable: false },
      { id: 'b', reviewsCount: 0, avgRating: 0, reservable: true },
      { id: 'c', reviewsCount: 10, avgRating: 5, reservable: true },
    ];
    const trie = [...profs].sort((x, y) => {
      if (x.reservable !== y.reservable) return x.reservable ? -1 : 1;
      const cx = x.reviewsCount >= 5 ? 1 : 0;
      const cy = y.reviewsCount >= 5 ? 1 : 0;
      if (cx !== cy) return cy - cx;
      return y.avgRating - x.avgRating;
    });
    expect(trie.map((p) => p.id)).toEqual(['c', 'b', 'a']);
    // Et surtout : personne n'a disparu.
    expect(trie).toHaveLength(profs.length);
  });
});

describe('correspondance des matières (lib/subjectMatch)', () => {
  it('ignore les accents et la ponctuation', () => {
    expect(normalizeSubject('Économie-Droit')).toBe('economie droit');
    expect(normalizeSubject('Physique-Chimie')).toBe('physique chimie');
  });

  it.each([
    ['Maths', 'Mathématiques', true],
    ['Maths', 'Math, Physique', true],
    ['Physique-Chimie', 'Physique, Chimie', true],
    ['Physique-Chimie', 'Physique chimie', true],
    ['Français', 'Maths, Physique chimie, Francais,', true],
    ['Comptabilité', 'Comptabilité; mathématiques financières', true],
    ['Économie-Droit', 'Economie, droit, management', true],
    ['SVT', 'Maths', false],
    ['Anglais', 'Maths, Français', false],
    // jeton '=rh' : mot entier obligatoire (sigle trop court pour un includes nu)
    ['Économie-Droit', 'Anglais, comptabilité, RH, contrôle de gestion', true],
    ['Économie-Droit', 'rhétorique et rhinoplastie', false],
    ['Économie-Droit', 'marché du rhum', false],
  ])('« %s » vs « %s » → %s', (requete, libelle, attendu) => {
    expect(subjectMatches(requete, libelle)).toBe(attendu);
  });
});

describe('routage et référencement des landings', () => {
  // CLAUDE.md impose 3 vérifications pour toute nouvelle page : route déclarée,
  // lien footer/sitemap, rendu sans crash. Une page non routée est invisible
  // pour les utilisateurs ET pour Google — le test le rend impossible à oublier.
  const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8');

  it('déclare la route /rentree dans App.jsx', () => {
    expect(lire('../App.jsx')).toContain('path="/rentree"');
  });

  it('garde les routes /bac et /rattrapage intactes', () => {
    const app = lire('../App.jsx');
    expect(app).toContain('path="/bac"');
    expect(app).toContain('path="/rattrapage"');
  });

  it('lie /rentree depuis le footer', () => {
    expect(lire('../components/Footer.jsx')).toContain('to="/rentree"');
  });

  it('référence /rentree dans les deux sitemaps', () => {
    expect(lire('../../public/sitemap.xml')).toContain('edukaraib.com/rentree');
    expect(lire('../../api/sitemap.mjs')).toContain('edukaraib.com/rentree');
  });
});

describe('rendu des landings', () => {
  it('/rentree affiche le hero de la phase courante et les 3 formules', () => {
    rendre(<Rentree />, { route: '/rentree' });
    const phase = RENTREE_CAMPAIGN.getPhase();
    expect(screen.getByRole('heading', { level: 1 }).textContent)
      .toBe(RENTREE_CAMPAIGN.heroes[phase].title);
    for (const pack of RENTREE_CAMPAIGN.packs) {
      expect(screen.getByText(pack.name)).toBeTruthy();
    }
    expect(screen.getByText(RENTREE_CAMPAIGN.copy.badgeLabel)).toBeTruthy();
  });

  it('/bac rend toujours sa propre campagne après l’extraction en config', () => {
    rendre(<Bac />, { route: '/bac' });
    const phase = BAC_CAMPAIGN.getPhase();
    expect(screen.getByRole('heading', { level: 1 }).textContent)
      .toBe(BAC_CAMPAIGN.heroes[phase].title);
    expect(screen.getByText('Pack Intensif 5h')).toBeTruthy();
  });
});
