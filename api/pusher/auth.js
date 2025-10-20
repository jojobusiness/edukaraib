import Pusher from "pusher";
import admin from "firebase-admin";

if (!admin.apps.length) {
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT && JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: svc ? admin.credential.cert(svc) : admin.credential.applicationDefault() });
}

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
});

// Vercel: export default handler(req,res)
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.replace(/^Bearer\s+/i, "") || req.body?.idToken;
    if (!idToken) return res.status(401).json({ error: "missing_token" });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const { channel_name, socket_id } = req.body || {};
    if (!channel_name || !socket_id) return res.status(400).json({ error: "bad_request" });

    // Presence: on peut inclure l'info utilisateur
    const presenceData = {
      user_id: uid,
      user_info: { uid },
    };

    let authResponse;
    if (channel_name.startsWith("presence-")) {
      authResponse = pusher.authorizeChannel(socket_id, channel_name, presenceData);
    } else {
      authResponse = pusher.authorizeChannel(socket_id, channel_name);
    }

    return res.send(authResponse);
  } catch (e) {
    console.error("pusher/auth error", e);
    return res.status(401).json({ error: "unauthorized" });
  }
}