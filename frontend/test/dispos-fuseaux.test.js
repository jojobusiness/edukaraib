// Disponibilités récurrentes + fuseaux horaires (PLAN_DISPOS_PROFS, 16/11/2026).
import { describe, it, expect } from 'vitest';
import {
  instantLocal, partiesLocales, heureDans, lundiDe, ajouterJours, fuseauProbable,
  libelleUtc, dateHeureLongue, decalageMinutes,
} from '../../api/_fuseaux.mjs';
import {
  grilleSemaine, nbCreneaux, modeleDe, heuresLe, creneauxRecurrents, modeleDepuisDerniereSemaine,
} from '../../api/_dispos.mjs';

const GUYANE = 'America/Cayenne';
const MARTINIQUE = 'America/Martinique';
const REUNION = 'Indian/Reunion';
const PARIS = 'Europe/Paris';

describe('fuseaux : chacun voit l’heure de chez lui', () => {
  it('prof en Guyane coche 18 h → 17 h en Martinique, 1 h le lendemain à La Réunion', () => {
    const t = instantLocal('2026-11-23', 18, GUYANE); // lundi
    expect(t.toISOString()).toBe('2026-11-23T21:00:00.000Z');
    expect(partiesLocales(t, MARTINIQUE)).toMatchObject({ date: '2026-11-23', heure: 17, jour: 'Lun' });
    expect(partiesLocales(t, REUNION)).toMatchObject({ date: '2026-11-24', heure: 1, jour: 'Mar' });
  });

  it('prof dans l’Hexagone coche 18 h : 13 h en Martinique l’hiver, 12 h après le 29/03/2027', () => {
    expect(heureDans(instantLocal('2026-11-23', 18, PARIS), MARTINIQUE)).toBe('13 h');
    expect(heureDans(instantLocal('2027-03-29', 18, PARIS), MARTINIQUE)).toBe('12 h');
    expect(libelleUtc(PARIS, new Date('2027-04-01T12:00:00Z'))).toBe('UTC+2');
    expect(libelleUtc(GUYANE)).toBe('UTC−3');
  });

  it('prof à La Réunion coche 7 h lundi → dimanche 0 h en Guyane, rangé au dimanche', () => {
    const t = instantLocal('2026-11-23', 7, REUNION);
    expect(partiesLocales(t, GUYANE)).toMatchObject({ date: '2026-11-23', heure: 0, jour: 'Lun' });
    // 7 h à La Réunion (UTC+4) = 3 h UTC = 0 h en Guyane LE MÊME lundi.
    // Le plan évoquait dimanche : avec UTC+4 / UTC−3 l'écart est de 7 h, donc 0 h lundi.
    const t2 = instantLocal('2026-11-23', 6, REUNION);
    expect(partiesLocales(t2, GUYANE)).toMatchObject({ date: '2026-11-22', heure: 23, jour: 'Dim' });
  });

  it('jour de changement d’heure : l’instant reste juste', () => {
    const t = instantLocal('2027-03-28', 10, PARIS); // passage à l'heure d'été cette nuit-là
    expect(partiesLocales(t, PARIS)).toMatchObject({ date: '2027-03-28', heure: 10 });
    expect(decalageMinutes(PARIS, t)).toBe(120);
  });

  it('dates : lundi de la semaine et ajout de jours', () => {
    expect(lundiDe('2026-11-16')).toBe('2026-11-16');
    expect(lundiDe('2026-11-22')).toBe('2026-11-16');
    expect(ajouterJours('2026-12-28', 7)).toBe('2027-01-04');
  });

  it('fuseau du compte : le navigateur, sauf Paris pour un compte des DOM', () => {
    expect(fuseauProbable({ navigateur: MARTINIQUE, pays: 'MQ' })).toBe(MARTINIQUE);
    expect(fuseauProbable({ navigateur: PARIS, pays: 'GF' })).toBe(GUYANE);
    expect(fuseauProbable({ navigateur: PARIS, pays: 'FR' })).toBe(PARIS);
    expect(fuseauProbable({ navigateur: null, pays: 'RE' })).toBe(REUNION);
    expect(fuseauProbable({ navigateur: 'America/New_York', pays: null })).toBe('America/New_York');
  });

  it('mail : date et heure dans le fuseau du destinataire, nommé', () => {
    const t = instantLocal('2026-11-23', 18, GUYANE);
    expect(dateHeureLongue(t, MARTINIQUE)).toBe('lundi 23 novembre à 17 h, heure de Martinique');
    expect(dateHeureLongue(t, null)).toBe('lundi 23 novembre à 18 h, heure de Guyane');
  });
});

describe('dispos : horaires habituels + semaines particulières', () => {
  const maintenant = new Date('2026-11-16T12:00:00Z');
  const modele = { Lun: [9, 10], Mer: [14] };

  it('une semaine sans exception prend le modèle ; une exception le remplace, même vide', () => {
    const a = { modele, '2026-11-23': { Lun: [18] }, '2026-11-30': {} };
    expect(grilleSemaine(a, '2026-11-16')).toBe(modele);
    expect(grilleSemaine(a, '2026-11-23')).toEqual({ Lun: [18] });
    expect(grilleSemaine(a, '2026-11-30')).toEqual({});
    expect(grilleSemaine(a, '2026-12-07')).toBe(modele);
    expect(heuresLe(a, '2026-12-09')).toEqual([14]);
  });

  it('un prof avec des horaires habituels a des créneaux cette semaine ET dans 3 semaines', () => {
    const a = { modele };
    expect(heuresLe(a, '2026-11-16')).toEqual([9, 10]);
    expect(heuresLe(a, '2026-12-07')).toEqual([9, 10]);
    expect(nbCreneaux(a, maintenant)).toBe(3 * 4);
  });

  it('sans modèle : seules les semaines datées futures comptent (règle du 02/11)', () => {
    expect(nbCreneaux({ '2026-03-02': { Lun: [9] } }, maintenant)).toBe(0);
    expect(nbCreneaux({ '2026-12-14': { Lun: [9, 10] } }, maintenant)).toBe(2);
    expect(nbCreneaux({ fuseau: GUYANE }, maintenant)).toBe(0);
  });

  it('l’ancien format { Lun: [...] } sert de modèle', () => {
    expect(modeleDe({ Lun: [9] })).toEqual({ Lun: [9] });
    expect(nbCreneaux({ Lun: [9] }, maintenant)).toBe(4);
    expect(modeleDe({ Lun: [9], '2026-11-16': { Mar: [8] } })).toBe(null);
  });

  it('créneaux récurrents (abonnement) : modèle + exceptions à venir, triés', () => {
    const a = { modele: { Mer: [14], Lun: [10, 9] }, '2026-11-23': { Ven: [8] } };
    expect(creneauxRecurrents(a, maintenant)).toEqual([
      { day: 'Lun', hour: 9 }, { day: 'Lun', hour: 10 }, { day: 'Mer', hour: 14 }, { day: 'Ven', hour: 8 },
    ]);
  });

  it('migration : la dernière semaine remplie devient le modèle', () => {
    const a = { '2026-09-07': { Lun: [9] }, '2026-10-05': { Mar: [14, 15] }, '2026-10-12': {} };
    expect(modeleDepuisDerniereSemaine(a)).toEqual({
      semaine: '2026-10-05',
      modele: { Lun: [], Mar: [14, 15], Mer: [], Jeu: [], Ven: [], Sam: [], Dim: [] },
    });
    expect(modeleDepuisDerniereSemaine({ modele: {}, '2026-10-05': { Mar: [14] } })).toBe(null);
    expect(modeleDepuisDerniereSemaine({})).toBe(null);
  });
});
