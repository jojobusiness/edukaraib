/**
 * useSEO — hook léger pour gérer les meta tags par page
 * Pas de dépendance externe, manipule directement le <head>
 *
 * Usage :
 *   useSEO({
 *     title: "Recherche de profs | EduKaraib",
 *     description: "Trouvez un professeur...",
 *     url: "https://edukaraib.com/search",
 *     image: "https://edukaraib.com/og-image.png",  // optionnel
 *   });
 */

import { useEffect } from 'react';

const BASE_URL = 'https://edukaraib.com';
const DEFAULT_IMAGE = `${BASE_URL}/og-image.png`;
const SITE_NAME = 'EduKaraib';

function setMeta(name, content, attr = 'name') {
  if (!content) return;
  let el = document.querySelector(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setLink(rel, href) {
  if (!href) return;
  let el = document.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function setJsonLd(id, data) {
  let el = document.querySelector(`script[data-seo="${id}"]`);
  if (!el) {
    el = document.createElement('script');
    el.setAttribute('type', 'application/ld+json');
    el.setAttribute('data-seo', id);
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

export function useSEO({ title, description, url, image, jsonLd } = {}) {
  useEffect(() => {
    const fullTitle = title
      ? `${title} | ${SITE_NAME}`
      : `${SITE_NAME} — Cours particuliers en au Caraïbe`;
    const fullUrl = url ? `${BASE_URL}${url}` : BASE_URL;
    const fullImage = image || DEFAULT_IMAGE;

    // Title
    document.title = fullTitle;

    // SEO basique
    setMeta('description', description);
    setMeta('robots', 'index, follow');
    setLink('canonical', fullUrl);

    // Open Graph
    setMeta('og:type', 'website', 'property');
    setMeta('og:site_name', SITE_NAME, 'property');
    setMeta('og:title', fullTitle, 'property');
    setMeta('og:description', description, 'property');
    setMeta('og:url', fullUrl, 'property');
    setMeta('og:image', fullImage, 'property');
    setMeta('og:locale', 'fr_FR', 'property');

    // Twitter
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', fullTitle);
    setMeta('twitter:description', description);
    setMeta('twitter:image', fullImage);

    // JSON-LD custom si fourni
    if (jsonLd) {
      setJsonLd('page', jsonLd);
    }
  }, [title, description, url, image, jsonLd]);
}