import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';

// Génère un code unique format INFLU-XXXXXX (sans I, O, 0, 1 pour éviter confusion)
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'INFLU-';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await verifyAuth(req, res);
  if (!auth) return;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { name, email, uid: bodyUid } = body;

  if (!name || !email) {
    return res.status(400).json({ error: 'MISSING_NAME_OR_EMAIL' });
  }

  // L'uid du doc influencers = uid Auth de l'appelant (ou uid explicite passé à l'inscription)
  // bodyUid est envoyé par InfluencerHome juste après createUserWithEmailAndPassword
  const targetUid = bodyUid || auth.uid;

  // Vérifie que le demandeur est soit l'influenceur lui-même, soit un admin
  const callerIsOwner = auth.uid === targetUid;
  if (!callerIsOwner) {
    const adminSnap = await adminDb.collection('users').doc(auth.uid).get();
    const isAdmin = adminSnap.exists && adminSnap.data()?.role === 'admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
  }

  // Vérifie qu'un doc influencers avec cet uid n'existe pas déjà (idempotent)
  const existing = await adminDb.collection('influencers').doc(targetUid).get();
  if (existing.exists) {
    return res.status(200).json({ uid: targetUid, code: existing.data().code });
  }

  // Vérifie que l'email n'est pas déjà utilisé par un autre influenceur
  const emailCheck = await adminDb
    .collection('influencers')
    .where('email', '==', email.trim().toLowerCase())
    .limit(1)
    .get();
  if (!emailCheck.empty && emailCheck.docs[0].id !== targetUid) {
    return res.status(409).json({ error: 'EMAIL_ALREADY_EXISTS' });
  }

  // Génère un code unique (retry si collision)
  let code;
  let attempts = 0;
  while (attempts < 5) {
    const candidate = generateCode();
    const codeCheck = await adminDb
      .collection('influencers')
      .where('code', '==', candidate)
      .limit(1)
      .get();
    if (codeCheck.empty) { code = candidate; break; }
    attempts++;
  }
  if (!code) {
    return res.status(500).json({ error: 'CODE_GENERATION_FAILED' });
  }

  // Crée le doc influencers avec l'uid Auth comme ID du document
  await adminDb.collection('influencers').doc(targetUid).set({
    uid: targetUid,
    code,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    rib: '',
    active: true,
    totalEarned: 0,
    pendingPayout: 0,
    usageCount: 0,
    conversions: [],
    payoutHistory: [],
    created_at: new Date(),
  });

  return res.status(201).json({ uid: targetUid, code });
}