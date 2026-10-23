/* ————————————————————————————————————————————————————————————
   Essai de réservation de bout en bout, CONTRE LA PRODUCTION (23/10/2026).

     node --env-file=.env.local scripts/essai-reservation-prod.mjs

   Depuis le verrou des cours, la réservation passe par `acces`, `creneaux`
   et /api/rejoindre-groupe. Ce script rejoue le vrai parcours avec des
   comptes de TEST (créés puis supprimés à la fin, prof masqué de la
   recherche) :
   1. un parent crée un cours collectif pour son enfant (comme TeacherProfile) ;
   2. la Cloud Function pose `acces` et la copie publique `creneaux` ;
   3. un visiteur sans compte voit le créneau pris, pas le cours ;
   4. un élève rejoint le groupe par l'API, puis retente (doublon) ;
   5. fraudes : se déclarer payé, inscrire l'enfant d'un autre.
   ⚠️ À relancer après toute modification de la réservation ou des règles.
   ———————————————————————————————————————————————————————————— */
import admin from 'firebase-admin';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import {
  getFirestore, collection, getDocs, getDoc, addDoc, updateDoc, setDoc, doc, query, where, serverTimestamp,
} from 'firebase/firestore';
import { adminDb } from '../api/_firebaseAdmin.mjs';

const CONFIG = { apiKey: 'AIzaSyDoPTDEtgcROB-PkLehddqr3Lpy_nM5P4A', authDomain: 'edukaraib.firebaseapp.com', projectId: 'edukaraib' };
const SITE = 'https://www.edukaraib.com';
const PROF = 'test-e2e-prof';
const PARENT = 'test-e2e-parent';
const ELEVE = 'test-e2e-eleve';
const AUTRE = 'test-e2e-autre';
const SLOT = { day: 'Mar', hour: 17, date: '2099-01-06', week: '2099-01-05' };

let problemes = 0;
const ok = (cond, libelle) => {
  if (cond) console.log(`✅ ${libelle}`);
  else { problemes += 1; console.log(`❌ ${libelle}`); }
};
const refuse = async (libelle, fn) => {
  try { await fn(); problemes += 1; console.log(`❌ FAILLE ${libelle} → autorisé`); }
  catch (e) { ok(String(e?.code || e?.message).includes('permission'), `${libelle} → refusé`); }
};
const attendre = async (cond, ms = 30000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 1000)); }
  return false;
};
let n = 0;
const session = async (uid) => {
  n += 1;
  const app = initializeApp(CONFIG, `e2e-${n}`);
  if (!uid) return { app, db: getFirestore(app) };
  const cred = await signInWithCustomToken(getAuth(app), await admin.auth().createCustomToken(uid));
  return { app, db: getFirestore(app), jeton: await cred.user.getIdToken() };
};
const api = async (jeton, corps) => {
  const r = await fetch(`${SITE}/api/rejoindre-groupe`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` }, body: JSON.stringify(corps),
  });
  return { code: r.status, corps: await r.json().catch(() => ({})) };
};

let leconId = null;
let enfantId = null;
try {
  // ── Préparation : comptes de test
  await adminDb.collection('users').doc(PROF).set({ uid: PROF, role: 'teacher', fullName: 'Prof Test E2E', offer_enabled: false, group_enabled: true, group_capacity: 3 });
  for (const [uid, role] of [[PARENT, 'parent'], [ELEVE, 'student'], [AUTRE, 'parent']]) {
    await adminDb.collection('users').doc(uid).set({ uid, role, fullName: `Test ${role}` });
  }
  enfantId = (await adminDb.collection('students').add({ full_name: 'Enfant Test E2E', parent_id: PARENT, birth_date: '2015-01-01' })).id;

  // ── 1. Le parent crée un cours collectif pour son enfant (même forme que TeacherProfile)
  const parent = await session(PARENT);
  const ref = await addDoc(collection(parent.db, 'lessons'), {
    teacher_id: PROF, status: 'booked', created_at: serverTimestamp(), subject_id: 'Maths', price_per_hour: 30,
    slot_day: SLOT.day, slot_hour: SLOT.hour, date: SLOT.date, week: SLOT.week, startAt: '2099-01-06T17:00:00',
    is_group: true, capacity: 3, student_id: null, is_free_hour: false, free_reason: null,
    participant_ids: [enfantId],
    participantsMap: { [enfantId]: { parent_id: PARENT, booked_by: PARENT, is_paid: false, paid_by: null, paid_at: null, status: 'pending_teacher' } },
    mode: 'presentiel', acces: [PROF, enfantId, PARENT],
  });
  leconId = ref.id;
  ok(true, `1. le parent crée le cours collectif (${leconId})`);

  // ── 2. La Cloud Function pose la copie publique
  const creneauOk = await attendre(async () => (await adminDb.collection('creneaux').doc(leconId).get()).exists);
  ok(creneauOk, '2. la Cloud Function écrit le créneau public');
  const creneau = (await adminDb.collection('creneaux').doc(leconId).get()).data() || {};
  ok(creneau.places_prises === 1 && !JSON.stringify(creneau).includes(enfantId) && !JSON.stringify(creneau).includes(PARENT),
    '2. créneau public : 1 place prise, aucun identifiant d’élève ni de parent');

  // ── 3. Visiteur sans compte
  const anonyme = await session(null);
  const pub = await getDocs(query(collection(anonyme.db, 'creneaux'), where('teacher_id', '==', PROF)));
  ok(pub.size === 1, '3. sans compte : la page du prof voit le créneau pris');
  await refuse('3. sans compte : lire le cours', () => getDoc(doc(anonyme.db, 'lessons', leconId)));
  await deleteApp(anonyme.app);

  // ── 4. Un élève rejoint le groupe par l'API
  const eleve = await session(ELEVE);
  const mesCours = await getDocs(query(collection(eleve.db, 'lessons'), where('acces', 'array-contains', ELEVE)));
  ok(mesCours.size === 0, "4. l'élève ne voit aucun cours avant de s'inscrire (doublons = ses cours seulement)");
  const demande = { teacherId: PROF, slot: { day: SLOT.day, hour: SLOT.hour, date: SLOT.date }, targetStudentId: ELEVE, packHours: 0, mode: 'presentiel', packId: null };
  const r1 = await api(eleve.jeton, demande);
  ok(r1.code === 200 && r1.corps.status === 'joined_group' && r1.corps.lessonId === leconId, `4. /api/rejoindre-groupe → ${r1.corps.status}`);
  ok(!JSON.stringify(r1.corps).includes(enfantId), "4. la réponse ne contient rien de l'autre élève");
  const r2 = await api(eleve.jeton, demande);
  ok(r2.corps.status === 'duplicate', `4. deuxième tentative → ${r2.corps.status}`);
  const lu = await getDoc(doc(eleve.db, 'lessons', leconId)).catch(() => null);
  ok(!!lu?.exists(), "4. l'élève inscrit lit désormais le cours");
  ok(await attendre(async () => (await adminDb.collection('creneaux').doc(leconId).get()).data()?.places_prises === 2),
    '4. créneau public : 2 places prises');

  // ── 5. Fraudes
  await refuse("5. l'élève se déclare payé", () => updateDoc(doc(eleve.db, 'lessons', leconId), { [`participantsMap.${ELEVE}.is_paid`]: true }));
  await refuse("5. le parent déclare son enfant payé", () => updateDoc(doc(parent.db, 'lessons', leconId), { [`participantsMap.${enfantId}.is_paid`]: true }));
  await refuse('5. le parent cherche par student_id in (ancienne requête)', () => getDocs(query(collection(parent.db, 'lessons'), where('student_id', 'in', [enfantId]))));
  const autre = await session(AUTRE);
  const r3 = await api(autre.jeton, { ...demande, targetStudentId: enfantId });
  ok(r3.code === 403, `5. inscrire l'enfant d'un autre → ${r3.code}`);
  await refuse('5. un autre parent lit le cours', () => getDoc(doc(autre.db, 'lessons', leconId)));
  const vusParent = await getDocs(query(collection(parent.db, 'lessons'), where('acces', 'array-contains', PARENT)));
  ok(vusParent.docs.some((d) => d.id === leconId), '5. le parent retrouve le cours de son enfant (requête par acces)');
  // ── 6. Gratuités (vérifiées par les règles puis par la Cloud Function)
  await adminDb.collection('users').doc(PROF).update({ trial_enabled: true, price_per_hour: 30 });
  const coursDe = (extra) => ({
    teacher_id: PROF, status: 'booked', created_at: serverTimestamp(), price_per_hour: 30,
    slot_day: 'Mer', slot_hour: 10, date: '2099-01-07', is_group: false, student_id: enfantId,
    participant_ids: [enfantId], acces: [PROF, enfantId, PARENT], mode: 'presentiel', ...extra,
  });
  await refuse('6. heure « offerte » hors pack', () => addDoc(collection(parent.db, 'lessons'),
    coursDe({ is_free_hour: true, participantsMap: { [enfantId]: { parent_id: PARENT, booked_by: PARENT, is_free_hour: true, is_paid: false } } })));
  const essai = (n) => addDoc(collection(parent.db, 'lessons'), coursDe({
    price_per_hour: 0, is_trial: true, is_free_hour: true, date: `2099-02-0${n}`,
    participantsMap: { [enfantId]: { parent_id: PARENT, booked_by: PARENT, is_paid: true, paid_by: 'trial', is_free_hour: true } },
  }));
  const essai1 = await essai(1);
  await new Promise((r) => setTimeout(r, 1500));
  const essai2 = await essai(2);
  ok(await attendre(async () => (await adminDb.collection('lessons').doc(essai2.id).get()).data()?.gratuite_refusee === true),
    '6. deuxième essai gratuit chez le même prof → gratuité retirée par le serveur');
  const e2 = (await adminDb.collection('lessons').doc(essai2.id).get()).data();
  ok(e2.price_per_hour === 30 && e2.participantsMap?.[enfantId]?.is_paid === false, '6. il redevient payant au tarif du prof (30 €)');
  ok(!(await adminDb.collection('lessons').doc(essai1.id).get()).data()?.gratuite_refusee, '6. le premier essai reste gratuit');
  const pack = (i) => addDoc(collection(parent.db, 'lessons'), coursDe({
    pack: true, pack_hours: 5, pack_id: 'pack-e2e', is_free_hour: true, free_reason: 'pack_bonus', date: `2099-03-0${i}`,
    participantsMap: { [enfantId]: { parent_id: PARENT, booked_by: PARENT, is_paid: false, is_free_hour: true } },
  }));
  const p1 = await pack(1);
  await new Promise((r) => setTimeout(r, 1500));
  const p2 = await pack(2);
  ok(await attendre(async () => (await adminDb.collection('lessons').doc(p2.id).get()).data()?.gratuite_refusee === true),
    '6. pack 5 h : 2e heure « offerte » → retirée (1 seule prévue)');
  ok(!(await adminDb.collection('lessons').doc(p1.id).get()).data()?.gratuite_refusee, '6. pack 5 h : la 1re heure offerte reste offerte');

  // ── 7. Avis et notifications
  await refuse('7. avis sur un cours pas terminé', () => setDoc(doc(parent.db, 'reviews', `${leconId}_${PARENT}`), {
    lesson_id: leconId, teacher_id: PROF, rating: 5, comment: 'x', left_by_parent_id: PARENT,
  }));
  await refuse('7. notification piège (type libre, envoyée par e-mail)', () => addDoc(collection(autre.db, 'notifications'), {
    user_id: PROF, type: 'securite', title: 'Votre compte', message: 'Cliquez https://pirate.example',
  }));
  await refuse("7. annonce « admin » par un compte ordinaire", () => addDoc(collection(autre.db, 'notifications'), {
    user_id: PROF, type: 'admin_broadcast', message: 'x',
  }));
  await refuse('7. se débannir / se déclarer Stripe prêt', () => updateDoc(doc(autre.db, 'users', AUTRE), { disabled: false, stripeChargesEnabled: true }));
  for (const s of [parent, eleve, autre]) await deleteApp(s.app);
} catch (e) {
  problemes += 1;
  console.log('❌ ERREUR', e?.message || e);
} finally {
  // ── Nettoyage
  if (leconId) await adminDb.collection('lessons').doc(leconId).delete();
  const restes = await adminDb.collection('lessons').where('teacher_id', '==', PROF).get();
  await Promise.all(restes.docs.map((d) => d.ref.delete()));
  const notifs = await adminDb.collection('notifications').where('user_id', '==', PROF).get();
  await Promise.all(notifs.docs.map((d) => d.ref.delete()));
  if (enfantId) await adminDb.collection('students').doc(enfantId).delete();
  for (const uid of [PROF, PARENT, ELEVE, AUTRE]) {
    await adminDb.collection('users').doc(uid).delete();
    await admin.auth().deleteUser(uid).catch(() => {});
  }
  const nettoye = await attendre(async () => !(await adminDb.collection('creneaux').doc(leconId || 'x').get()).exists
    && !(await adminDb.collection('profils').doc(PROF).get()).exists
    && (await adminDb.collection('creneaux').where('teacher_id', '==', PROF).get()).empty);
  console.log(nettoye ? '🧹 comptes, cours, créneau et profils de test supprimés' : '⚠️ nettoyage incomplet — vérifier creneaux/profils');
}
console.log(problemes === 0 ? '\n✅ Réservation OK de bout en bout, aucune faille.\n' : `\n🔴 ${problemes} problème(s).\n`);
process.exit(problemes === 0 ? 0 : 1);
