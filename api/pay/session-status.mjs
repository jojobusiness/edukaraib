import { stripe } from '../_stripe.mjs';
import { adminDb, verifyAuth } from '../_firebaseAdmin.mjs';

function readBody(req){ try{ if(!req.body) return {}; if(typeof req.body==='string') return JSON.parse(req.body); return req.body; }catch{ return {}; } }

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  const auth = await verifyAuth(req,res); if(!auth) return;
  const { sessionId } = readBody(req);
  if(!sessionId) return res.status(400).json({error:'MISSING_SESSION_ID'});

  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
  const pi = session.payment_intent;
  const lessonId = (session.metadata && session.metadata.lesson_id) || (pi?.metadata?.lesson_id) || null;

  let lessonData = null;
  if (lessonId) {
    const snap = await adminDb.collection('lessons').doc(lessonId).get();
    if (snap.exists) lessonData = snap.data();
  }

  return res.json({
    session_id: sessionId,
    lesson_id: lessonId,
    payment_intent: typeof pi === 'object' ? pi.id : pi,
    amount_cents: session.amount_total || pi?.amount || 0,
    paid: session.payment_status === 'paid',
    lesson: lessonData || null,
  });
}