import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';

// Génère un code unique format INFLU-XXXXXX (sans I, O, 0, 1 pour éviter confusion)
function generateCode(name = '') {
  // Prend le prénom (premier mot), majuscules, retire les accents et caractères spéciaux
  const base = (name.trim().split(' ')[0] || 'INFLU')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toUpperCase().replace(/[^A-Z]/g, '')
    .slice(0, 12); // max 12 chars pour éviter les codes trop longs
  const digits = String(Math.floor(Math.random() * 90) + 10); // 10-99
  return base + digits;
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
    const candidate = generateCode(name);
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

  // ── Email de bienvenue ───────────────────────────────────────────────────
  try {
    const { Resend } = await import('resend');
    const resendClient = new Resend(process.env.RESEND_API_KEY);
    const firstName = name.trim().split(' ')[0] || 'là';
    const APP_BASE_URL = process.env.APP_BASE_URL || 'https://www.edukaraib.com';

    await resendClient.emails.send({
      from: 'EduKaraib <notifications@edukaraib.com>',
      to: [email.trim().toLowerCase()],
      subject: 'Bienvenue dans le programme partenaire EduKaraib ! 🎤',
      html: `
        <div style="font-family:Inter,system-ui,sans-serif;background:#f5f7fb;padding:24px;">
          <table width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #eef0f4;">
            <tr><td style="background:#0ea5e9;padding:18px 20px;">
              <span style="color:#fff;font-weight:700;font-size:16px;">EduKaraib</span>
            </td></tr>
            <tr><td style="padding:26px;">
              <h1 style="margin:0 0 10px;font-size:22px;color:#0f172a;">
                Bienvenue dans le programme partenaire, ${firstName} ! 🎤
              </h1>
              <p style="color:#334155;font-size:15px;line-height:1.65;">
                Ton compte influenceur est actif. Voici ton code promo personnel a partager avec ton audience :
              </p>

              <div style="background:#f0fdf4;border:2px dashed #22c55e;border-radius:12px;padding:20px;margin:20px 0;text-align:center;">
                <div style="font-size:28px;font-weight:800;letter-spacing:4px;color:#15803d;">${code}</div>
                <div style="color:#166534;font-size:13px;margin-top:8px;font-weight:600;">Ton code promo exclusif</div>
              </div>

              <h2 style="font-size:16px;color:#0f172a;margin:20px 0 10px;">Comment ca marche</h2>
              <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:10px 14px;background:#eff6ff;border-radius:10px 10px 0 0;border-bottom:1px solid #dbeafe;">
                    <span style="font-weight:700;color:#1d4ed8;">Cours unitaire</span>
                    <span style="color:#3b82f6;font-size:13px;margin-left:8px;">-5 EUR pour ton audience</span>
                    <span style="float:right;font-weight:800;color:#1d4ed8;">+5 EUR pour toi</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;background:#f5f3ff;border-bottom:1px solid #ede9fe;">
                    <span style="font-weight:700;color:#7c3aed;">Pack 5h</span>
                    <span style="color:#8b5cf6;font-size:13px;margin-left:8px;">-10 EUR pour ton audience</span>
                    <span style="float:right;font-weight:800;color:#7c3aed;">+10 EUR pour toi</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;background:#f0fdf4;border-radius:0 0 10px 10px;">
                    <span style="font-weight:700;color:#15803d;">Pack 10h</span>
                    <span style="color:#22c55e;font-size:13px;margin-left:8px;">-30 EUR pour ton audience</span>
                    <span style="float:right;font-weight:800;color:#15803d;">+20 EUR pour toi</span>
                  </td>
                </tr>
              </table>

              <div style="background:#fafafa;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin:20px 0;font-size:13px;color:#64748b;line-height:1.7;">
                <strong style="color:#0f172a;">Conditions :</strong><br>
                Le code est utilisable <strong>2 fois par client</strong> — une fois pour un cours unitaire, une fois pour un pack.<br>
                Il est valide <strong>6 mois</strong> a partir d'aujourd'hui.<br>
                Ta commission est creditee automatiquement apres chaque paiement confirme.<br>
                Le virement est declenche depuis ton espace des que tu as renseigne ton IBAN.
              </div>

              <div style="margin-top:20px;">
                <a href="${APP_BASE_URL}/influencer/dashboard" style="background:#facc15;color:#111827;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:12px;display:inline-block;">
                  Acceder a mon espace influenceur
                </a>
              </div>
            </td></tr>
            <tr><td style="padding:12px 26px 24px;color:#64748b;font-size:12px;">
              L'equipe EduKaraib &middot;
              <a href="mailto:contact@edukaraib.com" style="color:#0ea5e9;">contact@edukaraib.com</a>
            </td></tr>
          </table>
        </div>
      `,
    });
  } catch (mailErr) {
    // On ne bloque pas la reponse si le mail echoue
    console.warn('[generate-influencer-code] mail failed:', mailErr?.message);
  }

  return res.status(201).json({ uid: targetUid, code });
}