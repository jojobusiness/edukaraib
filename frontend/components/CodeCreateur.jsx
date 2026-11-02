// Champ « code créateur », comme sur Belmyre (02/11/2026, demande de Joseph).
// Beaucoup de vidéos n'ont pas de lien cliquable : le visiteur a entendu un code.
// Il est vérifié ici, gardé pour le paiement et posé sur le compte s'il est connecté.
// Venu par un lien, il voit le code déjà appliqué et n'a rien à taper.
import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { Check, Tag } from 'lucide-react';
import { auth, db } from '../lib/firebase';
import { getCampaignCode, saveCampaign, noterCodeRattache } from '../lib/bacCampaign';

export default function CodeCreateur({ sombre = false, onApplique }) {
  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState('');
  const [etat, setEtat] = useState('repos'); // repos | verif | inconnu | erreur
  const [applique, setApplique] = useState(() => getCampaignCode());
  const texte = sombre ? 'text-slate-200' : 'text-gray-600';

  const appliquer = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const code = saisie.trim().toUpperCase();
    if (!code) return;
    setEtat('verif');
    try {
      const r = await fetch(`/api/partner-clic?code=${encodeURIComponent(code)}`);
      const { valide } = await r.json();
      if (!valide) { setEtat('inconnu'); return; }
      saveCampaign({ code });
      const uid = auth.currentUser?.uid;
      if (uid) {
        updateDoc(doc(db, 'users', uid), { code_campagne: code })
          .then(() => noterCodeRattache(uid, code))
          .catch(() => {});
      }
      setApplique(code);
      setEtat('repos');
      onApplique?.(code);
    } catch {
      setEtat('erreur');
    }
  };

  if (applique) {
    return (
      <p className={`inline-flex items-center gap-1.5 text-sm font-semibold ${sombre ? 'text-green-300' : 'text-green-700'}`}>
        <Check size={15} aria-hidden="true" /> Code {applique} appliqué : la remise se fait au paiement.
      </p>
    );
  }
  if (!ouvert) {
    return (
      <button type="button" onClick={() => setOuvert(true)} className={`inline-flex items-center gap-1.5 text-sm underline underline-offset-2 ${texte}`}>
        <Tag size={14} aria-hidden="true" /> J’ai un code créateur
      </button>
    );
  }
  // Pas de <form> : ce champ vit aussi DANS le formulaire d'inscription
  return (
    <div className="w-full max-w-sm">
      <div className="flex gap-2">
        <input
          value={saisie}
          onChange={(e) => { setSaisie(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')); setEtat('repos'); }}
          onKeyDown={(e) => { if (e.key === 'Enter') appliquer(e); }}
          placeholder="Code créateur"
          aria-label="Code créateur"
          maxLength={20}
          autoFocus
          className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm uppercase text-gray-900"
        />
        <button
          type="button"
          onClick={appliquer}
          disabled={!saisie || etat === 'verif'}
          className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {etat === 'verif' ? 'Vérification…' : 'Appliquer'}
        </button>
      </div>
      {etat === 'inconnu' && <p className={`mt-1 text-sm ${sombre ? 'text-red-300' : 'text-red-600'}`}>Ce code n’existe pas. Vérifiez l’orthographe.</p>}
      {etat === 'erreur' && <p className={`mt-1 text-sm ${sombre ? 'text-red-300' : 'text-red-600'}`}>Vérification impossible. Réessayez.</p>}
    </div>
  );
}
