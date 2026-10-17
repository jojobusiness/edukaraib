// Récupère la dernière version du site sans que personne ait à recharger
// (17/10/2026). Monté une seule fois, à la racine, dans le Router.
// Il ne rend rien tant qu'il n'y a rien à dire : le cas normal est que la
// nouvelle version arrive au premier changement de page, en silence.
// Règle de décision et raisons : frontend/lib/miseAJour.js.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RotateCw } from 'lucide-react';
import {
  VERSION_LOCALE,
  INTERVALLE_MS,
  DELAI_MINIMAL_MS,
  doitSurveiller,
  estPageProtegee,
  versionDeployee,
  decision,
  tentativeEnregistree,
  enregistrerTentative,
  oublierTentative,
} from '../lib/miseAJour';

export default function MiseAJourAuto() {
  const { pathname } = useLocation();
  const [aPrevenir, setAPrevenir] = useState(false);
  // Des refs, pas des états : ces valeurs ne doivent jamais provoquer de
  // rendu, et la vérification doit toujours lire la dernière en date.
  const saisieEnCours = useRef(false);
  const derniereVerif = useRef(0);
  const cheminActuel = useRef(pathname);
  cheminActuel.current = pathname;

  // La saisie appartient à la page où elle a eu lieu.
  useEffect(() => { saisieEnCours.current = false; }, [pathname]);

  // Un seul écouteur en capture pour tout le site : aucune page à modifier, et
  // rien n'y échappe — y compris la fenêtre de réservation ou le composeur du
  // chat. Un élément marqué `data-pas-une-saisie` est ignoré (filtres, tris).
  useEffect(() => {
    if (!doitSurveiller()) return undefined;
    const marquer = (e) => {
      const t = e.target;
      if (t?.closest?.('[data-pas-une-saisie]')) return;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT') {
        saisieEnCours.current = true;
      }
    };
    document.addEventListener('input', marquer, true);
    document.addEventListener('change', marquer, true);
    return () => {
      document.removeEventListener('input', marquer, true);
      document.removeEventListener('change', marquer, true);
    };
  }, []);

  const verifier = useCallback(async (momentSur) => {
    if (!doitSurveiller()) return;
    const maintenant = Date.now();
    if (maintenant - derniereVerif.current < DELAI_MINIMAL_MS) return;
    derniereVerif.current = maintenant;

    const distante = await versionDeployee();
    const quoiFaire = decision({
      versionLocale: VERSION_LOCALE,
      versionDistante: distante,
      saisieEnCours: saisieEnCours.current,
      dejaTentee: tentativeEnregistree(),
      momentSur,
      pageProtegee: estPageProtegee(cheminActuel.current),
    });

    if (quoiFaire === 'recharger') {
      enregistrerTentative(distante);
      window.location.reload();
      return;
    }
    if (quoiFaire === 'prevenir') setAPrevenir(true);
    // Version atteinte : le garde anti-boucle n'a plus de raison d'être.
    if (quoiFaire === 'rien' && distante === VERSION_LOCALE) oublierTentative();
  }, []);

  // Changement de page : rien n'est en vol, c'est le meilleur moment.
  useEffect(() => { verifier(true); }, [pathname, verifier]);

  useEffect(() => {
    if (!doitSurveiller()) return undefined;
    // Retour sur l'onglet : la page n'est pas en train de travailler.
    const auRetour = () => { if (document.visibilityState === 'visible') verifier(true); };
    // Veille de fond : on prévient, on ne recharge pas sous les doigts.
    const minuterie = setInterval(() => verifier(false), INTERVALLE_MS);
    document.addEventListener('visibilitychange', auRetour);
    return () => {
      clearInterval(minuterie);
      document.removeEventListener('visibilitychange', auRetour);
    };
  }, [verifier]);

  if (!aPrevenir) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 sm:left-auto sm:right-4 sm:w-auto sm:translate-x-0"
    >
      <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
        <div className="text-sm">
          <p className="font-semibold text-slate-900">Une nouvelle version du site est prête.</p>
          <p className="mt-0.5 text-slate-500">
            Actualiser recharge la page : terminez d'abord ce que vous faites.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-primary-dark"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          Actualiser
        </button>
      </div>
    </div>
  );
}
