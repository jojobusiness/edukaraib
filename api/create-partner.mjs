// Admin — crée un partenaire en un seul formulaire (association, établissement,
// groupe, créateur…) : compte de connexion + code + mail de bienvenue avec le
// lien pour choisir son mot de passe.
import { adminDb, verifyAuth, getAuthAdmin } from './_firebaseAdmin.mjs';
import {
  PARTNERS_COLLECTION, PARTNER_ROLE, PARTNER_MODEL, PARTNER_KINDS, PARTNER_CODE_REGEX,
  normalizePartnerCode, codeFromName, defaultPartnerExpiry, normalizeIban, isValidIban,
} from './_partners.mjs';
import { sendPartnerWelcomeEmail } from './_partnerEmails.mjs';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function codeIsFree(code) {
  const snap = await adminDb.collection(PARTNERS_COLLECTION).where('code', '==', code).limit(1).get();
  return snap.empty;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  const auth = await verifyAuth(req, res);
  if (!auth) return;
  const adminSnap = await adminDb.collection('users').doc(auth.uid).get();
  if (!adminSnap.exists || adminSnap.data()?.role !== 'admin') {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const structureName = String(body.structureName || '').trim();
  const contactName = String(body.contactName || '').trim();
  const kind = String(body.kind || '');
  const email = String(body.email || '').trim().toLowerCase();
  const iban = normalizeIban(body.iban);

  if (structureName.length < 2 || structureName.length > 80) return res.status(400).json({ error: 'INVALID_STRUCTURE_NAME' });
  if (!PARTNER_KINDS[kind]) return res.status(400).json({ error: 'INVALID_KIND' });
  if (!EMAIL_REGEX.test(email)) return res.status(400).json({ error: 'INVALID_EMAIL' });
  if (iban && !isValidIban(iban)) return res.status(400).json({ error: 'INVALID_IBAN' });

  // Code choisi par l'admin, sinon tiré du nom
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

  const emailTaken = await adminDb.collection(PARTNERS_COLLECTION).where('email', '==', email).limit(1).get();
  if (!emailTaken.empty) return res.status(409).json({ error: 'EMAIL_ALREADY_PARTNER' });

  // Compte de connexion : on réutilise un compte Auth sans rôle, jamais un
  // compte parent/élève/prof (il perdrait son espace).
  const authAdmin = getAuthAdmin();
  let uid;
  try {
    const existing = await authAdmin.getUserByEmail(email);
    const userSnap = await adminDb.collection('users').doc(existing.uid).get();
    const role = userSnap.exists ? userSnap.data()?.role : null;
    if (role && role !== PARTNER_ROLE) {
      return res.status(409).json({ error: 'EMAIL_USED_BY_OTHER_ACCOUNT', role });
    }
    uid = existing.uid;
  } catch (e) {
    if (e?.code !== 'auth/user-not-found') throw e;
    const created = await authAdmin.createUser({ email, displayName: contactName || structureName });
    uid = created.uid;
  }

  const [firstName, ...rest] = (contactName || structureName).split(' ');
  await adminDb.collection('users').doc(uid).set({
    uid,
    email,
    fullName: contactName || structureName,
    firstName: firstName || '',
    lastName: rest.join(' '),
    role: PARTNER_ROLE,
    partner_structure: structureName,
    createdAt: new Date(),
  }, { merge: true });

  await adminDb.collection(PARTNERS_COLLECTION).doc(uid).set({
    uid,
    model: PARTNER_MODEL,
    kind,
    code,
    name: structureName,
    contact_name: contactName,
    email,
    rib: iban,
    active: true,
    pending_review: false,
    expires_at: defaultPartnerExpiry(),
    totalEarned: 0,
    pendingPayout: 0,
    usageCount: 0,
    familiesCount: 0,
    conversions: [],
    payoutHistory: [],
    created_at: new Date(),
    created_by: auth.uid,
  });

  let passwordLink = null;
  try {
    const APP = process.env.APP_BASE_URL || 'https://www.edukaraib.com';
    passwordLink = await authAdmin.generatePasswordResetLink(email, { url: `${APP}/partenaire` });
  } catch (e) {
    console.warn('[create-partner] password link failed:', e?.message);
  }

  const emailSent = await sendPartnerWelcomeEmail({ to: email, structureName, contactName, code, passwordLink });
  return res.status(201).json({ uid, code, emailSent });
}
