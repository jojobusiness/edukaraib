// Compte une page vue, à chaque changement de page (03/11/2026). Sans cookie ni
// identifiant : seulement « 1re page vue aujourd'hui sur ce navigateur ». Ne lève
// jamais, n'attend rien : une statistique ne doit jamais ralentir le site.
const CLE = 'edk_visite_jour';

export function envoyerVisite(chemin) {
  if (typeof window === 'undefined' || !import.meta.env.PROD) return;
  if (String(chemin).startsWith('/admin')) return;
  try {
    const jour = new Date().toISOString().slice(0, 10);
    let nouveau = false;
    try {
      nouveau = localStorage.getItem(CLE) !== jour;
      if (nouveau) localStorage.setItem(CLE, jour);
    } catch { nouveau = false; }
    fetch('/api/visite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chemin, nouveau, referent: nouveau ? document.referrer : '' }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* sans gravité */ }
}
