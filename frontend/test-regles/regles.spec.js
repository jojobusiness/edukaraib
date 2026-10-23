/* global process */
// Les règles Firestore tiennent-elles ? (23/10/2026)
//
//   npm run test:regles      (lance l'émulateur Firestore, puis ces tests)
//
// Ce ne sont pas des relectures : l'émulateur exécute firestore.rules comme
// la production. Chaque bloc rejoue (1) ce qu'un intrus tenterait et (2) les
// requêtes EXACTES des écrans, qui doivent continuer à passer.
// ⚠️ À relancer après toute modification de firestore.rules.
import { readFileSync } from 'node:fs';
import { describe, it, beforeAll, afterAll } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs, query, where, limit, arrayUnion,
} from 'firebase/firestore';

let env;
const PROF = 'prof1';
const FAMILLE = 'famille1';
const ELEVE = 'eleve1';
const INTRUS = 'intrus1';
const ADMIN = 'admin1';
const ENFANT = 'enfant1';

const db = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-edukaraib',
    firestore: { rules: readFileSync(process.env.REGLES || 'firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    const compte = (uid, role, extra = {}) => setDoc(doc(d, 'users', uid), {
      uid, role, fullName: `Nom ${uid}`, email: `${uid}@exemple.fr`, phone: '0600000000', birth: '2000-01-01', ...extra,
    });
    await compte(PROF, 'teacher', { stripeAccountId: 'acct_secret' });
    await compte(FAMILLE, 'parent');
    await compte(ELEVE, 'student');
    await compte(INTRUS, 'student');
    await compte(ADMIN, 'admin');
    await setDoc(doc(d, 'profils', PROF), { uid: PROF, role: 'teacher', fullName: 'Nom prof1' });
    await setDoc(doc(d, 'profils', ELEVE), { uid: ELEVE, role: 'student', fullName: 'Nom eleve1' });
    await setDoc(doc(d, 'profils', ADMIN), { uid: ADMIN, role: 'admin', fullName: 'Support' });
    await setDoc(doc(d, 'students', ENFANT), { full_name: 'Enfant Test', birth_date: '2015-05-05', parent_id: FAMILLE });
    await setDoc(doc(d, 'students', 'eleveFiche'), { full_name: 'Élève', user_id: ELEVE });
    const lecon = {
      teacher_id: PROF, student_id: ENFANT, participant_ids: [ENFANT],
      participantsMap: { [ENFANT]: { parent_id: FAMILLE, booked_by: FAMILLE, is_paid: false, status: 'pending_teacher' } },
      acces: [PROF, ENFANT, FAMILLE],
    };
    await setDoc(doc(d, 'lessons', 'lecon1'), lecon);
    await setDoc(doc(d, 'lessons', 'lecon2'), lecon);
    await setDoc(doc(d, 'documents', 'doc1'), { lesson_id: 'lecon1', sender_id: PROF, acces: [PROF, ENFANT, FAMILLE] });
    await setDoc(doc(d, 'documents', 'docFamille'), { lesson_id: 'lecon1', sender_id: FAMILLE, acces: [PROF, ENFANT, FAMILLE], filename: 'a.pdf' });
    await setDoc(doc(d, 'favorites', `${FAMILLE}_${PROF}`), { user_id: FAMILLE, teacher_id: PROF });
    await setDoc(doc(d, 'presence', PROF), { online: true });
    await setDoc(doc(d, 'lessons', 'leconEleve'), {
      teacher_id: PROF, student_id: ELEVE, participant_ids: [ELEVE], is_group: false,
      participantsMap: { [ELEVE]: { booked_by: ELEVE, is_paid: false } }, acces: [PROF, ELEVE],
    });
    await setDoc(doc(d, 'lessons', 'payee'), {
      teacher_id: PROF, student_id: ELEVE, is_paid: true, is_group: false, participant_ids: [ELEVE],
      participantsMap: {}, acces: [PROF, ELEVE],
    });
    await setDoc(doc(d, 'creneaux', 'lecon1'), { teacher_id: PROF, slot_day: 'Lun', slot_hour: 9, places_prises: 1 });
    await setDoc(doc(d, 'children', 'c1'), { full_name: 'x' });
  });
});
afterAll(async () => { await env?.cleanup(); });

describe('users — plus jamais lisible par les autres', () => {
  it('sans compte : ni liste, ni fiche', async () => {
    await assertFails(getDocs(collection(db(null), 'users')));
    await assertFails(getDoc(doc(db(null), 'users', PROF)));
  });
  it('intrus connecté : ni la fiche du prof, ni la liste des profs', async () => {
    await assertFails(getDoc(doc(db(INTRUS), 'users', PROF)));
    await assertFails(getDocs(query(collection(db(INTRUS), 'users'), where('role', '==', 'teacher'))));
    await assertFails(getDocs(query(collection(db(INTRUS), 'users'), where('uid', '==', PROF), limit(1))));
  });
  it('chacun lit SA fiche (par id et par requête uid, Navbar)', async () => {
    await assertSucceeds(getDoc(doc(db(FAMILLE), 'users', FAMILLE)));
    await assertSucceeds(getDocs(query(collection(db(FAMILLE), 'users'), where('uid', '==', FAMILLE), limit(1))));
  });
  it("l'admin lit tout (onglet Comptes)", async () => {
    await assertSucceeds(getDocs(collection(db(ADMIN), 'users')));
  });
});

describe('profils — la copie publique', () => {
  it('recherche et accueil sans compte : la liste des profs passe', async () => {
    await assertSucceeds(getDocs(query(collection(db(null), 'profils'), where('role', '==', 'teacher'))));
    await assertSucceeds(getDoc(doc(db(null), 'profils', PROF)));
  });
  it("l'avis d'un élève affiche son nom (fiche par id)", async () => {
    await assertSucceeds(getDoc(doc(db(null), 'profils', ELEVE)));
  });
  it('on ne liste ni tous les profils, ni les élèves', async () => {
    await assertFails(getDocs(collection(db(INTRUS), 'profils')));
    await assertFails(getDocs(query(collection(db(INTRUS), 'profils'), where('role', '==', 'student'))));
  });
  it("le bouton « support » trouve l'admin", async () => {
    await assertSucceeds(getDocs(query(collection(db(FAMILLE), 'profils'), where('role', '==', 'admin'), limit(1))));
  });
  it('personne n’écrit dans profils (seule la Cloud Function le fait)', async () => {
    await assertFails(setDoc(doc(db(PROF), 'profils', PROF), { role: 'teacher', fullName: 'Pirate' }));
  });
});

describe('students — les enfants', () => {
  it('intrus : ni lecture, ni modification, ni suppression', async () => {
    await assertFails(getDoc(doc(db(INTRUS), 'students', ENFANT)));
    await assertFails(getDocs(collection(db(INTRUS), 'students')));
    await assertFails(getDocs(query(collection(db(INTRUS), 'students'), where('parent_id', '==', FAMILLE))));
    await assertFails(updateDoc(doc(db(INTRUS), 'students', ENFANT), { full_name: 'Pirate' }));
    await assertFails(deleteDoc(doc(db(INTRUS), 'students', ENFANT)));
    await assertFails(addDoc(collection(db(INTRUS), 'students'), { full_name: 'x', parent_id: FAMILLE }));
  });
  it('le prof ne lit pas la fiche complète (il passe par /api/fiches-eleves)', async () => {
    await assertFails(getDoc(doc(db(PROF), 'students', ENFANT)));
  });
  it('le parent gère ses enfants (ParentChildren, ParentDashboard…)', async () => {
    const f = db(FAMILLE);
    await assertSucceeds(getDocs(query(collection(f, 'students'), where('parent_id', '==', FAMILLE))));
    await assertSucceeds(getDoc(doc(f, 'students', ENFANT)));
    const nouveau = await assertSucceeds(addDoc(collection(f, 'students'), { full_name: 'Petit', birth_date: '2016-01-01', school_level: 'CM1', parent_id: FAMILLE }));
    await assertSucceeds(updateDoc(nouveau, { school_level: 'CM2' }));
    await assertFails(updateDoc(nouveau, { parent_id: INTRUS }));
    await assertSucceeds(deleteDoc(nouveau));
  });
  it("l'élève retrouve sa fiche (StudentPayments)", async () => {
    await assertSucceeds(getDocs(query(collection(db(ELEVE), 'students'), where('user_id', '==', ELEVE), limit(1))));
  });
  it("l'admin lit les fiches", async () => {
    await assertSucceeds(getDocs(collection(db(ADMIN), 'students')));
  });
});

describe('documents de cours', () => {
  it('intrus : rien', async () => {
    await assertFails(getDoc(doc(db(INTRUS), 'documents', 'doc1')));
    await assertFails(getDocs(query(collection(db(INTRUS), 'documents'), where('lesson_id', '==', 'lecon1'))));
    await assertFails(deleteDoc(doc(db(INTRUS), 'documents', 'doc1')));
    await assertFails(updateDoc(doc(db(INTRUS), 'documents', 'doc1'), { acces: arrayUnion(INTRUS) }));
    await assertSucceeds(getDocs(query(collection(db(INTRUS), 'documents'), where('acces', 'array-contains', INTRUS))));
  });
  it('prof et parent voient les fichiers du cours (DocumentsModal)', async () => {
    await assertSucceeds(getDocs(query(collection(db(PROF), 'documents'), where('acces', 'array-contains', PROF))));
    await assertSucceeds(getDocs(query(collection(db(FAMILLE), 'documents'), where('acces', 'array-contains', FAMILLE))));
  });
  it('le parent envoie un fichier en son nom', async () => {
    await assertSucceeds(addDoc(collection(db(FAMILLE), 'documents'), { lesson_id: 'lecon1', sender_id: FAMILLE, acces: [FAMILLE, PROF] }));
    await assertFails(addDoc(collection(db(FAMILLE), 'documents'), { lesson_id: 'lecon1', sender_id: PROF, acces: [FAMILLE, PROF] }));
  });
  it("le prof renomme ou complète l'accès, y compris d'un fichier envoyé par la famille", async () => {
    await assertSucceeds(updateDoc(doc(db(PROF), 'documents', 'docFamille'), { filename: 'b.pdf' }));
    await assertSucceeds(updateDoc(doc(db(PROF), 'documents', 'doc1'), { acces: arrayUnion('nouvelEleve') }));
  });
});

describe('favoris, présence, cours, collections vides', () => {
  it('favoris : les miens uniquement', async () => {
    await assertFails(getDocs(query(collection(db(INTRUS), 'favorites'), where('user_id', '==', FAMILLE))));
    await assertFails(setDoc(doc(db(INTRUS), 'favorites', 'x'), { user_id: FAMILLE, teacher_id: PROF }));
    await assertSucceeds(getDocs(query(collection(db(FAMILLE), 'favorites'), where('user_id', '==', FAMILLE))));
    await assertSucceeds(setDoc(doc(db(FAMILLE), 'favorites', `${FAMILLE}_autre`), { user_id: FAMILLE, teacher_id: 'autre' }, { merge: true }));
    await assertSucceeds(deleteDoc(doc(db(FAMILLE), 'favorites', `${FAMILLE}_autre`)));
  });
  it('présence : lisible, mais chacun n’écrit que la sienne', async () => {
    await assertSucceeds(getDoc(doc(db(FAMILLE), 'presence', PROF)));
    await assertFails(setDoc(doc(db(INTRUS), 'presence', PROF), { online: false }));
    await assertSucceeds(setDoc(doc(db(INTRUS), 'presence', INTRUS), { online: true }));
  });
  it("on ne supprime plus le cours d'un autre", async () => {
    await assertFails(deleteDoc(doc(db(INTRUS), 'lessons', 'lecon2')));
    await assertFails(deleteDoc(doc(db(FAMILLE), 'lessons', 'lecon2')));
    await assertSucceeds(deleteDoc(doc(db(PROF), 'lessons', 'lecon2')));
  });
  it('parents / children : admin seulement', async () => {
    await assertFails(getDoc(doc(db(INTRUS), 'children', 'c1')));
    await assertFails(getDoc(doc(db(PROF), 'parents', FAMILLE, 'children', 'c1')));
    await assertSucceeds(getDoc(doc(db(ADMIN), 'children', 'c1')));
  });
});

describe('lessons — les cours', () => {
  it('sans compte : aucun cours, mais les créneaux publics de la page prof', async () => {
    await assertFails(getDocs(collection(db(null), 'lessons')));
    await assertFails(getDoc(doc(db(null), 'lessons', 'lecon1')));
    await assertFails(getDocs(query(collection(db(null), 'lessons'), where('teacher_id', '==', PROF))));
    await assertSucceeds(getDocs(query(collection(db(null), 'creneaux'), where('teacher_id', '==', PROF))));
    await assertFails(setDoc(doc(db(PROF), 'creneaux', 'x'), { teacher_id: PROF }));
  });
  it("intrus : ni lecture ni modification du cours d'un autre", async () => {
    await assertFails(getDoc(doc(db(INTRUS), 'lessons', 'lecon1')));
    await assertFails(getDocs(query(collection(db(INTRUS), 'lessons'), where('teacher_id', '==', PROF))));
    await assertFails(updateDoc(doc(db(INTRUS), 'lessons', 'lecon1'), { status: 'rejected' }));
    await assertSucceeds(getDocs(query(collection(db(INTRUS), 'lessons'), where('acces', 'array-contains', INTRUS))));
  });
  it('prof : ses cours (TeacherLessons, TeacherCalendar…) et leur statut', async () => {
    await assertSucceeds(getDocs(query(collection(db(PROF), 'lessons'), where('teacher_id', '==', PROF))));
    await assertSucceeds(updateDoc(doc(db(PROF), 'lessons', 'lecon1'), { status: 'confirmed' }));
    await assertFails(updateDoc(doc(db(PROF), 'lessons', 'lecon1'), { teacher_id: INTRUS }));
  });
  it('élève : ses cours (MyCourses, StudentCalendar, StudentDashboard)', async () => {
    await assertSucceeds(getDocs(query(collection(db(ELEVE), 'lessons'), where('student_id', '==', ELEVE))));
    await assertSucceeds(getDocs(query(collection(db(ELEVE), 'lessons'), where('participant_ids', 'array-contains', ELEVE))));
    await assertSucceeds(getDocs(query(collection(db(ELEVE), 'lessons'), where('acces', 'array-contains', ELEVE))));
  });
  it('parent : les cours de ses enfants par acces (plus par student_id in)', async () => {
    await assertSucceeds(getDocs(query(collection(db(FAMILLE), 'lessons'), where('acces', 'array-contains', FAMILLE))));
    await assertSucceeds(getDoc(doc(db(FAMILLE), 'lessons', 'lecon1')));
    await assertFails(getDocs(query(collection(db(FAMILLE), 'lessons'), where('student_id', 'in', [ENFANT]))));
  });
  it('💸 fraude : un participant ne se déclare pas « payé »', async () => {
    await assertFails(updateDoc(doc(db(FAMILLE), 'lessons', 'lecon1'), { [`participantsMap.${ENFANT}.is_paid`]: true }));
    await assertFails(updateDoc(doc(db(ELEVE), 'lessons', 'leconEleve'), { [`participantsMap.${ELEVE}.is_paid`]: true }));
    await assertFails(updateDoc(doc(db(FAMILLE), 'lessons', 'lecon1'), { is_paid: true }));
    // mais il peut agir sur sa demande (réactivation, refus…)
    await assertSucceeds(updateDoc(doc(db(FAMILLE), 'lessons', 'lecon1'), {
      [`participantsMap.${ENFANT}.status`]: 'pending_teacher', [`participantsMap.${ENFANT}.is_paid`]: false,
    }));
  });
  it('le prof passe en groupe un cours individuel déjà payé (recopie is_paid)', async () => {
    await assertSucceeds(updateDoc(doc(db(PROF), 'lessons', 'payee'), {
      is_group: true, [`participantsMap.${ELEVE}`]: { is_paid: true, status: 'confirmed' },
    }));
  });
  it('création : en son nom, jamais « déjà payé » sauf essai gratuit', async () => {
    const f = db(FAMILLE);
    const base = { teacher_id: PROF, student_id: ENFANT, participant_ids: [ENFANT], price_per_hour: 30 };
    await assertSucceeds(addDoc(collection(f, 'lessons'), { ...base, acces: [PROF, ENFANT, FAMILLE], participantsMap: { [ENFANT]: { is_paid: false } } }));
    await assertFails(addDoc(collection(f, 'lessons'), { ...base, participantsMap: { [ENFANT]: { is_paid: false } } }));
    await assertFails(addDoc(collection(f, 'lessons'), { ...base, acces: [FAMILLE], participantsMap: { [ENFANT]: { is_paid: true } } }));
    await assertSucceeds(addDoc(collection(f, 'lessons'), { ...base, price_per_hour: 0, is_trial: true, acces: [FAMILLE], participantsMap: { [ENFANT]: { is_paid: true, paid_by: 'trial' } } }));
  });
});
