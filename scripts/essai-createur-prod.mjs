/* ————————————————————————————————————————————————————————————
   Parcours d'un créateur, CONTRE LA PRODUCTION (02/11/2026).

     node --env-file=.env.local scripts/essai-createur-prod.mjs

   Inscription du créateur → clic → famille dont le code n'est QUE sur le compte
   → vraie session Stripe (jamais payée, expirée à la fin) → montants → chiffres.
   Tout est supprimé à la fin, sauf le mail de bienvenue reçu sur
   edukaraib+testcrea@gmail.com.
   ⚠️ Sans paiement réel, ne prouve ni le crédit du webhook ni le transfert du cron.
   ———————————————————————————————————————————————————————————— */
import admin from 'firebase-admin';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { adminDb as d } from '../api/_firebaseAdmin.mjs';
import { stripe } from '../api/_stripe.mjs';

const SITE = 'https://www.edukaraib.com';
const CODE = 'TESTCREA73';
const CREA = 'test-crea-compte';
const FAM = 'test-crea-famille';
const PROF = 'test-crea-prof';
let problemes = 0;
const ok = (c, l) => { if (c) console.log(`✅ ${l}`); else { problemes += 1; console.log(`❌ ${l}`); } };

const app = initializeApp({ apiKey: 'AIzaSyDoPTDEtgcROB-PkLehddqr3Lpy_nM5P4A', authDomain: 'edukaraib.firebaseapp.com', projectId: 'edukaraib' });
const jeton = async (uid) => (await signInWithCustomToken(getAuth(app), await admin.auth().createCustomToken(uid))).user.getIdToken();
const api = async (chemin, uid, corps) => {
  const r = await fetch(SITE + chemin, {
    method: corps ? 'POST' : 'GET',
    headers: { ...(corps ? { 'content-type': 'application/json' } : {}), ...(uid ? { authorization: `Bearer ${await jeton(uid)}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  return { code: r.status, corps: await r.json().catch(() => ({})) };
};

let sessionId = null;
try {
  await admin.auth().createUser({ uid: CREA, email: 'edukaraib+testcrea@gmail.com', password: `T-${Date.now()}` }).catch(() => {});
  const s = await api('/api/partner-signup', CREA, { structureName: '@testcreateur', kind: 'createur', contactName: 'Test Createur', code: CODE });
  ok(s.code === 201 && s.corps.code === CODE, `1. créateur inscrit, code ${s.corps.code} (${s.code})`);
  const fiche = (await d.collection('influencers').doc(CREA).get()).data();
  ok(fiche?.active === true && fiche?.model === 'partenaire' && fiche?.kind === 'createur', '1. code actif tout de suite, sans validation');

  const c = await fetch(`${SITE}/api/partner-clic`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: CODE }) });
  ok(c.status === 204 && (await d.collection('influencers').doc(CREA).get()).data().clicks === 1, '2. clic compté');

  // Famille : le code n'est plus dans son navigateur, seulement sur son compte
  await d.collection('users').doc(PROF).set({ uid: PROF, role: 'teacher', fullName: 'Prof Test', price_per_hour: 30, offer_enabled: false });
  await d.collection('users').doc(FAM).set({ uid: FAM, role: 'student', fullName: 'Famille Test', email: 'edukaraib+testfam@gmail.com', acquisition: { code: CODE, source: 'partenaire' } });
  await d.collection('lessons').doc('test-crea-cours').set({ teacher_id: PROF, student_id: FAM, participant_ids: [], status: 'confirmed', mode: 'presentiel', price_per_hour: 1, date: '2099-01-01', slot_day: 'Lun', slot_hour: 9 });

  const p = await api('/api/pay/create-checkout-session', FAM, { lessonId: 'test-crea-cours', forStudent: FAM });
  ok(p.code === 200 && !!p.corps.url, `3. session de paiement créée, sans code saisi (${p.code}${p.corps.error ? ` ${p.corps.error}` : ''})`);
  const session = (await stripe.checkout.sessions.list({ limit: 5 })).data.find((x) => x.metadata?.payer_uid === FAM);
  sessionId = session?.id;
  ok(session?.amount_total === 3800, `3. famille : ${session?.amount_total / 100} € (30 prof + 10 frais − 2 remise), malgré un cours trafiqué à 1 €/h`);
  ok(session?.metadata?.teacher_amount_cents === '3000', '3. le prof garde ses 30 €');
  ok(session?.metadata?.partner_uid === CREA && session?.metadata?.partner_commission_cents === '200', '3. 2 € prévus pour le créateur');
  ok(session?.metadata?.partner_link === '1', '3. la famille sera rattachée au créateur');

  const st = await api('/api/partner-stats', CREA);
  ok(st.corps.stats?.[CREA]?.inscrits === 1 && st.corps.stats?.[CREA]?.clics === 1, `4. espace créateur : ${JSON.stringify(st.corps.stats?.[CREA])}`);
  ok(!JSON.stringify(st.corps).includes(FAM), '4. aucune identité de famille dans les chiffres');
  const intrus = await api('/api/partner-stats', 'test-crea-intrus');
  ok(JSON.stringify(intrus.corps.stats) === '{}', '4. un autre compte ne voit rien');
} catch (e) {
  problemes += 1;
  console.log('❌ ERREUR', e?.message || e);
} finally {
  if (sessionId) await stripe.checkout.sessions.expire(sessionId).catch(() => {});
  const pay = await d.collection('payments').where('payer_uid', '==', FAM).get();
  await Promise.all(pay.docs.map((x) => x.ref.delete()));
  await d.collection('lessons').doc('test-crea-cours').delete();
  await d.collection('influencers').doc(CREA).delete();
  for (const uid of [CREA, FAM, PROF]) await d.collection('users').doc(uid).delete();
  for (const uid of [CREA, FAM, 'test-crea-intrus']) await admin.auth().deleteUser(uid).catch(() => {});
  console.log('🧹 comptes, cours, code et session de test supprimés');
}
console.log(problemes ? `\n🔴 ${problemes} problème(s).\n` : '\n✅ Parcours créateur OK jusqu’au paiement.\n');
process.exit(problemes ? 1 : 0);
