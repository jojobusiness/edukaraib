// Fiche d'un compte, ouverte d'un clic depuis l'onglet Comptes (02/11/2026).
// Rien sur les messages : secret des correspondances.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import fetchWithAuth from '../../utils/fetchWithAuth';
import { libelleDerniereVenue } from '../../lib/derniereVenue';

const ROLES = { teacher: 'Professeur', parent: 'Parent', student: 'Élève', influencer: 'Partenaire', admin: 'Admin' };
const date = (v) => (v ? new Date(v).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }) : '—');
const euros = (n) => `${Number(n || 0).toFixed(2).replace('.', ',')} €`;

function Chiffre({ label, valeur }) {
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
      <div className="text-lg font-extrabold text-gray-900">{valeur}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function Ligne({ label, children }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-gray-100 last:border-0 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-900 font-medium text-right break-words min-w-0">{children ?? '—'}</span>
    </div>
  );
}

export default function FicheCompte({ uid, onClose }) {
  const [f, setF] = useState(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    let vivant = true;
    setF(null);
    setErreur('');
    fetchWithAuth(`/api/admin-fiche-compte?uid=${encodeURIComponent(uid)}`)
      .then((r) => { if (vivant) setF(r); })
      .catch((e) => { if (vivant) setErreur(e.message || 'Chargement impossible'); });
    return () => { vivant = false; };
  }, [uid]);

  const c = f?.compte;
  const venue = c ? libelleDerniereVenue(c.creeLe, c.derniereVenue) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label="Fiche du compte" className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl p-6">
        <div className="flex justify-end">
          <button type="button" onClick={onClose} aria-label="Fermer" className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {erreur && <p className="text-sm text-red-600">{erreur}</p>}
        {!f && !erreur && <p className="text-sm text-gray-500 py-8 text-center">Chargement…</p>}

        {c && (
          <>
            <div className="flex items-center gap-4">
              <img src={c.photo || '/avatar-default.png'} alt="" className="w-20 h-20 rounded-full object-cover border" />
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-gray-900 truncate">{c.nom || 'Sans nom'}</h2>
                <p className="text-sm text-gray-500">
                  {ROLES[c.role] || c.role} · inscrit le {date(c.creeLe)}
                  {c.desactive && <span className="ml-2 text-red-600 font-semibold">désactivé</span>}
                </p>
                <p className="text-sm text-gray-700" title={venue.titre}>Dernière venue : {venue.texte}</p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Chiffre label={c.role === 'teacher' ? 'cours donnés' : 'cours faits'} valeur={f.cours.termines} />
              <Chiffre label="à venir" valeur={f.cours.aVenir} />
              <Chiffre label="en attente" valeur={f.cours.enAttente} />
              <Chiffre label={c.role === 'teacher' ? 'gagné' : 'payé'} valeur={euros(c.role === 'teacher' ? f.paiements.gagne : f.paiements.paye)} />
            </div>

            <div className="mt-5">
              <Ligne label="E-mail">{c.email}{c.email && (c.emailVerifie ? ' ✓' : ' (non vérifié)')}</Ligne>
              <Ligne label="Téléphone">{c.telephone}</Ligne>
              <Ligne label="Ville">{c.ville}</Ligne>
              <Ligne label="Niveau">{c.niveau}</Ligne>
              <Ligne label="Naissance">{c.naissance}</Ligne>
              <Ligne label="Venu par">{[c.source, c.sourceDeclaree, c.codePartenaire].filter(Boolean).join(' · ') || null}</Ligne>
              <Ligne label="Paiements">{`${f.paiements.nb} encaissé(s), ${f.paiements.rembourses} remboursé(s)`}</Ligne>
              <Ligne label="Cours au total">{`${f.cours.total} (${f.cours.refuses} refusé(s))`}</Ligne>
              <Ligne label={c.role === 'teacher' ? 'Avis reçus' : 'Avis laissés'}>
                {f.avis.nb ? `${f.avis.nb}${f.avis.moyenne ? ` · ${f.avis.moyenne.toFixed(1)}/5` : ''}` : '0'}
              </Ligne>
              {f.coupons.length > 0 && (
                <Ligne label="Coupons">{f.coupons.map((x) => `${x.code}${x.utilise ? ' (utilisé)' : ''}`).join(', ')}</Ligne>
              )}
            </div>

            {f.prof && (
              <div className="mt-5">
                <h3 className="text-sm font-bold text-gray-900 mb-1">Côté prof</h3>
                <Ligne label="Matières">{f.prof.matieres}</Ligne>
                <Ligne label="Tarif">
                  {[f.prof.presentiel && `présentiel ${euros(f.prof.tarif)}`, f.prof.tarifVisio != null && `visio ${euros(f.prof.tarifVisio)}`].filter(Boolean).join(' · ') || null}
                </Ligne>
                <Ligne label="Créneaux à venir">{f.prof.creneauxAVenir}</Ligne>
                <Ligne label="Profil visible">{f.prof.visible ? 'oui' : 'masqué'}</Ligne>
                <Ligne label="Peut recevoir ses virements">{f.prof.stripePret ? 'oui (Stripe)' : 'non'}</Ligne>
              </div>
            )}

            {f.enfants.length > 0 && (
              <div className="mt-5">
                <h3 className="text-sm font-bold text-gray-900 mb-1">Enfants</h3>
                {f.enfants.map((e) => (
                  <Ligne key={e.id} label={e.nom || 'Sans nom'}>{[e.niveau, e.naissance].filter(Boolean).join(' · ') || null}</Ligne>
                ))}
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-2">
              <Link to={`/chat/${c.uid}?from=admin`} className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-dark">
                Contacter
              </Link>
              {f.prof && (
                <Link to={`/profils/${c.uid}`} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                  Voir sa page publique
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
