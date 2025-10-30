export default async function handler(req, res) {
  try {
    const base = "https://edukaraib.com";

    // — Pages publiques principales —
    const urls = [
      { loc: `${base}/`,          changefreq: "weekly",  priority: "1.0" },
      { loc: `${base}/search`,    changefreq: "weekly",  priority: "0.9" },
      { loc: `${base}/profils`,   changefreq: "weekly",  priority: "0.5" },
      { loc: `${base}/cgu`,       changefreq: "yearly",  priority: "0.3" },
      { loc: `${base}/privacy`,   changefreq: "yearly",  priority: "0.3" },
    ];

    // — Génération XML simple et valide (sans dépendances) —
    const xmlEscape = (s = "") =>
      String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const body =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n` +
      `        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
      urls.map(u => {
        return [
          `<url>`,
          `  <loc>${xmlEscape(u.loc)}</loc>`,
          u.changefreq ? `  <changefreq>${xmlEscape(u.changefreq)}</changefreq>` : ``,
          u.priority   ? `  <priority>${xmlEscape(u.priority)}</priority>` : ``,
          // Logo associé à la home
          u.loc === `${base}/` ? (
            `  <image:image>\n` +
            `    <image:loc>${xmlEscape(base + "/edukaraib_logo.png")}</image:loc>\n` +
            `    <image:caption>EduKaraib</image:caption>\n` +
            `  </image:image>`
          ) : ``,
          `</url>`
        ].filter(Boolean).join("\n");
      }).join("\n") +
      `\n</urlset>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
    res.status(200).send(body);
  } catch (e) {
    // Fallback: renvoie au moins un sitemap minimal pour que Google n’échoue pas
    const base = "https://edukaraib.com";
    const fallback =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `  <url><loc>${base}/</loc></url>\n` +
      `</urlset>`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.status(200).send(fallback);
  }
}