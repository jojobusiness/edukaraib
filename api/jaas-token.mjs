import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { roomName, isModerator, userId, userName, userEmail } = req.body || {};

    if (!roomName) {
      res.status(400).json({ error: 'roomName is required' });
      return;
    }

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
