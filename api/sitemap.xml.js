// /api/sitemap.xml.js
import dayjs from "dayjs";

let admin = null;
try {
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) : null;
  if (svc) {
    const mod = await import("firebase-admin");
    admin = mod.default;
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(svc) });
    }
  }
} catch (e) {
  console.warn("Sitemap: init skipped", e?.message || e);
}

function xmlEscape(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default async function handler(req, res) {
  const base = "https://edukaraib.com";
  const urls = [
    { loc: `${base}/`,                changefreq: "weekly",  priority: "1.0"  },
    { loc: `${base}/search`,          changefreq: "weekly",  priority: "0.9"  },
    { loc: `${base}/cgu`,             changefreq: "yearly",  priority: "0.3"  },
    { loc: `${base}/privacy`,         changefreq: "yearly",  priority: "0.3"  },
  ];

  // Si Firestore dispo → profils profs
  if (admin) {
    try {
      const db = admin.firestore();
      const snap = await db.collection("users").where("role", "==", "teacher").limit(1000).get();
      snap.forEach((doc) => {
        const id = doc.id;
        const updatedAt = doc.updateTime?.toDate?.() || new Date();
        urls.push({
          loc: `${base}/profils/${encodeURIComponent(id)}`,
          lastmod: dayjs(updatedAt).format("YYYY-MM-DD"),
          changefreq: "weekly",
          priority: "0.8",
        });
      });
    } catch (e) {
      console.warn("Sitemap: teacher fetch failed", e?.message || e);
    }
  }

  // Génère XML
  const body =
`<?xml version="1.0" encoding="UTF-8"?>
<urlset 
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
>
${urls.map(u => `
  <url>
    <loc>${xmlEscape(u.loc)}</loc>
    ${u.lastmod ? `<lastmod>${xmlEscape(u.lastmod)}</lastmod>` : ""}
    ${u.changefreq ? `<changefreq>${xmlEscape(u.changefreq)}</changefreq>` : ""}
    ${u.priority ? `<priority>${xmlEscape(u.priority)}</priority>` : ""}
    ${u.loc === `${base}/` ? `
      <image:image>
        <image:loc>${base}/edukaraib_logo.png</image:loc>
        <image:caption>EduKaraib - Enseignement et accompagnement en Guyane</image:caption>
      </image:image>
    ` : ""}
  </url>`).join("")}
</urlset>`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
  res.status(200).send(body);
}