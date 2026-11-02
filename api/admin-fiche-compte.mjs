// GET /api/admin-fiche-compte?uid=… — tout ce qui est utile sur un compte (02/11/2026).
// Demande de Joseph : cliquer sur un compte dans l'admin et tout voir.
import { adminDb } from './_firebaseAdmin.mjs';
import { requireAdmin } from './_adminAuth.mjs';
import { stripe } from './_stripe.mjs';
import { compteProfPret } from './_compteProf.mjs';
import { resumeCours, resumePaiements } from './_ficheCompte.mjs';
import { nbCreneaux } from '../frontend/lib/offreProf.js';

const iso = (v) => {
  const d = v?.toDate ? v.toDate() : v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
};

export default async function handler(req, res) {
  const moi = await requireAdmin(req, res);
  if (!moi) return;
  const uid = String(req.query?.uid || '');
  if (!uid) return res.status(400).json({ error: 'MISSING_UID' });

  try {
    const snap = await adminDb.collection('users').doc(uid).get();
    if (!snap.exists) return res.status(404).json({ error: 'NOT_FOUND' });
    const u = snap.data();
    const prof = u.role === 'teacher';

    const [leconsSnap, paySnap, enfantsSnap, avisSnap, couponsSnap] = await Promise.all([
      adminDb.collection('lessons').where(prof ? 'teacher_id' : 'acces', prof ? '==' : 'array-contains', uid).get(),
      adminDb.collection('payments').where(prof ? 'teacher_uid' : 'payer_uid', '==', uid).get(),
      adminDb.collection('students').where('parent_id', '==', uid).get(),
      adminDb.collection('reviews').where(prof ? 'teacher_id' : 'left_by_parent_id', '==', uid).get(),
      adminDb.collection('coupons').where('user_uid', '==', uid).get(),
    ]);
    const notes = avisSnap.docs.map((d) => Number(d.data().rating || 0)).filter((n) => n > 0);

    return res.status(200).json({
      compte: {
        uid,
        role: u.role || null,
        nom: u.fullName || [u.firstName, u.lastName].filter(Boolean).join(' ') || '',
        photo: u.avatarUrl || u.photoURL || null,
        email: u.email || null,
        emailVerifie: u.email_verified === true,
        telephone: u.phone || null,
        ville: u.city || null,
        naissance: u.birth || null,
        niveau: u.level || null,
        desactive: u.disabled === true,
        creeLe: iso(u.createdAt),
        derniereVenue: iso(u.lastSeenAt),
        source: u.acquisition?.source || null,
        sourceDeclaree: u.acquisition?.declared || null,
        codePartenaire: u.acquisition?.code || null,
      },
      cours: resumeCours(leconsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      paiements: resumePaiements(paySnap.docs.map((d) => d.data())),
      enfants: enfantsSnap.docs.map((d) => ({
        id: d.id, nom: d.data().full_name || '', naissance: d.data().birth_date || null, niveau: d.data().school_level || null,
      })),
      avis: {
        nb: notes.length,
        moyenne: notes.length ? notes.reduce((a, b) => a + b, 0) / notes.length : null,
      },
      coupons: couponsSnap.docs.map((d) => ({ code: d.data().code, utilise: !!d.data().used })),
      prof: prof ? {
        matieres: Array.isArray(u.subjects) ? u.subjects.join(', ') : (u.subjects || ''),
        tarif: Number(u.price_per_hour || 0),
        tarifVisio: u.visio_enabled ? Number(u.visio_same_rate ? u.price_per_hour : u.visio_price_per_hour) || 0 : null,
        presentiel: !!u.presentiel_enabled,
        visible: u.offer_enabled !== false,
        creneauxAVenir: nbCreneaux(u.availability),
        stripePret: await compteProfPret(stripe, u.stripeAccountId),
      } : null,
    });
  } catch (e) {
    console.error('[admin-fiche-compte]', e?.message || e);
    return res.status(500).json({ error: 'INTERNAL' });
  }
}
