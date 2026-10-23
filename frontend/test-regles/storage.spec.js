/* global process */
// Les règles Storage tiennent-elles ? (23/10/2026)
//
//   npm run test:regles   (émulateurs Firestore + Storage)
//
// Avant le 23/10, tout compte connecté listait, téléchargeait, remplaçait ou
// supprimait TOUS les fichiers. Chaque bloc rejoue l'intrus puis l'écran légitime.
import { readFileSync } from 'node:fs';
import { describe, it, beforeAll, afterAll } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject, listAll } from 'firebase/storage';

let env;
const FAMILLE = 'famille1';
const PROF = 'prof1';
const INTRUS = 'intrus1';
const ADMIN = 'admin1';
const st = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();
const octets = (n = 10) => new Uint8Array(n);
const meta = (contentType) => ({ contentType });

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-edukaraib',
    firestore: { rules: readFileSync(process.env.REGLES || 'firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync(process.env.REGLES_STORAGE || 'storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'users', ADMIN), { uid: ADMIN, role: 'admin' });
    await setDoc(doc(d, 'conversations', 'conv1'), { participants: [FAMILLE, PROF] });
    await setDoc(doc(d, 'lessons', 'lecon1'), { teacher_id: PROF, participant_ids: ['enfant'], acces: [PROF, FAMILLE, 'enfant'] });
    const s = ctx.storage();
    await uploadBytes(ref(s, `refund-proofs/${FAMILLE}/preuve.pdf`), octets(), meta('application/pdf'));
    await uploadBytes(ref(s, `chat/conv1/${FAMILLE}/photo.jpg`), octets(), meta('image/jpeg'));
    await uploadBytes(ref(s, 'lessons/lecon1/cours.pdf'), octets(), meta('application/pdf'));
    await uploadBytes(ref(s, `avatars/${PROF}`), octets(), meta('image/png'));
    await uploadBytes(ref(s, `certificates/${PROF}/diplome.pdf`), octets(), meta('application/pdf'));
  });
});
afterAll(async () => { await env?.cleanup(); });

describe('Storage — intrus connecté', () => {
  it('ne liste ni ne lit les justificatifs de remboursement', async () => {
    await assertFails(listAll(ref(st(INTRUS), 'refund-proofs')));
    await assertFails(getBytes(ref(st(INTRUS), `refund-proofs/${FAMILLE}/preuve.pdf`)));
  });
  it("ne lit pas les pièces jointes d'une conversation dont il ne fait pas partie", async () => {
    await assertFails(getBytes(ref(st(INTRUS), `chat/conv1/${FAMILLE}/photo.jpg`)));
    await assertFails(uploadBytes(ref(st(INTRUS), `chat/conv1/${INTRUS}/x.jpg`), octets(), meta('image/jpeg')));
  });
  it("ne lit ni ne supprime les documents d'un cours d'autrui", async () => {
    await assertFails(getBytes(ref(st(INTRUS), 'lessons/lecon1/cours.pdf')));
    await assertFails(deleteObject(ref(st(INTRUS), 'lessons/lecon1/cours.pdf')));
  });
  it("ne remplace ni la photo ni le diplôme d'un prof", async () => {
    await assertFails(uploadBytes(ref(st(INTRUS), `avatars/${PROF}`), octets(), meta('image/png')));
    await assertFails(deleteObject(ref(st(INTRUS), `certificates/${PROF}/diplome.pdf`)));
    await assertFails(uploadBytes(ref(st(INTRUS), `intro-videos/${PROF}.mp4`), octets(), meta('video/mp4')));
  });
  it('ne dépose rien hors des dossiers prévus', async () => {
    await assertFails(uploadBytes(ref(st(INTRUS), 'divers/x.txt'), octets(), meta('text/plain')));
  });
});

describe('Storage — les écrans légitimes', () => {
  it('chacun gère sa photo, sa vidéo, ses diplômes (Profile, Register)', async () => {
    await assertSucceeds(uploadBytes(ref(st(FAMILLE), `avatars/${FAMILLE}`), octets(), meta('image/jpeg')));
    await assertSucceeds(uploadBytes(ref(st(PROF), `intro-videos/${PROF}.mp4`), octets(), meta('video/mp4')));
    await assertSucceeds(uploadBytes(ref(st(PROF), `certificates/${PROF}/b.pdf`), octets(), meta('application/pdf')));
    await assertFails(uploadBytes(ref(st(FAMILLE), `avatars/${FAMILLE}`), octets(), meta('application/x-msdownload')));
  });
  it('photos, diplômes et vidéos restent publics (page prof sans compte)', async () => {
    await assertSucceeds(getBytes(ref(st(null), `avatars/${PROF}`)));
    await assertSucceeds(getBytes(ref(st(null), `certificates/${PROF}/diplome.pdf`)));
  });
  it('la famille dépose et relit son justificatif ; l’admin le lit', async () => {
    await assertSucceeds(uploadBytes(ref(st(FAMILLE), `refund-proofs/${FAMILLE}/2.pdf`), octets(), meta('application/pdf')));
    await assertSucceeds(getBytes(ref(st(FAMILLE), `refund-proofs/${FAMILLE}/preuve.pdf`)));
    await assertSucceeds(getBytes(ref(st(ADMIN), `refund-proofs/${FAMILLE}/preuve.pdf`)));
  });
  it('les deux correspondants échangent des pièces jointes, sans pouvoir les effacer', async () => {
    await assertSucceeds(uploadBytes(ref(st(PROF), `chat/conv1/${PROF}/vocal.webm`), octets(), meta('audio/webm')));
    await assertSucceeds(getBytes(ref(st(PROF), `chat/conv1/${FAMILLE}/photo.jpg`)));
    await assertFails(deleteObject(ref(st(FAMILLE), `chat/conv1/${FAMILLE}/photo.jpg`)));
  });
  it('les comptes du cours partagent ses documents (DocumentsModal)', async () => {
    await assertSucceeds(uploadBytes(ref(st(FAMILLE), 'lessons/lecon1/devoir.pdf'), octets(), meta('application/pdf')));
    await assertSucceeds(getBytes(ref(st(PROF), 'lessons/lecon1/devoir.pdf')));
    await assertSucceeds(deleteObject(ref(st(PROF), 'lessons/lecon1/devoir.pdf')));
  });
});
