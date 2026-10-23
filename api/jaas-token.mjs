import jwt from 'jsonwebtoken';
import { adminDb, verifyAuth } from './_firebaseAdmin.mjs';
import { participeAuCours } from './_fichesEleves.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // ✅ Vérifier que l'appelant est authentifié
  // Sans ça, n'importe qui peut obtenir un JWT JaaS avec isModerator:true
  // et rejoindre/modérer n'importe quelle salle visio
  const auth = await verifyAuth(req, res);
  if (!auth) return;

  try {
    const { roomName, lessonId, token: lienVisio, userName } = req.body || {};

    if (!roomName || !lessonId) {
      res.status(400).json({ error: 'roomName and lessonId are required' });
      return;
    }

    // 🔒 23/10/2026 — Avant, tout compte connecté recevait un jeton valable pour
    // TOUTES les salles. Désormais : seulement les comptes du cours, avec le
    // lien visio en cours de validité (même contrôle que VisioRoom.jsx).
    // Et le prof est enfin modérateur : on cherchait le cours sous le nom
    // complet de la salle, il n'était jamais trouvé.
    const lessonSnap = await adminDb.collection('lessons').doc(String(lessonId)).get();
    if (!lessonSnap.exists) {
      res.status(404).json({ error: 'LESSON_NOT_FOUND' });
      return;
    }
    const lecon = lessonSnap.data() || {};
    const v = lecon.visio || {};
    if (v.revoked === true || !lienVisio || !String(v.joinUrl || '').includes(String(lienVisio))) {
      res.status(403).json({ error: 'LIEN_VISIO_INVALIDE' });
      return;
    }
    if (!participeAuCours(auth.uid, lecon) && !(lecon.acces || []).includes(auth.uid)) {
      res.status(403).json({ error: 'PAS_DANS_LE_COURS' });
      return;
    }
    const isModerator = String(lecon.teacher_id) === auth.uid;
    const userId = auth.uid;
    const userEmail = auth.email || '';

    const appId = process.env.JAAS_APP_ID;
    const kid = process.env.JAAS_API_KEY_KID;
    const privateKey = process.env.JAAS_PRIVATE_KEY;

    if (!appId || !kid || !privateKey) {
      res.status(500).json({ error: 'JAAS env vars missing' });
      return;
    }

    const now = Math.floor(Date.now() / 1000);

    const payload = {
      aud: 'jitsi',
      iss: 'chat',
      sub: appId,
      // ici on autorise toutes les rooms de cette app
      room: '*',
      nbf: now - 10,
      exp: now + 60 * 60, // 1h

      context: {
        user: {
          id: userId || 'anonymous',
          name: userName || 'Utilisateur',
          email: userEmail || '',
          // JAAS attend une string "true"/"false"
          moderator: isModerator ? 'true' : 'false',
          'hidden-from-recorder': false,
        },
        features: {
          livestreaming: false,
          recording: false,
          transcription: false,
          'outbound-call': false,
        },
        room: {
          regex: false,
        },
      },
    };

    const token = jwt.sign(payload, privateKey, {
      algorithm: 'RS256',
      keyid: kid,
    });

    res.status(200).json({ token });
  } catch (err) {
    console.error('jaas-token error', err);
    res.status(500).json({ error: 'jaas-token failed' });
  }
}
