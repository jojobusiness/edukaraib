import { adminDb } from './_firebaseAdmin.mjs';

export default async function handler(req, res) {
  try {
    const base = "https://edukaraib.com";

    const staticUrls = [
      { loc: `${base}/`,                changefreq: "weekly",  priority: "1.0" },
      { loc: `${base}/recherche-prof`,  changefreq: "daily",   priority: "0.9" },
      { loc: `${base}/register`,        changefreq: "monthly", priority: "0.7" },
      { loc: `${base}/login`,           changefreq: "monthly", priority: "0.5" },
      { loc: `${base}/cgu`,             changefreq: "yearly",  priority: "0.3" },
      { loc: `${base}/privacy`,         changefreq: "yearly",  priority: "0.3" },
    ];

    // Profils profs publics dynamiques
    const teachersSnap = await adminDb
      .collection('users')
      .where('role', '==', 'teacher')
      .get();

    const teacherUrls = teachersSnap.docs.map((d) => ({
      loc: `${base}/prof/${d.id}`,
      changefreq: "weekly",
      priority: "0.8",
      lastmod: d.data().updatedAt
        ? new Date(d.data().updatedAt.seconds * 1000).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
    }));

    const urls = [...staticUrls, ...teacherUrls];

    const xmlEscape = (s = "") =>
      String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const body =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((u) => [
        `  <url>`,
        `    <loc>${xmlEscape(u.loc)}</loc>`,
        u.lastmod      ? `    <lastmod>${u.lastmod}</lastmod>` : '',
        u.changefreq   ? `    <changefreq>${u.changefreq}</changefreq>` : '',
        u.priority     ? `    <priority>${u.priority}</priority>` : '',
        `  </url>`,
      ].filter(Boolean).join("\n")).join("\n") +
      `\n</urlset>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
    res.status(200).send(body);

  } catch (e) {
    console.error('sitemap error', e);
    const base = "https://edukaraib.com";
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `  <url><loc>${base}/</loc></url>\n` +
      `</urlset>`
    );
  }
}