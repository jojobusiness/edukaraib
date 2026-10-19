// Onglet admin « Paiements & Revenus » — refait le 19/10/2026.
// L'ancien lisait des champs morts (succeeded, amount, refunds, payouts) et
// affichait 0 partout ; son bouton « Marquer viré » ne pouvait rien écrire.
// Règles de lecture : frontend/lib/paiements.js. Marges : MargesSection.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import fetchWithAuth from '../../utils/fetchWithAuth';
import { STATUTS, filtrer, normaliser, parProf, totaux } from '../../lib/paiements';
import MargesSection from './MargesSection';

const euros = (n) => `${Number(n || 0).toFixed(2).replace('.', ',')} €`;
const dateFr = (d) => (d
  ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`
  : '—');
const nomDe = (u, uid) => (u
  ? (u.fullName || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || uid)
  : (uid || '—'));

const TONS = {
  gris: 'bg-slate-100 text-slate-600',
  bleu: 'bg-blue-100 text-blue-800',
  vert: 'bg-green-100 text-green-800',
  ambre: 'bg-amber-100 text-amber-800',
  rouge: 'bg-red-100 text-red-700',
};

function Chiffre({ valeur, libelle, alerte = false }) {
  return (
    <div className={`rounded-xl border p-3 ${alerte ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <div className={`text-xl font-extrabold ${alerte ? 'text-amber-800' : 'text-slate-900'}`}>{valeur}</div>
      <div className="text-xs text-slate-600">{libelle}</div>
    </div>
  );
}

/**
 * @param users     comptes déjà chargés par AdminDashboard (noms, état Stripe)
 * @param onRembourser(doc)  ouvre la fenêtre de remboursement existante
 * @param version   incrémenté par le parent après un remboursement → recharge
 */
export default function PaiementsSection({ users = [], onRembourser, version = 0 }) {
  const [docs, setDocs] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [filtre, setFiltre] = useState({ du: '', au: '', statut: 'tous', nonFinalises: false });
  const [versement, setVersement] = useState(null); // id en cours

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur('');
    try {
      const snap = await getDocs(query(collection(db, 'payments'), orderBy('created_at', 'desc'), limit(500)));
      setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      setErreur(e?.message || 'Lecture impossible');
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger, version]);

  const comptes = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const lignes = useMemo(() => docs.map(normaliser), [docs]);
  const visibles = useMemo(() => filtrer(lignes, filtre), [lignes, filtre]);
  const t = useMemo(() => totaux(visibles), [visibles]);
  const profs = useMemo(() => parProf(visibles), [visibles]);
  // L'argent dû ne dépend pas du filtre : on ne doit jamais le perdre de vue.
  const dus = useMemo(() => lignes.filter((l) => l.aVerser), [lignes]);

  const maj = (cle) => (e) => setFiltre((f) => ({ ...f, [cle]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const verser = async (l) => {
    const prof = nomDe(comptes.get(l.profUid), l.profUid);
    if (!window.confirm(`Verser ${euros(l.partProf)} à ${prof} par Stripe ?`)) return;
    setVersement(l.id);
    try {
      await fetchWithAuth('/api/admin-verser-prof', { method: 'POST', body: JSON.stringify({ paymentId: l.id }) });
      await charger();
    } catch (e) {
      const msg = String(e?.message || '');
      alert(msg.includes('PROF_SANS_STRIPE')
        ? `${prof} n'a pas encore connecté son compte Stripe. Il a reçu un mail ; relance-le, puis réessaie.`
        : `Versement impossible : ${msg}`);
    } finally {
      setVersement(null);
    }
  };

  return (
    <div className="space-y-6">
      <MargesSection />

      {/* Chiffres */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Chiffre valeur={euros(t.encaisse)} libelle={`Encaissé (${t.nb} paiements)`} />
        <Chiffre valeur={euros(t.commission)} libelle="Notre commission (avant frais)" />
        <Chiffre valeur={euros(t.verseProfs)} libelle="Versé aux profs" />
        <Chiffre valeur={euros(t.enAttenteCours)} libelle="Part prof, cours pas encore fait" />
        <Chiffre valeur={euros(t.duAuxProfs)} libelle={`Dû aux profs (${t.nbDus})`} alerte={t.nbDus > 0} />
        <Chiffre valeur={euros(t.rembourse)} libelle="Remboursé aux familles" />
      </div>

      {/* Argent dû : toujours visible, quel que soit le filtre */}
      {dus.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h3 className="font-bold text-amber-900">💸 Argent qu'on doit aux profs</h3>
          <p className="mb-3 text-xs text-amber-800">
            Cours faits et payés, mais le prof n'avait pas connecté Stripe au moment du versement. Dès qu'il l'a fait, verse-lui ici : il reçoit 100 % de son tarif.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase text-amber-800">
                <tr>
                  <th className="px-3 py-2">Professeur</th>
                  <th className="px-3 py-2 text-right">Montant</th>
                  <th className="px-3 py-2">Payé le</th>
                  <th className="px-3 py-2">Stripe</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {dus.map((l) => {
                  const u = comptes.get(l.profUid);
                  const pret = !!(u?.stripeAccountId && u?.stripeChargesEnabled);
                  return (
                    <tr key={l.id} className="border-t border-amber-200">
                      <td className="px-3 py-2 font-semibold">{nomDe(u, l.profUid)}</td>
                      <td className="px-3 py-2 text-right font-bold">{euros(l.partProf)}</td>
                      <td className="px-3 py-2">{dateFr(l.date)}</td>
                      <td className="px-3 py-2">
                        {pret
                          ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">connecté</span>
                          : <span className="text-xs text-amber-900">pas encore connecté</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          disabled={!pret || versement === l.id}
                          onClick={() => verser(l)}
                          className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
                          title={pret ? '' : 'Le prof doit d’abord connecter son compte Stripe'}
                        >
                          {versement === l.id ? 'Versement…' : 'Verser via Stripe'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Filtres */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-3">
        <label className="text-sm text-slate-600">
          Du
          <input type="date" data-pas-une-saisie className="mt-1 block rounded border px-3 py-2" value={filtre.du} onChange={maj('du')} />
        </label>
        <label className="text-sm text-slate-600">
          Au
          <input type="date" data-pas-une-saisie className="mt-1 block rounded border px-3 py-2" value={filtre.au} onChange={maj('au')} />
        </label>
        <label className="text-sm text-slate-600">
          Statut
          <select data-pas-une-saisie className="mt-1 block rounded border px-3 py-2" value={filtre.statut} onChange={maj('statut')}>
            <option value="tous">Tous</option>
            {Object.entries(STATUTS).map(([k, s]) => <option key={k} value={k}>{s.libelle}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
          <input type="checkbox" data-pas-une-saisie checked={filtre.nonFinalises} onChange={maj('nonFinalises')} />
          Voir les paiements non finalisés
        </label>
        <button type="button" onClick={charger} className="ml-auto rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">↻ Recharger</button>
      </div>

      {erreur && <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">Erreur : {erreur}</div>}

      {/* Par prof */}
      <section className="overflow-hidden rounded-xl border bg-white">
        <div className="border-b p-3 font-semibold">Par professeur</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Professeur</th>
                <th className="px-3 py-2 text-right">Paiements</th>
                <th className="px-3 py-2 text-right">Encaissé</th>
                <th className="px-3 py-2 text-right">Versé</th>
                <th className="px-3 py-2 text-right">En attente du cours</th>
                <th className="px-3 py-2 text-right">Dû</th>
              </tr>
            </thead>
            <tbody>
              {chargement && <tr><td colSpan={6} className="p-4 text-center text-slate-500">Chargement…</td></tr>}
              {!chargement && profs.length === 0 && (
                <tr><td colSpan={6} className="p-4 text-center text-slate-400">Aucun paiement encaissé sur cette période</td></tr>
              )}
              {!chargement && profs.map((r) => (
                <tr key={r.profUid} className="border-t border-slate-100">
                  <td className="px-3 py-2">{nomDe(comptes.get(r.profUid), r.profUid)}</td>
                  <td className="px-3 py-2 text-right">{r.nb}</td>
                  <td className="px-3 py-2 text-right">{euros(r.encaisse)}</td>
                  <td className="px-3 py-2 text-right text-green-700">{euros(r.verse)}</td>
                  <td className="px-3 py-2 text-right">{euros(r.enAttente)}</td>
                  <td className={`px-3 py-2 text-right ${r.du > 0 ? 'font-bold text-amber-800' : ''}`}>{euros(r.du)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Détail */}
      <section className="overflow-hidden rounded-xl border bg-white">
        <div className="border-b p-3 font-semibold">Paiements ({visibles.length})</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Famille</th>
                <th className="px-3 py-2">Professeur</th>
                <th className="px-3 py-2 text-right">Payé</th>
                <th className="px-3 py-2 text-right">Part prof</th>
                <th className="px-3 py-2 text-right">Notre com.</th>
                <th className="px-3 py-2">Statut</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {chargement && <tr><td colSpan={8} className="p-4 text-center text-slate-500">Chargement…</td></tr>}
              {!chargement && visibles.length === 0 && (
                <tr><td colSpan={8} className="p-4 text-center text-slate-400">Aucun paiement</td></tr>
              )}
              {!chargement && visibles.map((l) => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-500">{dateFr(l.date)}</td>
                  <td className="px-3 py-2">{nomDe(comptes.get(l.payeurUid), l.payeurUid)}</td>
                  <td className="px-3 py-2">{nomDe(comptes.get(l.profUid), l.profUid)}</td>
                  <td className="px-3 py-2 text-right">
                    {euros(l.brut)}
                    {l.pack && <span className="ml-1 text-xs text-slate-400">pack {l.heures} h</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{euros(l.partProf)}</td>
                  <td className="px-3 py-2 text-right">{euros(l.commission)}</td>
                  <td className="px-3 py-2">
                    <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${TONS[l.ton]}`}>{l.libelle}</span>
                    {l.rembourse > 0 && l.statut !== 'refunded' && (
                      <span className="ml-1 text-xs text-red-700">−{euros(l.rembourse)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {l.remboursable && onRembourser && (
                      <button
                        type="button"
                        onClick={() => onRembourser(docs.find((d) => d.id === l.id))}
                        className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50"
                      >
                        Rembourser
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
