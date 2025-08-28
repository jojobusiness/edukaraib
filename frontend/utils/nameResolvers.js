import { db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

export async function resolveUserName(userId) {
  if (!userId) return '—';
  try {
    const u = await getDoc(doc(db, 'users', userId));
    if (u.exists()) {
      const d = u.data();
      return d.fullName || d.name || d.displayName || userId;
    }
  } catch {}
  return userId;
}

export async function resolveStudentDisplayName(studentId) {
  if (!studentId) return '—';
  // 1) enfant: students/{id}
  try {
    const s = await getDoc(doc(db, 'students', studentId));
    if (s.exists()) {
      const d = s.data();
      const first = d.full_name || d.name || d.first_name || d.firstname || d.firstName;
      const last  = d.last_name || d.lastname || d.lastName;
      return [first, last].filter(Boolean).join(' ') || studentId;
    }
  } catch {}
  // 2) élève majeur: users/{uid}
  try {
    const u = await getDoc(doc(db, 'users', studentId));
    if (u.exists()) {
      const d = u.data();
      return d.fullName || d.name || d.displayName || studentId;
    }
  } catch {}
  return studentId;
}