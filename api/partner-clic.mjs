// POST /api/partner-clic { code } — compte une arrivée par le lien d'un partenaire
// (02/11/2026). Sans ça, impossible de distinguer un créateur dont personne ne
// clique d'un créateur dont les clics ne convertissent pas. Public, car le
// visiteur n'a pas de compte ; aucune donnée personnelle n'est gardée. Le
// navigateur n'envoie qu'un clic par code et par 24 h : c'est un ordre de
// grandeur, jamais une base de paiement.
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './_firebaseAdmin.mjs';
import { PARTNERS_COLLECTION, PARTNER_CODE_REGEX, normalizePartnerCode } from './_partners.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  const code = normalizePartnerCode(b?.code);
  if (!PARTNER_CODE_REGEX.test(code)) return res.status(204).end();
  try {
    const snap = await adminDb.collection(PARTNERS_COLLECTION)
      .where('code', '==', code).where('active', '==', true).limit(1).get();
    if (!snap.empty) await snap.docs[0].ref.update({ clicks: FieldValue.increment(1) });
  } catch (e) {
    console.warn('[partner-clic]', e?.message);
  }
  return res.status(204).end();
}
