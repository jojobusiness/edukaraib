// Pays de connexion du visiteur (09/11/2026), une seule requête par session.
// Ne lève jamais : '' si inconnu (dev local, réseau, bloqueur).
const CLE = 'edk_pays';

export async function detecterPays() {
  try {
    const memo = sessionStorage.getItem(CLE);
    if (memo !== null) return memo;
  } catch { /* stockage indisponible */ }
  try {
    // 3 s maximum : l'inscription Google attend cette réponse
    const ctrl = new AbortController();
    const minuteur = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch('/api/pays', { signal: ctrl.signal }).finally(() => clearTimeout(minuteur));
    const { pays } = r.ok ? await r.json() : { pays: '' };
    const p = /^[A-Z]{2}$/.test(pays || '') ? pays : '';
    try { sessionStorage.setItem(CLE, p); } catch { /* sans gravité */ }
    return p;
  } catch {
    return '';
  }
}
