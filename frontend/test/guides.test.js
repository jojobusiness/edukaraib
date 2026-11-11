// Guides publics (11/11/2026) : ce qu'un assistant comme ChatGPT va citer mot
// pour mot. Une erreur ici se répète chez tous les lecteurs : rien sans source,
// aucun prix recopié à la main.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GUIDES, DOMAINES_OFFICIELS, guideParSlug, jsonLdGuide, FOURCHETTE } from '../lib/guides';
import { GUIDES_SLUGS } from '../data/guidesSlugs';
import tarifs from '../data/tarifsGuides.json';
import { corpsGuide, llmsTxt, pagesLocales, propsPageLocale } from '../../scripts/prerendu-guides.mjs';

const texte = (g) => [g.titre, g.title, g.description, g.reponse,
  ...g.sections.flatMap((s) => [s.titre, ...(s.paragraphes || []), ...(s.liste || [])]),
  ...g.faqs.flatMap((f) => [f.q, f.a])].join('\n');

describe('guides publics', () => {
  it('12 guides, slugs uniques, réponse courte et citable', () => {
    expect(GUIDES.length).toBe(12);
    expect(new Set(GUIDES.map((g) => g.slug)).size).toBe(GUIDES.length);
    for (const g of GUIDES) expect(g.reponse.length, g.slug).toBeLessThanOrEqual(520);
  });

  it('un guide qui affirme une règle cite au moins une source officielle', () => {
    for (const g of GUIDES) {
      if (g.affirmeRegle) expect(g.sources.filter((s) => s.url).length, g.slug).toBeGreaterThan(0);
      for (const s of g.sources.filter((x) => x.url)) {
        const hote = new URL(s.url).hostname.replace(/^www\./, '');
        expect(DOMAINES_OFFICIELS.some((d) => hote === d || hote.endsWith(`.${d}`)), `${g.slug} : ${s.url}`).toBe(true);
      }
    }
    // Test de casse : sans ses sources, le guide du brevet doit être refusé
    const sansSource = { ...guideParSlug('preparer-le-brevet'), sources: [] };
    expect(sansSource.affirmeRegle && sansSource.sources.filter((s) => s.url).length === 0).toBe(true);
  });

  it('les prix cités sont ceux lus dans la base, jamais tapés à la main', () => {
    expect(FOURCHETTE).toBe(`entre ${tarifs.tarifMin} et ${tarifs.tarifMax} € de l'heure`);
    for (const g of GUIDES) {
      const prix = texte(g).match(/\d+\s?€/g) || [];
      const autorises = new Set([tarifs.tarifMin, tarifs.tarifMax, tarifs.fraisParHeure,
        tarifs.tarifMin + tarifs.fraisParHeure, tarifs.tarifMax + tarifs.fraisParHeure].map(String));
      for (const p of prix) expect(autorises.has(p.replace(/\D/g, '')), `${g.slug} : ${p}`).toBe(true);
    }
  });

  it('aucune promesse interdite (certifié, crédit d’impôt, nombre de profs)', () => {
    for (const g of GUIDES) {
      const t = texte(g);
      expect(t, g.slug).not.toMatch(/certifi|crédit d.impôt|déductible|\d+\s+(professeurs|profs|élèves|familles)/i);
    }
  });

  it('la liste du sitemap = les guides', () => {
    expect(GUIDES_SLUGS).toEqual(GUIDES.map((g) => g.slug));
    expect(readFileSync('api/sitemap.mjs', 'utf8')).toContain('GUIDES_SLUGS');
  });

  it('le prérendu donne aux robots le titre, la réponse et le JSON-LD ; llms.txt liste tout', () => {
    for (const g of GUIDES) {
      const html = corpsGuide(g);
      expect(html).toContain('<h1>');
      expect(html).toContain('La réponse');
      expect(html).toContain('utm_source=guide');
      if (g.sources.length) expect(html).toContain('Sources');
      expect(jsonLdGuide(g).map((j) => j['@type'])).toEqual(['Article', 'FAQPage']);
    }
    const locales = pagesLocales();
    expect(locales.length).toBe(11);
    const llms = llmsTxt(locales);
    for (const g of GUIDES) expect(llms).toContain(`/guides/${g.slug}`);
    expect(llms).toContain('/cours-particuliers-guyane');
  });

  it('lecture des props des pages locales', () => {
    expect(propsPageLocale('<X title="T" description="D" urlPath="/u" heading="H" subheading="S" />'))
      .toEqual({ title: 'T', description: 'D', urlPath: '/u', heading: 'H', subheading: 'S' });
  });

  it('routes et lien du pied de page', () => {
    const app = readFileSync('frontend/App.jsx', 'utf8');
    expect(app).toContain('path="/guides"');
    expect(app).toContain('path="/guides/:slug"');
    expect(readFileSync('frontend/components/Footer.jsx', 'utf8')).toContain('to="/guides"');
    expect(readFileSync('vercel.json', 'utf8')).toContain('"handle": "filesystem"');
  });
});
