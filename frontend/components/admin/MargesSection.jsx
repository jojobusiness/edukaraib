// « 💶 Ce que les paiements nous laissent » — en tête de l'onglet
// « Paiements & Revenus » (18/10/2026, déplacé depuis Diagnostics le 19/10).
// Le prof touche 100 % de son tarif : les frais Stripe sortent de notre
// commission. Un paiement en rouge nous a coûté plus qu'il ne nous a rapporté.
// Un chiffre, jamais un blocage. Calcul : api/admin-marges.mjs + api/_marge.mjs.
import React, { useCallback, useEffect, useState } from 'react';
import fetchWithAuth from '../../utils/fetchWithAuth';

const euros = (n) => `${Number(n || 0).toFixed(2).replace('.', ',')} €`;

const dateFr = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
};

function Chiffre({ valeur, libelle, alerte = false }) {
  return (
    <div className={`rounded-xl border p-3 ${alerte ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className={`text-xl font-extrabold ${alerte ? 'text-red-700' : 'text-slate-900'}`}>{valeur}</div>
      <div className="text-xs text-slate-600">{libelle}</div>
    </div>
  );
}

export default function MargesSection() {
  const [m, setM] = useState(null);
  const [erreur, setErreur] = useState('');

  const charger = useCallback(async () => {
    setErreur('');
    try {
      // fetchWithAuth renvoie déjà le JSON et lève sur erreur : pas de .json().
      setM(await fetchWithAuth('/api/admin-marges'));
    } catch (e) {
      setErreur(e?.message || 'Lecture impossible');
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  if (erreur) return <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">Marges : {erreur}</div>;
  if (!m) return <div className="rounded-xl border bg-white p-4 text-slate-500">Calcul des marges…</div>;

  return (
    <section className="rounded-xl border bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900">💶 Ce que les paiements nous laissent</h3>
          <p className="mb-3 text-xs text-slate-500">
            Le prof touche 100 % de son tarif : les frais Stripe sortent de notre commission, jamais de sa part.
            Un paiement en rouge nous a coûté plus qu'il ne nous a rapporté.
          </p>
        </div>
        <button type="button" onClick={charger} className="shrink-0 rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">
          ↻ Recalculer
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Chiffre valeur={euros(m.encaisse)} libelle={`Encaissé (${m.nbPaiements} paiements)`} />
        <Chiffre valeur={euros(m.verseProfs)} libelle="Versé aux profs (100 % de leur tarif)" />
        <Chiffre valeur={euros(m.fraisStripe + m.fraisVirement)} libelle="Frais Stripe à notre charge" />
        <Chiffre valeur={euros(m.net)} libelle="Ce qu'il nous reste" alerte={m.net < 0} />
      </div>

      {m.negatifs.length === 0 ? (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          Aucun paiement à perte. Chaque encaissement couvre ses frais.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <p className="mb-2 text-sm font-semibold text-red-700">
            {m.negatifs.length} paiement{m.negatifs.length > 1 ? 's' : ''} à perte — le prof a bien touché son tarif, c'est notre commission qui n'a pas couvert les frais.
          </p>
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Professeur</th>
                <th className="px-3 py-2 text-right">Payé</th>
                <th className="px-3 py-2 text-right">Part prof</th>
                <th className="px-3 py-2 text-right">Notre com.</th>
                <th className="px-3 py-2 text-right">Frais Stripe</th>
                <th className="px-3 py-2 text-right">Reste</th>
              </tr>
            </thead>
            <tbody>
              {m.negatifs.map((l) => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-500">{dateFr(l.date)}</td>
                  <td className="px-3 py-2">
                    {l.prof}
                    {l.rembourse && <span className="ml-1 text-xs text-slate-400">(remboursé)</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{euros(l.brut)}</td>
                  <td className="px-3 py-2 text-right">{euros(l.partProf)}</td>
                  <td className="px-3 py-2 text-right">{euros(l.commission)}</td>
                  <td className="px-3 py-2 text-right">
                    {euros(l.fraisStripe)}
                    {l.estime && <span className="ml-1 text-xs text-slate-400">estimé</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-red-700">{euros(l.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-500">
        S'ajoute {euros(m.coutComptesActifs)} ce mois-ci : Stripe facture 2 € par prof payé dans le mois (Connect).
        {m.estimes > 0 && ` ${m.estimes} paiement(s) sans frais réels encore connus : estimés à la grille France (carte EEE 1,5 % + 0,25 €, Klarna 4,99 % + 0,40 €).`}
      </p>
    </section>
  );
}
