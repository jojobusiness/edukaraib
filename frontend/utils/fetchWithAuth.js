import { auth } from '../lib/firebase';
import { signOut } from 'firebase/auth';

const DEFAULT_TIMEOUT_MS = 15_000; // 15s — adapté aux connexions mobiles lentes

export async function fetchWithAuth(url, opts = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Utilisateur non connecté.');

  // On ne force pas le refresh à chaque appel (coût réseau),
  // mais on retry avec forceRefresh=true si on reçoit un 401.
  let token = await user.getIdToken(false);

  const doFetch = async (t) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        ...opts,
        signal: controller.signal,
        headers: {
          // Content-Type uniquement si on envoie un body
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${t}`,
          ...(opts.headers || {}),
        },
      });
      return res;
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await doFetch(token);

  // Retry automatique si token expiré (401)
  if (res.status === 401) {
    try {
      token = await user.getIdToken(true); // force refresh
      res = await doFetch(token);
    } catch {
      // Refresh impossible → session définitivement expirée
      await signOut(auth).catch(() => {});
      throw new Error('Votre session a expiré. Veuillez vous reconnecter.');
    }
  }

  if (!res.ok) {
    let data;
    try { data = await res.json(); } catch {}
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return res.json();
}

export default fetchWithAuth;