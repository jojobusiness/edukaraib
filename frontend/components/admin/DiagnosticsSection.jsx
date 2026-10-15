// Onglet « 🩺 Diagnostics » — tous les relevés, sans terminal (15/10/2026).
// Joseph : « mets tout dans l'admin, je veux rien faire sur un terminal, et ça
// vaut pour tout le reste ». Ce qui se lançait avec diag-offre-profs,
// diag-acquisition, diag-retours et diag-messages se lit ici.
//
// Tout vient d'un seul appel à /api/admin-diagnostics : les collections
// sensibles (messages, demandes de mise en relation) ne sont plus lisibles
// depuis un navigateur, le calcul se fait donc côté serveur.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import fetchWithAuth from '../../utils/fetchWithAuth';
import { dureeLisible } from '../../lib/statsMessages';

const dateFr = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
};

function Bloc({ titre, sous, children }) {
  return (
    <section className="rounded-xl border bg-white p-4">
      <h3 className="font-bold text-slate-900">{titre}</h3>
      {sous && <p className="mb-3 text-xs text-slate-500">{sous}</p>}
      {children}
    </section>
  );
}

function Chiffre({ valeur, libelle, alerte = false }) {
  return (
    <div className={`rounded-xl border p-3 ${alerte ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className={`text-xl font-extrabold ${alerte ? 'text-red-700' : 'text-slate-900'}`}>{valeur}</div>
      <div className="text-xs text-slate-600">{libelle}</div>
    </div>
  );
}

export default function DiagnosticsSection() {
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur('');
    try {
      const r = await fetchWithAuth('/api/admin-diagnostics');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || j?.error || 'Erreur');
      setData(j);
    } catch (e) {
      setErreur(e?.message || 'Lecture impossible');
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  if (chargement && !data) return <div className="rounded-xl border bg-white p-6 text-slate-500">Calcul des relevés…</div>;
  if (erreur) return <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">Erreur : {erreur}</div>;
  if (!data) return null;

  const { offre, acquisition, retours, conservation } = data;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Relevé du {new Date(data.genere_le).toLocaleString('fr-FR')}</p>
        <button type="button" onClick={charger} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">
          ↻ Recalculer
        </button>
      </div>

      <Bloc
        titre="🎓 Offre professeurs"
        sous="Un prof est réservable s'il est visible (photo ou au moins un avis) ET s'il a ouvert au moins un créneau."
      >
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Chiffre valeur={offre.inscrits} libelle="Inscrits" />
          <Chiffre valeur={offre.passentLeFiltre} libelle="Visibles dans les résultats" />
          <Chiffre valeur={offre.avecCreneau} libelle="Ont un créneau" />
          <Chiffre valeur={offre.reservables} libelle="Réservables" alerte={offre.reservables < 3} />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Professeur</th>
                <th className="px-3 py-2">Ville</th>
                <th className="px-3 py-2 text-right">Avis</th>
                <th className="px-3 py-2 text-right">Créneaux</th>
                <th className="px-3 py-2">Ce qui bloque</th>
              </tr>
            </thead>
            <tbody>
              {offre.profs.map((p) => (
                <tr key={p.uid} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <Link to={`/profils/${p.uid}`} className="text-primary underline">{p.nom}</Link>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{p.ville}</td>
                  <td className="px-3 py-2 text-right">{p.avis}</td>
                  <td className="px-3 py-2 text-right">{p.creneaux}</td>
                  <td className="px-3 py-2">
                    {p.reservable
                      ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">réservable</span>
                      : <span className="text-red-700">{p.manques.join(' · ')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Bloc>

      <Bloc titre="📊 D'où viennent les inscrits" sous="Source enregistrée sur le compte depuis le 21/09/2026.">
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Chiffre valeur={acquisition.comptes} libelle="Comptes (hors admin et tests)" />
          <Chiffre valeur={acquisition.viaMethode} libelle="Venus par la page /methode" />
          <Chiffre valeur={Object.keys(acquisition.parSource).length} libelle="Sources distinctes" />
        </div>
        <ul className="mb-4 space-y-1 text-sm text-slate-700">
          {Object.entries(acquisition.parSource).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
            <li key={s}><span className="font-semibold">{n}</span> — {s}</li>
          ))}
        </ul>
        <p className="mb-2 text-xs font-semibold uppercase text-slate-500">10 derniers inscrits</p>
        <ul className="space-y-1 text-sm text-slate-700">
          {acquisition.derniers.map((u) => (
            <li key={`${u.nom}-${u.cree}`}>{dateFr(u.cree)} · {u.nom} <span className="text-slate-400">({u.role})</span> — {u.source}</li>
          ))}
        </ul>
      </Bloc>

      <Bloc titre="↩️ Qui revient sur le site" sous="Suivi démarré le 02/10/2026 : une absence de date veut dire « pas revenu depuis », pas « jamais venu ».">
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Chiffre valeur={`${retours.recents7j.length}/${retours.total}`} libelle="Revenus ces 7 jours" />
          <Chiffre
            valeur={`${retours.profsRevenus7j}/${retours.profsTotal}`}
            libelle="Profs revenus ces 7 jours"
            alerte={retours.profsRevenus7j === 0}
          />
          <Chiffre valeur={retours.jamais} libelle="Pas revenus depuis le 02/10" />
        </div>
        {retours.recents7j.length > 0 && (
          <ul className="space-y-1 text-sm text-slate-700">
            {retours.recents7j.map((u) => (
              <li key={u.nom}>{u.nom} <span className="text-slate-400">({u.role})</span> — il y a {u.jours} j</li>
            ))}
          </ul>
        )}
      </Bloc>

      <Bloc titre="🗄️ Conservation des conversations" sous={`Masquées côté utilisateur, conservées ${conservation.mois} mois, puis purgées automatiquement à 3 h 30.`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Chiffre valeur={conservation.conversations} libelle="Conversations en base" />
          <Chiffre valeur={conservation.gelees} libelle="Gelées (litige/signalement)" />
          <Chiffre valeur={conservation.aPurgerCetteNuit} libelle="Purgées cette nuit" />
          <Chiffre
            valeur={conservation.signalementsNonTraites}
            libelle="Signalements à traiter"
            alerte={conservation.signalementsNonTraites > 0}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Plus ancienne conversation encore en base : {dateFr(conservation.plusAncienne)}.
          Les délais de réponse des profs sont dans l'onglet « 🔥 Leads » ({dureeLisible(data.demandes?.totaux?.delaiMedian)} de médiane).
        </p>
      </Bloc>
    </div>
  );
}
