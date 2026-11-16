import React from 'react';
import {
  JOURS, grilleSemaine, exceptionDe, modeleDe, heuresDuJour, nbHeures, aujourdhui,
} from '../../api/_dispos.mjs';
import { ajouterJours, lundiDe, nomFuseau, libelleUtc, partiesLocales, fuseauValide } from '../../api/_fuseaux.mjs';

// Éditeur des disponibilités (refonte du 16/11/2026, PLAN_DISPOS_PROFS).
//
// Avant : un calendrier du mois qui ne servait qu'à choisir la semaine (une
// prof a cru que « les clics ne marchaient pas »), et des heures à recocher
// CHAQUE semaine — personne ne le faisait. Maintenant :
//   · « Mes horaires habituels » (ouvert par défaut) : valables chaque semaine ;
//   · « Une semaine particulière » : une exception qui remplace l'habituel.
// Une ligne par jour, les heures en pastilles qui passent à la ligne : lisible
// sur un téléphone, sans tableau de 18 colonnes.
// Les règles (modèle / exception) vivent dans api/_dispos.mjs.

const HEURES = Array.from({ length: 18 }, (_, i) => i + 6); // 6 h → 23 h
const NOMS_JOURS = { Lun: 'Lundi', Mar: 'Mardi', Mer: 'Mercredi', Jeu: 'Jeudi', Ven: 'Vendredi', Sam: 'Samedi', Dim: 'Dimanche' };
const plage = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
const trier = (arr) => [...new Set(arr)].sort((a, b) => a - b);
const PRESETS = {
  bureau: (i) => (i <= 4 ? [...plage(8, 12), ...plage(14, 18)] : []),
  continu: (i) => (i <= 5 ? plage(9, 19) : []),
  soirs: (i) => (i <= 4 ? plage(17, 21) : plage(9, 12)),
};
const jjmm = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

export default function TeacherAvailabilityEditor({ value = {}, onChange, fuseau = null }) {
  const tz = fuseauValide(fuseau) ? fuseau : null;
  const avail = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const aVide = nbHeures(modeleDe(avail) || {}) === 0;

  const [onglet, setOnglet] = React.useState('habituels');
  const auj = aujourdhui(Date.now(), tz);
  const heureMaintenant = tz ? partiesLocales(new Date(), tz).heure : new Date().getHours();
  const lundiActuel = lundiDe(auj);
  const [lundi, setLundi] = React.useState(lundiActuel);
  const [moisCurseur, setMoisCurseur] = React.useState(() => `${auj.slice(0, 7)}-01`);
  const [annonce, setAnnonce] = React.useState('');
  const grilleRef = React.useRef(null);
  const [copie, setCopie] = React.useState(null); // { de: 'Lun', vers: [] }

  const enSemaine = onglet === 'semaine';
  const exception = enSemaine ? exceptionDe(avail, lundi) : null;
  const grille = enSemaine ? grilleSemaine(avail, lundi) : (modeleDe(avail) || {});
  const datesSemaine = JOURS.map((_, i) => ajouterJours(lundi, i));

  const verrou = (i, h) => {
    if (!enSemaine) return false;
    const d = datesSemaine[i];
    if (d < auj) return true;
    return d === auj && h <= heureMaintenant;
  };

  // Écrit une grille complète (7 jours) au bon endroit : modèle ou semaine.
  const ecrire = (nouvelle) => {
    const propre = Object.fromEntries(JOURS.map((j) => [j, trier(nouvelle[j] || [])]));
    const suivant = { ...avail, ...(tz ? { fuseau: tz } : {}) };
    if (enSemaine) {
      suivant[lundi] = propre;
    } else {
      // L'ancien format ({ Lun: [...] } à la racine) devient un vrai modèle.
      JOURS.forEach((j) => { delete suivant[j]; });
      suivant.modele = propre;
    }
    onChange(suivant);
  };

  // Les heures verrouillées (passées) d'une semaine particulière ne bougent pas.
  const modifierJour = (i, fn) => {
    const jour = JOURS[i];
    const actuelles = heuresDuJour(grille, jour);
    const gardees = actuelles.filter((h) => verrou(i, h));
    const voulues = fn(actuelles).filter((h) => !verrou(i, h));
    const base = Object.fromEntries(JOURS.map((j) => [j, heuresDuJour(grille, j)]));
    ecrire({ ...base, [jour]: [...gardees, ...voulues] });
  };

  const basculer = (i, h) => {
    if (verrou(i, h)) return;
    modifierJour(i, (hs) => (hs.includes(h) ? hs.filter((x) => x !== h) : [...hs, h]));
  };

  const appliquerPreset = (nom) => {
    const base = {};
    JOURS.forEach((j, i) => {
      const gardees = heuresDuJour(grille, j).filter((h) => verrou(i, h));
      const voulues = nom === 'vider' ? [] : PRESETS[nom](i).filter((h) => !verrou(i, h));
      base[j] = [...gardees, ...voulues];
    });
    ecrire(base);
  };

  const copierVers = () => {
    if (!copie?.vers?.length) return setCopie(null);
    const src = heuresDuJour(grille, copie.de);
    const base = Object.fromEntries(JOURS.map((j) => [j, heuresDuJour(grille, j)]));
    copie.vers.forEach((j) => {
      const i = JOURS.indexOf(j);
      base[j] = [...heuresDuJour(grille, j).filter((h) => verrou(i, h)), ...src.filter((h) => !verrou(i, h))];
    });
    ecrire(base);
    setCopie(null);
  };

  const revenirAuxHabituels = () => {
    const suivant = { ...avail };
    delete suivant[lundi];
    onChange(suivant);
  };

  const choisirDate = (date) => {
    const l = lundiDe(date);
    setLundi(l);
    setAnnonce(`Semaine du ${jjmm(l)} au ${jjmm(ajouterJours(l, 6))} : cochez vos heures ci-dessous.`);
    // La grille est sous le calendrier : on y descend, sinon le clic « ne fait rien ».
    window.requestAnimationFrame?.(() => grilleRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  };

  // Calendrier du mois (6 semaines, début lundi)
  const premierLundi = lundiDe(moisCurseur);
  const semainesMois = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => ajouterJours(premierLundi, w * 7 + d)));
  const changerMois = (n) => {
    const [y, m] = moisCurseur.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMoisCurseur(d.toISOString().slice(0, 10));
  };
  const nomMois = new Date(`${moisCurseur}T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const total = nbHeures(grille);
  const ongletClasse = (actif) => `flex-1 px-3 py-2 text-sm font-semibold rounded-lg transition ${actif ? 'bg-white text-primary shadow' : 'text-gray-600 hover:text-gray-800'}`;

  return (
    <div className="space-y-4" data-testid="editeur-dispos">
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl" role="tablist">
        <button type="button" role="tab" aria-selected={!enSemaine} className={ongletClasse(!enSemaine)} onClick={() => { setOnglet('habituels'); setAnnonce(''); }}>
          Mes horaires habituels
        </button>
        <button type="button" role="tab" aria-selected={enSemaine} className={ongletClasse(enSemaine)} onClick={() => setOnglet('semaine')}>
          Une semaine particulière
        </button>
      </div>

      <p className="text-sm text-gray-700">
        {enSemaine
          ? 'Vacances, absence, horaires différents : choisissez la semaine, puis modifiez ses heures. Les autres semaines gardent vos horaires habituels.'
          : 'Cochez les heures où vous pouvez donner cours. Elles valent pour toutes les semaines : les familles peuvent réserver sans que vous ayez à revenir.'}
        {tz && (
          <span className="block text-xs text-gray-500 mt-1">
            Vos horaires, heure de {nomFuseau(tz)} ({libelleUtc(tz)}). Les familles les voient à l'heure de chez elles.
          </span>
        )}
      </p>

      {!enSemaine && aVide && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Vous n'avez pas encore d'horaires habituels. Le plus rapide : un raccourci ci-dessous, puis ajustez.
        </div>
      )}

      {enSemaine && (
        <div className="bg-white rounded-xl border shadow-sm p-3">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => changerMois(-1)} className="px-2 py-1 text-sm rounded border hover:bg-gray-50" aria-label="Mois précédent">‹</button>
            <div className="font-semibold capitalize">{nomMois}</div>
            <button type="button" onClick={() => changerMois(1)} className="px-2 py-1 text-sm rounded border hover:bg-gray-50" aria-label="Mois suivant">›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-[11px]">
            {JOURS.map((j) => <div key={j} className="text-center text-gray-500">{j}</div>)}
            {semainesMois.flat().map((d) => {
              const passe = lundiDe(d) < lundiActuel;
              const active = lundiDe(d) === lundi;
              const horsMois = d.slice(0, 7) !== moisCurseur.slice(0, 7);
              const aException = !!exceptionDe(avail, lundiDe(d));
              return (
                <button
                  key={d}
                  type="button"
                  disabled={passe}
                  onClick={() => choisirDate(d)}
                  className={[
                    'py-1.5 rounded border text-center relative',
                    passe ? 'text-gray-300 bg-gray-50 cursor-not-allowed'
                      : active ? 'bg-primary text-white border-primary'
                        : horsMois ? 'bg-gray-50 text-gray-400 hover:bg-gray-100' : 'bg-white hover:bg-gray-50',
                  ].join(' ')}
                  title={passe ? 'Semaine passée' : 'Modifier cette semaine'}
                >
                  {Number(d.slice(8, 10))}
                  {aException && !passe && <span className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${active ? 'bg-white' : 'bg-amber-500'}`} />}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-gray-500">Un point orange = semaine avec des horaires particuliers.</p>
        </div>
      )}

      <div ref={grilleRef} className="scroll-mt-4 space-y-3">
        {enSemaine && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-gray-800" aria-live="polite">
            <b>{annonce || `Semaine du ${jjmm(lundi)} au ${jjmm(ajouterJours(lundi, 6))} : cochez vos heures ci-dessous.`}</b>
            <span className="block text-xs text-gray-600 mt-0.5">
              {exception
                ? (nbHeures(exception) === 0 ? 'Cette semaine : pas disponible.' : 'Cette semaine a ses propres horaires.')
                : 'Cette semaine suit vos horaires habituels. Toute modification ici ne vaut que pour elle.'}
            </span>
            <div className="flex flex-wrap gap-2 mt-2">
              {exception && (
                <button type="button" onClick={revenirAuxHabituels} className="text-xs px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50">
                  Revenir à mes horaires habituels
                </button>
              )}
              <button type="button" onClick={() => appliquerPreset('vider')} className="text-xs px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50">
                Pas disponible cette semaine
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">Raccourcis :</span>
          <button type="button" onClick={() => appliquerPreset('bureau')} className="text-xs px-3 py-1.5 rounded-full border bg-white hover:bg-gray-50" title="Lundi → vendredi, 8 h–12 h et 14 h–18 h">🗓️ Bureau</button>
          <button type="button" onClick={() => appliquerPreset('continu')} className="text-xs px-3 py-1.5 rounded-full border bg-white hover:bg-gray-50" title="Lundi → samedi, 9 h–19 h">⏱️ Continu</button>
          <button type="button" onClick={() => appliquerPreset('soirs')} className="text-xs px-3 py-1.5 rounded-full border bg-white hover:bg-gray-50" title="Soirs de semaine 17 h–21 h, week-end 9 h–12 h">🌙 Soirs et week-end</button>
          <button type="button" onClick={() => appliquerPreset('vider')} className="text-xs px-3 py-1.5 rounded-full border bg-white hover:bg-gray-50">🧹 Tout vider</button>
          <span className="ml-auto text-xs font-semibold text-primary">{total} h {enSemaine ? 'cette semaine' : 'par semaine'}</span>
        </div>

        <ul className="space-y-2">
          {JOURS.map((jour, i) => {
            const heures = heuresDuJour(grille, jour);
            const date = enSemaine ? datesSemaine[i] : null;
            const jourPasse = enSemaine && date < auj;
            return (
              <li key={jour} className={`rounded-xl border p-3 ${jourPasse ? 'bg-gray-50' : 'bg-white'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="font-semibold text-gray-800 text-sm">
                    {NOMS_JOURS[jour]}
                    {date && <span className="ml-1 text-xs font-normal text-gray-500">{jjmm(date)}</span>}
                    <span className="ml-2 text-xs font-normal text-gray-500">{heures.length ? `${heures.length} h` : 'pas dispo'}</span>
                  </div>
                  {!jourPasse && (
                    <div className="flex flex-wrap gap-1">
                      <button type="button" onClick={() => modifierJour(i, (hs) => trier([...hs, ...plage(8, 12)]))} className="text-[11px] px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 border">8–12</button>
                      <button type="button" onClick={() => modifierJour(i, (hs) => trier([...hs, ...plage(14, 18)]))} className="text-[11px] px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 border">14–18</button>
                      <button type="button" onClick={() => modifierJour(i, (hs) => trier([...hs, ...plage(18, 21)]))} className="text-[11px] px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 border">Soir</button>
                      <button type="button" onClick={() => modifierJour(i, () => HEURES)} className="text-[11px] px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 border">Tout</button>
                      <button type="button" onClick={() => modifierJour(i, () => [])} className="text-[11px] px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 border">Vider</button>
                      <button type="button" onClick={() => setCopie({ de: jour, vers: [] })} className="text-[11px] px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 border">Copier vers…</button>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {HEURES.map((h) => {
                    const bloque = verrou(i, h);
                    const coche = heures.includes(h) && !bloque;
                    return (
                      <button
                        key={h}
                        type="button"
                        disabled={bloque}
                        onClick={() => basculer(i, h)}
                        aria-pressed={coche}
                        className={[
                          'min-w-[3.25rem] px-2 py-1.5 rounded-lg text-xs font-medium border transition',
                          bloque ? 'bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed'
                            : coche ? 'bg-green-600 text-white border-green-700' : 'bg-white text-gray-700 border-gray-300 hover:border-green-500',
                        ].join(' ')}
                        title={bloque ? 'Heure passée' : `${h} h – ${h + 1} h`}
                      >
                        {h} h
                      </button>
                    );
                  })}
                </div>

                {copie?.de === jour && (
                  <div className="mt-2 p-2.5 border rounded-xl bg-gray-50">
                    <div className="text-xs mb-1 text-gray-600">Copier les heures du {NOMS_JOURS[jour].toLowerCase()} vers :</div>
                    <div className="flex flex-wrap gap-1.5">
                      {JOURS.filter((j) => j !== jour).map((j) => {
                        const pris = copie.vers.includes(j);
                        return (
                          <button key={j} type="button"
                            onClick={() => setCopie((c) => ({ ...c, vers: pris ? c.vers.filter((x) => x !== j) : [...c.vers, j] }))}
                            className={`text-xs px-2.5 py-1 rounded-full border ${pris ? 'bg-primary text-white border-primary' : 'bg-white'}`}>
                            {NOMS_JOURS[j]}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={copierVers} className="text-xs px-3 py-1.5 rounded-lg bg-primary text-white">Copier</button>
                      <button type="button" onClick={() => setCopie(null)} className="text-xs px-3 py-1.5 rounded-lg border bg-white">Annuler</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
