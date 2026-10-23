// 23/10/2026 : plus de lecture directe de `users` / `students` d'autrui
// (refusée par les règles) — tout passe par lib/profils.js.
import { lireProfil, lireEleve, nomDe } from '../lib/profils';

export async function resolveUserName(userId) {
  if (!userId) return '—';
  return nomDe(await lireProfil(userId)) || userId;
}

export async function resolveStudentDisplayName(studentId) {
  if (!studentId) return '—';
  // 1) enfant: students/{id} ; 2) élève majeur: compte
  return nomDe(await lireEleve(studentId)) || nomDe(await lireProfil(studentId)) || studentId;
}
