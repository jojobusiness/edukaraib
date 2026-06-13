import { db } from '../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import fetchWithAuth from './fetchWithAuth';

const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomSuffix(n = 6) {
  let s = '';
  for (let i = 0; i < n; i++) s += REF_CHARS[Math.floor(Math.random() * REF_CHARS.length)];
  return s;
}

/**
 * Crée le doc users/{uid} si le compte (Google) est nouveau — mutualisé
 * Login + Register. role par défaut = 'student'. Ne recrée jamais un doc
 * existant (donc pas de coupon de bienvenue en double).
 * @returns {Promise<{ role: string, isNew: boolean }>}
 */
export async function ensureUserDoc(user, { defaultRole = 'student' } = {}) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return { role: snap.data().role || defaultRole, isNew: false };

  const [firstName, ...rest] = (user.displayName || '').trim().split(' ');
  const baseData = {
    uid: user.uid,
    email: user.email,
    role: defaultRole,
    firstName: firstName || '',
    lastName: rest.join(' ') || '',
    fullName: user.displayName || '',
    avatarUrl: user.photoURL || '',
    city: 'En ligne',
    createdAt: serverTimestamp(),
  };

  // Code de parrainage étudiant (comme à l'inscription email)
  if (defaultRole === 'student' || defaultRole === 'parent') {
    baseData.studentReferralCode = 'REF-' + randomSuffix();
  }

  await setDoc(ref, baseData);

  // 🎟️ Coupon de bienvenue -5€ (élève/parent uniquement) — même logique que Register.jsx.
  // fetchWithAuth obligatoire (l'API exige verifyAuth). Sans await pour ne pas bloquer la navigation.
  if (defaultRole === 'student' || defaultRole === 'parent') {
    fetchWithAuth('/api/create-welcome-coupon', {
      method: 'POST',
      body: JSON.stringify({ uid: user.uid, email: user.email, fullName: user.displayName || '' }),
    }).catch((e) => console.warn('[coupon-bienvenue google] échec:', e?.message));
  }

  return { role: defaultRole, isNew: true };
}

export default ensureUserDoc;
