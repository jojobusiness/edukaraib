import { auth } from '../lib/firebase';

export async function fetchWithAuth(url, opts = {}) {
  const token = await auth.currentUser?.getIdToken?.();
  if (!token) throw new Error('Utilisateur non connecté.');

  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });

  if (!res.ok) {
    let data;
    try { data = await res.json(); } catch {}
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json();
}

// (facultatif) on peut aussi fournir un export par défaut
export default fetchWithAuth;