// Onglet « 🔥 Leads » de l'admin — demandé par Joseph le 15/10/2026 :
// « je veux les stats sur le compte admin, là où je vois tout ».
//
// Il répond à trois questions : qui a demandé quel prof, le prof a-t-il
// répondu et en combien de temps, et est-ce que ça a donné une réservation.
// Le calcul vit dans frontend/lib/statsMessages.js, partagé avec
// scripts/diag-messages.mjs : un seul chiffre, deux endroits pour le lire.
//
// ⚖️ Cet écran ne lit PAS la messagerie. Il lit `demandes_contact`, un
//    événement du service — secret des correspondances (CPCE art. L32-3).
//    Aucun contenu, aucun décompte de messages. Pour lire une conversation, il
//    faut qu'un utilisateur la signale lui-même (bouton « Signaler »).
// ⚠️ Les données ne sont chargées QU'À l'ouverture de l'onglet : le tableau de
//    bord admin est déjà lourd (timeout connu sur son test de montage).
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import fetchWithAuth from '../../utils/fetchWithAuth';
import { statsDemandes, dureeLisible, COLLECTION_DEMANDES } from '../../lib/statsMessages';
import { toast } from 'sonner';
import { demanderTexte } from '../ui/Dialogues';

const FENETRES = [7, 30, 90, 3650];
const etiquetteFenetre = (j) => (j >= 3650 ? 'Depuis le début' : `${j} jours`);

const dateFr = (d) => (d
  ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`
  : '—');

const COULEUR_STATUT = {
  'sans réponse': 'bg-red-100 text-red-800',
  répondu: 'bg-amber-100 text-amber-800',
  réservé: 'bg-green-100 text-green-800',
};

function Chiffre({ valeur, libelle, alerte = false }) {
  return (
    <div className={`rounded-xl border p-4 ${alerte ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
      <div className={`text-2xl font-extrabold ${alerte ? 'text-red-700' : 'text-slate-900'}`}>{valeur}</div>
      <div className="text-xs text-slate-600">{libelle}</div>
    </div>
  );
}

export default function LeadsSection() {
  const [brut, setBrut] = useState(null);
  const [erreur, setErreur] = useState('');
  const [jours, setJours] = useState(30);

  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        const [d, u, l] = await Promise.all([
          getDocs(collection(db, COLLECTION_DEMANDES)),
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'lessons')),
        ]);
        if (!vivant) return;
        setBrut({
          demandes: d.docs.map((x) => ({ id: x.id, ...x.data() })),
          users: u.docs.map((x) => ({ uid: x.id, ...x.data() })),
          lessons: l.docs.map((x) => x.data()),
        });
      } catch (e) {
        if (vivant) setErreur(e?.message || 'Lecture impossible');
      }
    })();
    return () => { vivant = false; };
  }, []);

  const { lignes, totaux, parProf } = useMemo(
    () => statsDemandes({ ...(brut || { demandes: [], users: [], lessons: [] }), jours }),
    [brut, jours],
  );

  // ⚖️ Ouvrir une conversation ne se fait pas d'un clic : motif obligatoire,
  // trace dans acces_journal, et la conversation est gelée (plus de purge).
  const exporter = async (l) => {
    const motif = await demanderTexte({
      titre: `Ouvrir la conversation entre ${l.eleve} et ${l.prof} ?`,
      message: [
        "EduKaraib ne lit pas les conversations. Ouvrir celle-ci n'est justifié",
        'que pour un signalement, un litige ou une réquisition judiciaire.',
        'Votre accès sera enregistré, avec ce motif.',
      ].join(String.fromCharCode(10)),
      placeholder: 'Motif (10 caractères minimum)',
      libelleConfirmer: 'Ouvrir la conversation',
      multiligne: true,
      obligatoire: true,
    });
    if (!motif) return;
    try {
      // ⚠️ fetchWithAuth renvoie le JSON déjà analysé et lève lui-même sur erreur
      const j = await fetchWithAuth('/api/admin-export-conversation', {
        method: 'POST',
        body: JSON.stringify({ conversationId: l.conversationId || l.id, motif }),
      });
      const texte = [
        `Conversation ${j.conversationId}`,
        `Motif : ${j.motif}`,
        `Participants : ${j.participants.map((p) => `${p.nom} (${p.role})`).join(' · ')}`,
        "Données personnelles — à détruire dès que l'affaire est close.",
        ''.padEnd(60, '='),
        '',
        ...j.messages.map((m) => `${(m.quand || '').replace('T', ' ').slice(0, 19)}  ${m.auteur} : ${m.texte}`
          + (m.pieces.length ? ` [${m.pieces.map((p) => p.url).join(' ')}]` : '')),
      ].join(String.fromCharCode(10));
      const url = URL.createObjectURL(new Blob([texte], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `conversation_${j.conversationId}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      const m = String(e?.message || '');
      toast.error(m.includes('MOTIF_TROP_COURT')
        ? 'Motif trop court : 10 caractères minimum.'
        : `Export impossible : ${m}`);
    }
  };

  if (erreur) return <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">Erreur : {erreur}</div>;
  if (!brut) return <div className="rounded-xl border bg-white p-6 text-slate-500">Chargement des demandes…</div>;

  return (
    <div className="space-y-5">
      <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        Demandes de mise en relation envoyées par un élève ou un parent à un professeur.
        <strong> Le contenu des messages n'apparaît pas ici</strong> — secret des correspondances.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {FENETRES.map((j) => (
          <button
            key={j}
            type="button"
            onClick={() => setJours(j)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${jours === j ? 'border-primary bg-primary text-white' : 'bg-white'}`}
          >
            {etiquetteFenetre(j)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Chiffre valeur={totaux.demandes} libelle="Demandes reçues" />
        <Chiffre valeur={totaux.sansReponse} libelle="Sans réponse du prof" alerte={totaux.sansReponse > 0} />
        <Chiffre valeur={totaux.tauxReponse === null ? '—' : `${totaux.tauxReponse} %`} libelle="Taux de réponse" />
        <Chiffre valeur={dureeLisible(totaux.delaiMedian)} libelle="Délai médian de réponse" />
        <Chiffre valeur={totaux.reservees} libelle="Ont donné une réservation" />
      </div>

      {lignes.length === 0 ? (
        <div className="rounded-xl border bg-white p-6 text-slate-600">
          Aucune demande de mise en relation sur cette période.
          {jours < 3650 && ' Essayez « Depuis le début ».'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Demande</th>
                <th className="px-3 py-2">Élève / parent</th>
                <th className="px-3 py-2">Professeur</th>
                <th className="px-3 py-2">1ʳᵉ réponse</th>
                <th className="px-3 py-2">Statut</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-3 py-2">{dateFr(l.creee)}</td>
                  <td className="px-3 py-2">
                    {l.eleve} <span className="text-xs text-slate-400">({l.roleEleve})</span>
                  </td>
                  <td className="px-3 py-2">
                    {l.prof}
                    {l.matiere && <span className="block text-xs text-slate-400">{l.matiere}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {l.delai === null
                      ? <span className="font-semibold text-red-700">attend depuis {dureeLisible(l.attendDepuis)}</span>
                      : dureeLisible(l.delai)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${COULEUR_STATUT[l.statut] || ''}`}>
                      {l.statut}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{l.source}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link to={`/profils/${l.profUid}`} className="text-primary underline">Voir le prof</Link>
                    {(l.conversationId || l.id) && (
                      <button
                        type="button"
                        onClick={() => exporter(l)}
                        className="ml-3 text-slate-500 underline hover:text-red-700"
                        title="Pour un signalement, un litige ou une réquisition — motif obligatoire et accès enregistré"
                      >
                        Litige
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {parProf.length > 0 && (
        <div className="rounded-xl border bg-white p-4">
          <h3 className="mb-3 font-bold text-slate-900">Par professeur — qui mettre en avant, qui relancer</h3>
          <ul className="space-y-1 text-sm text-slate-700">
            {parProf.map((p) => (
              <li key={p.uid}>
                <span className="font-semibold">{p.prof}</span> — {p.recues} demande(s) · {p.repondues} répondue(s)
                {p.repondues > 0 && ` · médiane ${dureeLisible(p.delaiMedian)}`}
                {p.repondues === 0 && <span className="font-semibold text-red-700"> · n'a jamais répondu</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
