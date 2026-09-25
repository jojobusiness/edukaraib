// Bandeau d'état du profil prof (plan du 25/09/2026) : dire au prof, en clair,
// ce qui l'empêche d'être réservable — et l'emmener à l'écran qui le corrige.
// Rend `null` quand tout va bien : ⛔ pas de bandeau vert permanent, on ne le
// lirait plus au moment où il compte.
import React from 'react';
import { Link } from 'react-router-dom';
import { etatProfil } from '../lib/offreProf';

export default function EtatProfilProf({ profil, nbAvis = 0 }) {
  const manques = etatProfil({ profil, nbAvis });
  if (manques.length === 0) return null;

  const bloquant = manques.some((m) => m.bloquant);
  const style = bloquant
    ? { cadre: 'border-amber-300 bg-amber-50', titre: 'text-amber-900', texte: 'text-amber-800', bouton: 'bg-amber-600 hover:bg-amber-700' }
    : { cadre: 'border-blue-300 bg-blue-50', titre: 'text-blue-900', texte: 'text-blue-800', bouton: 'bg-blue-600 hover:bg-blue-700' };

  return (
    <div className={`mb-8 rounded-xl border ${style.cadre} p-5`} role="status">
      <h3 className={`text-lg font-bold ${style.titre} flex items-center gap-2`}>
        <span role="img" aria-label={bloquant ? 'Attention' : 'Information'}>{bloquant ? '⚠️' : '💡'}</span>
        {bloquant ? "Votre profil n'est pas encore réservable" : 'Un réglage vous fait perdre des réservations'}
      </h3>

      <ul className="mt-4 space-y-4">
        {manques.map((m) => (
          <li key={m.code} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className={`font-semibold ${style.titre}`}>{m.titre}</p>
              <p className={`text-sm ${style.texte}`}>{m.texte}</p>
            </div>
            <Link
              to={m.lien}
              className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow ${style.bouton} transition`}
            >
              {m.action}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
