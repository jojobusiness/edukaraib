// Prérendu des guides et des pages locales (11/11/2026).
//
// Pourquoi. EduKaraib est une SPA : un robot qui ne lance pas JavaScript
// (beaucoup d'assistants, dont ceux de ChatGPT) ne voyait que <div id="root">,
// avec le titre générique d'index.html sur TOUTES les pages. Rien à citer.
//
// Ce que fait ce plugin Vite, après le build :
//   · dist/guides/<slug>/index.html : titre, description, canonique, JSON-LD
//     (Article + FAQPage) et le TEXTE du guide en dur ;
//   · dist/guides/index.html ;
//   · dist/<page-locale>/index.html pour les 11 pages de frontend/pages/seo :
//     en-tête propre (titre, description, canonique) + titre et accroche.
//     Pas leur FAQ : elle contient des affirmations à revoir avant d'être citée ;
//   · dist/llms.txt : l'index que les assistants savent lire.
// Même source que la page React (frontend/lib/guides.js) : pas de divergence.
//
// Le texte est placé dans #root : React le remplace au premier rendu.
// Servi grâce à { "handle": "filesystem" } dans vercel.json, placé AVANT la
// réécriture vers index.html : un fichier réel passe avant la SPA ; sans
// fichier, on retombe sur la SPA (aucune régression possible).

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GUIDES, SITE, jsonLdGuide, urlGuide, dateMajFr, lienGuide } from '../frontend/lib/guides.js';

const ech = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Un </script> dans une donnée fermerait la balise JSON-LD.
const echJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const STYLE = 'max-width:48rem;margin:0 auto;padding:2rem 1rem;font-family:system-ui,sans-serif;color:#111827';

function enTete({ title, description, url, type = 'website', jsonLd = [] }) {
  return [
    `<title>${ech(title)}</title>`,
    `<meta name="description" content="${ech(description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:title" content="${ech(title)}" />`,
    `<meta property="og:description" content="${ech(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    ...jsonLd.map((j) => `<script type="application/ld+json">${echJson(j)}</script>`),
  ].join('\n    ');
}

export function corpsGuide(g) {
  const sections = g.sections.map((s) => `<h2>${ech(s.titre)}</h2>`
    + (s.paragraphes || []).map((p) => `<p>${ech(p)}</p>`).join('')
    + (s.liste ? `<ul>${s.liste.map((l) => `<li>${ech(l)}</li>`).join('')}</ul>` : '')).join('\n      ');
  const faqs = g.faqs.map((f) => `<dt>${ech(f.q)}</dt><dd>${ech(f.a)}</dd>`).join('');
  const sources = g.sources.map((s) => `<li>${s.url ? `<a href="${ech(s.url)}">${ech(s.label)}</a>` : ech(s.label)}</li>`).join('');
  return `<main style="${STYLE}">
      <h1>${ech(g.titre)}</h1>
      <p><em>Mis à jour le ${ech(dateMajFr())}</em></p>
      <p><strong>La réponse :</strong> ${ech(g.reponse)}</p>
      ${sections}
      ${faqs ? `<h2>Questions fréquentes</h2><dl>${faqs}</dl>` : ''}
      ${sources ? `<h2>Sources</h2><ul>${sources}</ul>` : ''}
      <p><a href="/guides">Tous les guides</a> · <a href="${ech(lienGuide(g))}">${g.cta === 'methode' ? 'La méthode gratuite' : 'Trouver un professeur'}</a></p>
    </main>`;
}

const corpsIndex = () => `<main style="${STYLE}">
      <h1>Guides du soutien scolaire en outre-mer</h1>
      <ul>${GUIDES.map((g) => `<li><a href="/guides/${ech(g.slug)}">${ech(g.titre)}</a> — ${ech(g.description)}</li>`).join('')}</ul>
    </main>`;

/** Props d'une page de frontend/pages/seo (même gabarit SEOLocalPage pour les 11). */
export function propsPageLocale(source) {
  const prop = (nom) => {
    const m = source.match(new RegExp(`\\s${nom}="([^"]*)"`));
    return m ? m[1] : '';
  };
  return { title: prop('title'), description: prop('description'), urlPath: prop('urlPath'), heading: prop('heading'), subheading: prop('subheading') };
}

export function pagesLocales(dossierSeo = 'frontend/pages/seo') {
  return readdirSync(dossierSeo).filter((f) => f.endsWith('.jsx'))
    .map((f) => propsPageLocale(readFileSync(join(dossierSeo, f), 'utf8')))
    .filter((p) => p.urlPath && p.title);
}

/** /llms.txt : ce que le site sait, en clair, pour les assistants. */
export function llmsTxt(locales = []) {
  return [
    '# EduKaraib',
    '',
    '> Plateforme de cours particuliers pour les familles de Guadeloupe, Martinique, Guyane, La Réunion, des Caraïbes et de l’Afrique francophones : professeurs à domicile ou en visio, tarif fixé par le professeur et affiché avant la réservation, paiement en ligne avant le cours, facture après chaque paiement.',
    '',
    '## Guides (réponses courtes)',
    ...GUIDES.map((g) => `- [${g.titre}](${urlGuide(g.slug)}): ${g.reponse}`),
    '',
    '## Pages',
    `- [Trouver un professeur](${SITE}/search)`,
    `- [Réviser pour de vrai : la méthode gratuite](${SITE}/methode)`,
    ...locales.map((p) => `- [${p.heading || p.title}](${SITE}${p.urlPath})`),
    '',
  ].join('\n');
}

export function prerendreGuides({ dossier = 'dist' } = {}) {
  return {
    name: 'prerendre-guides',
    apply: 'build',
    closeBundle() {
      const indexPath = join(dossier, 'index.html');
      if (!existsSync(indexPath)) { this.warn(`prerendu : ${indexPath} introuvable`); return; }
      const gabarit = readFileSync(indexPath, 'utf8');
      // Échouer le build plutôt que publier des pages sans titre ni contenu.
      const blocTete = gabarit.match(/<title>[\s\S]*?<\/title>/);
      if (!blocTete) throw new Error('prerendu : <title> introuvable dans index.html');
      if (!gabarit.includes('<div id="root"></div>')) throw new Error('prerendu : <div id="root"></div> introuvable');
      // Canonique et description génériques d'index.html : remplacés page par page.
      const base = gabarit
        .replace(/\s*<link rel="canonical"[^>]*>/, '')
        .replace(/\s*<meta name="description"[^>]*>/, '');
      const ecrire = (chemin, tete, corps) => {
        mkdirSync(join(dossier, chemin), { recursive: true });
        writeFileSync(join(dossier, chemin, 'index.html'), base
          .replace(blocTete[0], tete)
          .replace('<div id="root"></div>', `<div id="root">${corps}</div>`));
      };

      for (const g of GUIDES) {
        ecrire(join('guides', g.slug), enTete({ title: g.title, description: g.description, url: urlGuide(g.slug), type: 'article', jsonLd: jsonLdGuide(g) }), corpsGuide(g));
      }
      ecrire('guides', enTete({ title: 'Guides du soutien scolaire en outre-mer | EduKaraib', description: 'Prix, cours en visio, brevet, Parcoursup, méthodes de révision : des réponses claires pour les familles des DOM et d’Afrique.', url: `${SITE}/guides` }), corpsIndex());

      const locales = pagesLocales();
      for (const p of locales) {
        ecrire(p.urlPath.replace(/^\//, ''), enTete({ title: `${p.title} | EduKaraib`, description: p.description, url: `${SITE}${p.urlPath}` }),
          `<main style="${STYLE}"><h1>${ech(p.heading)}</h1><p>${ech(p.subheading)}</p><p><a href="/search">Trouver un professeur</a> · <a href="/guides">Guides</a></p></main>`);
      }
      writeFileSync(join(dossier, 'llms.txt'), llmsTxt(locales));
      console.log(`prerendu : ${GUIDES.length} guides + index + ${locales.length} pages locales + llms.txt`);
    },
  };
}
