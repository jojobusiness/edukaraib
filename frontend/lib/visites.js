// Compte une page vue, à chaque changement de page (03/11/2026). Sans cookie ni
// identifiant : seulement « 1re page vue aujourd'hui sur ce navigateur ». Ne lève
// jamais, n'attend rien : une statistique ne doit jamais ralentir le site.
const CLE = 'edk_visite_jour';
const CLE_EXCLU = 'edk_ne_pas_compter';

// Posé à l'ouverture de l'admin : les visites de l'équipe ne gonflent pas les stats.
export function neplusCompterCeNavigateur() {
  try { localStorage.setItem(CLE_EXCLU, '1'); } catch { /* sans gravité */ }
}

export function envoyerVisite(chemin) {
  if (typeof window === 'undefined' || !import.meta.env.PROD) return;
  if (String(chemin).startsWith('/admin')) return;
  try { if (localStorage.getItem(CLE_EXCLU) === '1') return; } catch { /* on compte */ }
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
