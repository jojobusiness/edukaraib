import { getFirestore } from './_firebaseAdmin.mjs';

const STATIC_URLS = [
  { loc: 'https://edukaraib.com/', changefreq: 'weekly', priority: '1.0' },
  { loc: 'https://edukaraib.com/search', changefreq: 'daily', priority: '0.9' },
  { loc: 'https://edukaraib.com/cours-particuliers-martinique', changefreq: 'monthly', priority: '0.85' },
  { loc: 'https://edukaraib.com/cours-particuliers-guadeloupe', changefreq: 'monthly', priority: '0.85' },
  { loc: 'https://edukaraib.com/cours-particuliers-guyane', changefreq: 'monthly', priority: '0.85' },
  { loc: 'https://edukaraib.com/cours-maths-martinique', changefreq: 'monthly', priority: '0.8' },
  { loc: 'https://edukaraib.com/cours-maths-guadeloupe', changefreq: 'monthly', priority: '0.8' },
  { loc: 'https://edukaraib.com/cours-anglais-martinique', changefreq: 'monthly', priority: '0.8' },
  { loc: 'https://edukaraib.com/cours-anglais-guadeloupe', changefreq: 'monthly', priority: '0.8' },
  { loc: 'https://edukaraib.com/cours-francais-guyane', changefreq: 'monthly', priority: '0.8' },
  { loc: 'https://edukaraib.com/cours-maths', changefreq: 'monthly', priority: '0.8' },
  { loc: 'https://edukaraib.com/cours-anglais', changefreq: 'monthly', priority: '0.8' },
  { loc: 'https://edukaraib.com/cours-francais', changefreq: 'monthly', priority: '0.8' },
  { loc: 'https://edukaraib.com/faq', changefreq: 'monthly', priority: '0.75' },
  { loc: 'https://edukaraib.com/influencer', changefreq: 'monthly', priority: '0.7' },
  { loc: 'https://edukaraib.com/about', changefreq: 'yearly', priority: '0.5' },
  { loc: 'https://edukaraib.com/blog', changefreq: 'weekly', priority: '0.8' },
  { loc: 'https://edukaraib.com/blog/trouver-professeur-particulier-martinique', changefreq: 'monthly', priority: '0.75' },
  { loc: 'https://edukaraib.com/blog/prix-cours-particuliers-caraibes-2026', changefreq: 'monthly', priority: '0.75' },
  { loc: 'https://edukaraib.com/blog/reussir-bac-maths-guadeloupe', changefreq: 'monthly', priority: '0.75' },
  { loc: 'https://edukaraib.com/blog/cours-visio-avantages-caraibes', changefreq: 'monthly', priority: '0.75' },
  { loc: 'https://edukaraib.com/contact', changefreq: 'monthly', priority: '0.6' },
  { loc: 'https://edukaraib.com/cgu', changefreq: 'yearly', priority: '0.3' },
  { loc: 'https://edukaraib.com/privacy', changefreq: 'yearly', priority: '0.3' },
];

export default async function handler(req, res) {
  try {
    const db = getFirestore();
    const snap = await db.collection('users').where('role', '==', 'teacher').get();

    const teacherUrls = snap.docs
      .filter(d => d.data().offer_enabled !== false)
      .map(d => ({
        loc: `https://edukaraib.com/profils/${d.id}`,
        changefreq: 'weekly',
        priority: '0.75',
      }));

    const allUrls = [...STATIC_URLS, ...teacherUrls];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.map(u => `  <url><loc>${u.loc}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).send(xml);
  } catch (e) {
    res.status(500).send('<?xml version="1.0"?><error>Internal error</error>');
  }
}
