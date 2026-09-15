// Demande de partenariat depuis /partenaire (association, établissement, groupe…).
// Le compte de connexion est créé côté client (Firebase Auth) ; cette API crée
// la fiche partenaire et le rôle, que le client ne peut pas s'attribuer seul.
// Le code reste INACTIF jusqu'à la validation par l'admin : on ne reverse pas
// d'argent à une structure non vérifiée.
import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';
import {
  PARTNERS_COLLECTION, PARTNER_ROLE, PARTNER_MODEL, PARTNER_KINDS, PARTNER_CODE_REGEX,
  normalizePartnerCode, codeFromName, defaultPartnerExpiry,
} from './_partners.mjs';
import { sendPartnerWelcomeEmail, sendAdminNewPartnerEmail } from './_partnerEmails.mjs';

async function codeIsFree(code) {
  const snap = await adminDb.collection(PARTNERS_COLLECTION).where('code', '==', code).limit(1).get();
  return snap.empty;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  const auth = await verifyAuth(req, res);
  if (!auth) return;
  const uid = auth.uid;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const structureName = String(body.structureName || '').trim();
  const contactName = String(body.contactName || '').trim();
  const kind = String(body.kind || '');
  const phone = String(body.phone || '').trim().slice(0, 30);
  const email = String(auth.email || body.email || '').trim().toLowerCase();

  if (structureName.length < 2 || structureName.length > 80) return res.status(400).json({ error: 'INVALID_STRUCTURE_NAME' });
  if (!PARTNER_KINDS[kind]) return res.status(400).json({ error: 'INVALID_KIND' });
  if (!email) return res.status(400).json({ error: 'MISSING_EMAIL' });

  // Idempotent : une 2e soumission renvoie la fiche existante
  const partnerRef = adminDb.collection(PARTNERS_COLLECTION).doc(uid);
  const existing = await partnerRef.get();
  if (existing.exists) {
    const d = existing.data();
    return res.status(200).json({ uid, code: d.code, pending: d.active !== true });
  }

  // Un compte parent / élève / prof ne devient pas partenaire par ce formulaire
  const userRef = adminDb.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const role = userSnap.exists ? userSnap.data()?.role : null;
  if (role && role !== PARTNER_ROLE) return res.status(409).json({ error: 'EMAIL_USED_BY_OTHER_ACCOUNT' });

  const emailTaken = await adminDb.collection(PARTNERS_COLLECTION).where('email', '==', email).limit(1).get();
  if (!emailTaken.empty) return res.status(409).json({ error: 'EMAIL_ALREADY_PARTNER' });

  let code = normalizePartnerCode(body.code);
  if (code) {
    if (!PARTNER_CODE_REGEX.test(code)) return res.status(400).json({ error: 'INVALID_CODE' });
    if (!(await codeIsFree(code))) return res.status(409).json({ error: 'CODE_TAKEN' });
  } else {
    for (let i = 0; i < 5 && !code; i++) {
      const candidate = codeFromName(structureName);
      if (await codeIsFree(candidate)) code = candidate;
    }
    if (!code) return res.status(500).json({ error: 'CODE_GENERATION_FAILED' });
  }

  const [firstName, ...rest] = (contactName || structureName).split(' ');
  await userRef.set({
    uid,
    email,
    fullName: contactName || structureName,
    firstName: firstName || '',
    lastName: rest.join(' '),
    phone,
    role: PARTNER_ROLE,
    partner_structure: structureName,
    createdAt: new Date(),
  }, { merge: true });

  await partnerRef.set({
    uid,
    model: PARTNER_MODEL,
    kind,
    code,
    name: structureName,
    contact_name: contactName,
    email,
    phone,
    rib: '',
    active: false,
    pending_review: true,
    expires_at: defaultPartnerExpiry(),
    totalEarned: 0,
    pendingPayout: 0,
    usageCount: 0,
    familiesCount: 0,
    conversions: [],
    payoutHistory: [],
    created_at: new Date(),
  });

  // await obligatoire : Vercel gèle la fonction dès la réponse envoyée
  await Promise.all([
    sendPartnerWelcomeEmail({ to: email, structureName, contactName, code, pending: true }),
    sendAdminNewPartnerEmail({ structureName, kind: PARTNER_KINDS[kind], email, code }),
  ]);

  return res.status(201).json({ uid, code, pending: true });
}
