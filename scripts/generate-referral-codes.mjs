// generate-referral-codes.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Script one-shot à lancer UNE SEULE FOIS pour donner un code PARRAIN-XXXXXX
// à tous les profs existants qui n'en ont pas encore.
//
// Usage :
//   node generate-referral-codes.mjs
//
// Variables d'environnement requises (mêmes que ton projet Vercel) :
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// ── Init Firebase Admin ───────────────────────────────────────────────────────
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}
const db = getFirestore();

// ── Générateur de code unique ─────────────────────────────────────────────────
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return 'PARRAIN-' + suffix;
}

// ── Vérifier l'unicité du code dans Firestore ─────────────────────────────────
async function isCodeUnique(code) {
  const snap = await db.collection('users').where('referralCode', '==', code).limit(1).get();
  return snap.empty;
}

async function generateUniqueCode() {
  let code, unique = false;
  let attempts = 0;
  while (!unique && attempts < 10) {
    code = generateCode();
    unique = await isCodeUnique(code);
    attempts++;
  }
  return code;
}

// ── Script principal ──────────────────────────────────────────────────────────
async function main() {
  console.log('🔍 Chargement de tous les profs...');

  const snap = await db.collection('users').where('role', '==', 'teacher').get();
  console.log(`📋 ${snap.size} prof(s) trouvé(s)`);

  let updated = 0;
  let skipped = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const uid  = docSnap.id;
    const name = data.fullName || data.firstName || data.email || uid;

    // Déjà un code → on saute
    if (data.referralCode) {
      console.log(`  ⏭️  ${name} → déjà un code : ${data.referralCode}`);
      skipped++;
      continue;
    }

    // Générer un code unique
    const code = await generateUniqueCode();
    await db.collection('users').doc(uid).update({ referralCode: code });
    console.log(`  ✅ ${name} → ${code}`);
    updated++;
  }

  console.log('\n─────────────────────────────────');
  console.log(`✅ ${updated} code(s) générés`);
  console.log(`⏭️  ${skipped} prof(s) déjà équipés`);
  console.log('Terminé !');
}

main().catch(err => {
  console.error('❌ Erreur :', err.message);
  process.exit(1);
});
