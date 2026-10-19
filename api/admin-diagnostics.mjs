// Tous les relevés d'un coup, pour l'onglet « 🩺 Diagnostics » de l'admin.
// Demande de Joseph (15/10/2026) : « mets tout dans l'admin, je veux rien
// faire sur un terminal, et ça vaut pour tout le reste ».
//
// Reprend exactement ce que faisaient les scripts :
//   diag-offre-profs · diag-acquisition · diag-retours · diag-messages
// Les scripts restent dans `scripts/` (utiles en automatisation), mais ce
// n'est plus la façon normale de les consulter.
//
// Côté serveur parce que `messages` et `demandes_contact` ne sont plus
// lisibles depuis un navigateur, même par l'admin (secret des correspondances).
import { adminDb } from './_firebaseAdmin.mjs';
import { requireAdmin } from './_adminAuth.mjs';
import { nbCreneaux, etatProfil } from '../frontend/lib/offreProf.js';
import { statsDemandes } from '../frontend/lib/statsMessages.js';
import { aPurger, derniereActivite, MOIS_CONSERVATION } from './_retention.mjs';

const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);
const iso = (d) => (d ? d.toISOString() : null);
const estTest = (u) => /test|essai|demo/i.test(`${u.fullName || ''} ${u.email || ''}`);

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const [usersSnap, reviewsSnap, lessonsSnap, demandesSnap, convsSnap, signalementsSnap] = await Promise.all([
      adminDb.collection('users').get(),
      adminDb.collection('reviews').get(),
      adminDb.collection('lessons').get(),
      adminDb.collection('demandes_contact').get(),
      adminDb.collection('conversations').get(),
      adminDb.collection('signalements').where('traite', '==', false).get(),
    ]);

    const users = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));

    // ── 1. Offre profs (diag-offre-profs)
    const avisParProf = {};
    reviewsSnap.docs.forEach((d) => {
      const t = d.data()?.teacher_id;
      if (t) avisParProf[t] = (avisParProf[t] || 0) + 1;
    });
    const profs = users.filter((u) => u.role === 'teacher').map((t) => {
      const nbAvis = avisParProf[t.uid] || 0;
      const manques = etatProfil({ profil: t, nbAvis });
      return {
        uid: t.uid,
        nom: t.fullName || t.uid,
        ville: t.city || '',
        photo: !!t.avatarUrl,
        avis: nbAvis,
        creneaux: nbCreneaux(t.availability),
        reservable: !manques.some((m) => m.bloquant),
        manques: manques.map((m) => m.code),
      };
    });
    const offre = {
      inscrits: profs.length,
      passentLeFiltre: profs.filter((p) => !p.manques.includes('photo') && !p.manques.includes('masque')).length,
      avecCreneau: profs.filter((p) => p.creneaux > 0).length,
      reservables: profs.filter((p) => p.reservable).length,
      profs: profs.sort((a, b) => Number(b.reservable) - Number(a.reservable) || b.avis - a.avis),
    };

    // ── 2. Acquisition (diag-acquisition)
    const comptes = users.filter((u) => u.role !== 'admin' && !estTest(u))
      .map((u) => ({ ...u, cree: toDate(u.createdAt), vu: toDate(u.lastSeenAt) }));
    const sourceDe = (u) => {
      const a = u.acquisition;
      if (!a) return 'non mesuré (avant le 21/09)';
      if (a.source && !['inconnu', 'direct'].includes(a.source)) return a.source;
      if (a.declared) return `${a.declared} (déclaré)`;
      return a.source || 'inconnu';
    };
    const parSource = {};
    comptes.forEach((u) => { parSource[sourceDe(u)] = (parSource[sourceDe(u)] || 0) + 1; });
    const acquisition = {
      comptes: comptes.length,
      parSource,
      viaMethode: comptes.filter((u) => (u.acquisition?.landing || '').startsWith('/methode')
        || u.acquisition?.campaign === 'methode').length,
      derniers: comptes.filter((u) => u.cree).sort((a, b) => b.cree - a.cree).slice(0, 10)
        .map((u) => ({ nom: u.fullName || u.uid, role: u.role, cree: iso(u.cree), source: sourceDe(u) })),
    };

    // ── 3. Qui revient (diag-retours)
    const jours = (d) => (d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null);
    const retours = {
      total: comptes.length,
      jamais: comptes.filter((u) => !u.vu).length,
      recents7j: comptes.filter((u) => jours(u.vu) !== null && jours(u.vu) <= 7)
        .map((u) => ({ nom: u.fullName || u.uid, role: u.role, jours: jours(u.vu) })),
      profsRevenus7j: comptes.filter((u) => u.role === 'teacher' && jours(u.vu) !== null && jours(u.vu) <= 7).length,
      profsTotal: comptes.filter((u) => u.role === 'teacher').length,
    };

    // ── 4. Demandes de mise en relation (diag-messages)
    const demandes = statsDemandes({
      demandes: demandesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      users,
      lessons: lessonsSnap.docs.map((d) => d.data()),
      jours: Number(req.query?.jours) || 30,
    });

    // ── 5. Conservation : ce que la purge fera cette nuit
    const convs = convsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const conservation = {
      mois: MOIS_CONSERVATION,
      conversations: convs.length,
      gelees: convs.filter((c) => c.conservation_litige).length,
      aPurgerCetteNuit: convs.filter((c) => aPurger(c).purger).length,
      plusAncienne: iso(convs.map(derniereActivite).filter(Boolean).sort((a, b) => a - b)[0] || null),
      signalementsNonTraites: signalementsSnap.size,
    };


    return res.status(200).json({
      genere_le: new Date().toISOString(),
      offre,
      acquisition,
      retours,
      demandes: { totaux: demandes.totaux, lignes: demandes.lignes, parProf: demandes.parProf },
      conservation,
    });
  } catch (e) {
    return res.status(500).json({ error: 'DIAG_FAILED', message: e?.message });
  }
}
