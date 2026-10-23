// Fenêtres de confirmation et de saisie du site (23/10/2026).
//
// Règle de Joseph (23/10) : « il faut pas de fenêtre dégueulasse comme ça,
// on est une vraie structure ». Plus AUCUN window.alert / confirm / prompt
// sur le site — le lint les refuse (`no-alert`). À la place :
//   - une information ou une erreur  → toast (sonner), déjà monté globalement ;
//   - une question oui / non         → `await confirmer({...})`  → true / false ;
//   - une saisie                     → `await demanderTexte({...})` → texte ou null.
// Les deux fonctions s'appellent de n'importe où (composant, helper, handler) :
// <DialoguesHote /> est monté une fois pour toute l'app (setup/mobile-and-errors.jsx).
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, HelpCircle, PenLine } from 'lucide-react';

let ecouteur = null;
const enAttente = [];

function ouvrir(dialogue) {
  return new Promise((resolve) => {
    const d = { ...dialogue, resolve };
    if (ecouteur) ecouteur(d);
    else enAttente.push(d);
  });
}

const normaliser = (o) => (typeof o === 'string' ? { message: o } : o || {});

/**
 * Question oui / non.
 * @param {string|{titre?:string, message?:string, libelleConfirmer?:string, libelleAnnuler?:string, danger?:boolean}} options
 * @returns {Promise<boolean>}
 */
export function confirmer(options) {
  return ouvrir({ type: 'confirmer', titre: 'Confirmer', libelleConfirmer: 'Confirmer', ...normaliser(options) });
}

/**
 * Saisie d'un texte.
 * @param {{titre?:string, message?:string, valeur?:string, placeholder?:string, libelleConfirmer?:string, multiligne?:boolean, obligatoire?:boolean, motDePasse?:boolean}} options
 * @returns {Promise<string|null>} null si annulé
 */
export function demanderTexte(options) {
  return ouvrir({ type: 'texte', titre: 'Votre réponse', libelleConfirmer: 'Valider', ...normaliser(options) });
}

export function DialoguesHote() {
  const [file, setFile] = useState([]);
  const [texte, setTexte] = useState('');
  const [visible, setVisible] = useState(false);
  const champ = useRef(null);
  const boutonOk = useRef(null);
  const courant = file[0] || null;

  useEffect(() => {
    ecouteur = (d) => setFile((f) => [...f, d]);
    if (enAttente.length) setFile((f) => [...f, ...enAttente.splice(0)]);
    return () => { ecouteur = null; };
  }, []);

  useEffect(() => {
    if (!courant) return undefined;
    setTexte(courant.valeur || '');
    setVisible(false);
    const t = requestAnimationFrame(() => {
      setVisible(true);
      (courant.type === 'texte' ? champ.current : boutonOk.current)?.focus();
    });
    return () => cancelAnimationFrame(t);
  }, [courant]);

  if (!courant) return null;

  const fermer = (reponse) => {
    courant.resolve(reponse);
    setFile((f) => f.slice(1));
  };
  const annuler = () => fermer(courant.type === 'texte' ? null : false);
  const valider = () => {
    if (courant.type !== 'texte') return fermer(true);
    if (courant.obligatoire && !texte.trim()) { champ.current?.focus(); return undefined; }
    return fermer(texte);
  };
  const auClavier = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); annuler(); }
    if (e.key === 'Enter' && !(courant.multiligne && !e.ctrlKey && !e.metaKey)) { e.preventDefault(); valider(); }
  };

  const danger = !!courant.danger;
  const Icone = courant.type === 'texte' ? PenLine : danger ? AlertTriangle : HelpCircle;
  const teinteIcone = danger ? 'bg-red-50 text-red-600' : 'bg-primary/10 text-primary';
  const Champ = courant.multiligne ? 'textarea' : 'input';

  return (
    <div
      className={`fixed inset-0 z-[1000] flex items-end sm:items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm transition-opacity duration-150 ${visible ? 'opacity-100' : 'opacity-0'}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) annuler(); }}
      onKeyDown={auClavier}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialogue-titre"
        className={`w-full max-w-md bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 p-6 transition-all duration-150 ${visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-95'}`}
      >
        <div className="flex items-start gap-4">
          <div className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center ${teinteIcone}`}>
            <Icone className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="dialogue-titre" className="text-lg font-bold text-gray-900 leading-snug">{courant.titre}</h2>
            {courant.message && (
              <p className="mt-1.5 text-sm text-gray-600 leading-relaxed whitespace-pre-line">{courant.message}</p>
            )}
          </div>
        </div>

        {courant.type === 'texte' && (
          <Champ
            ref={champ}
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            placeholder={courant.placeholder || ''}
            rows={courant.multiligne ? 4 : undefined}
            type={courant.multiligne ? undefined : courant.motDePasse ? 'password' : 'text'}
            autoComplete={courant.motDePasse ? 'current-password' : 'off'}
            className="mt-4 w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 transition"
          />
        )}

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={annuler}
            className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
          >
            {courant.libelleAnnuler || 'Annuler'}
          </button>
          <button
            type="button"
            ref={boutonOk}
            onClick={valider}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition focus:outline-none focus:ring-4 ${danger ? 'bg-red-600 hover:bg-red-700 focus:ring-red-200' : 'bg-primary hover:bg-primary-dark focus:ring-primary/25'}`}
          >
            {courant.libelleConfirmer}
          </button>
        </div>
      </div>
    </div>
  );
}
