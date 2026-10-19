// Ce que chaque paiement nous laisse — onglet « Paiements & Revenus » (18/10/2026).
// Déplacé hors de Diagnostics le 19/10/2026 à la demande de Joseph : « ça
// serait plus logique dans la partie paiement ».
//
// Le prof touche 100 % de son tarif : les frais Stripe sortent de notre
// commission. Quand un coupon ramène cette commission à 0 €, on paie les
// frais de notre poche — c'est le seul cas à surveiller, et il s'affiche.
// Règles et sources Stripe : api/_marge.mjs.
import { adminDb } from './_firebaseAdmin.mjs';
import { requireAdmin } from './_adminAuth.mjs';
import { resumeMarges, COMPTE_ACTIF_CENTS } from './_marge.mjs';

const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);
const iso = (d) => (d ? d.toISOString() : null);

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const [usersSnap, paymentsSnap] = await Promise.all([
      adminDb.collection('users').get(),
      adminDb.collection('payments').get(),
    ]);
    const noms = new Map(usersSnap.docs.map((d) => [d.id, d.data()?.fullName]));
    const nomDe = (uid) => noms.get(uid) || uid || '—';

    const paiements = paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const m = resumeMarges(paiements);

    const debutDuMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const profsPayesCeMois = new Set(
      paiements
        .filter((p) => p.status === 'released'
          && (toDate(p.released_at) || toDate(p.updated_at) || new Date(0)) >= debutDuMois)
        .map((p) => p.teacher_uid).filter(Boolean),
    );

    return res.status(200).json({
      genere_le: new Date().toISOString(),
      nbPaiements: m.nbPaiements,
      estimes: m.estimes,
      encaisse: m.encaisse / 100,
      verseProfs: m.verseProfs / 100,
      commission: m.commission / 100,
      fraisStripe: m.fraisStripe / 100,
      fraisVirement: m.fraisVirement / 100,
      net: m.net / 100,
      comptesActifsCeMois: profsPayesCeMois.size,
      coutComptesActifs: (profsPayesCeMois.size * COMPTE_ACTIF_CENTS) / 100,
      negatifs: m.negatifs.slice(0, 20).map((l) => ({
        id: l.source.id,
        date: iso(toDate(l.source.created_at) || toDate(l.source.updated_at)),
        prof: nomDe(l.source.teacher_uid),
        methode: l.methode,
        estime: l.estime,
        rembourse: l.rembourse,
        brut: l.brut / 100,
        partProf: l.prof / 100,
        commission: l.commission / 100,
        fraisStripe: l.fraisStripe / 100,
        net: l.net / 100,
      })),
    });
  } catch (e) {
    return res.status(500).json({ error: 'MARGES_FAILED', message: e?.message });
  }
}
