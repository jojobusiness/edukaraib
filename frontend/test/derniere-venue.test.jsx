// « Savoir qui revient » (plan du 02/10/2026) : une trace de passage par heure
// (24 h jusqu'au 23/10/2026), jamais plus, et qui ne gêne jamais une connexion.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  marquerVenue, PREFIXE_CLE, libelleDerniereVenue, trierParVenue, filtrerParVenue,
} from '../lib/derniereVenue';

const UID = 'u1';
const H = 60 * 60 * 1000;
const CLE = `${PREFIXE_CLE}${UID}`;

describe('marquerVenue', () => {
  beforeEach(() => localStorage.clear());

  it("1. personne de connectée → aucune écriture", async () => {
    const ecrire = vi.fn();
    expect(await marquerVenue(null, ecrire)).toBe(false);
    expect(ecrire).not.toHaveBeenCalled();
  });

  it('2. première venue → une écriture, et la clé est posée', async () => {
    const ecrire = vi.fn(async () => {});
    const maintenant = 1_000_000;
    expect(await marquerVenue({ uid: UID }, ecrire, { maintenant })).toBe(true);
    expect(ecrire).toHaveBeenCalledWith(UID);
    expect(localStorage.getItem(CLE)).toBe(String(maintenant));
  });

  it('3. revenu 59 minutes plus tard → aucune écriture', async () => {
    const ecrire = vi.fn(async () => {});
    await marquerVenue({ uid: UID }, ecrire, { maintenant: 0 });
    ecrire.mockClear();
    expect(await marquerVenue({ uid: UID }, ecrire, { maintenant: 59 * 60 * 1000 })).toBe(false);
    expect(ecrire).not.toHaveBeenCalled();
  });

  it('4. revenu 61 minutes plus tard → une écriture, la clé est rafraîchie', async () => {
    const ecrire = vi.fn(async () => {});
    await marquerVenue({ uid: UID }, ecrire, { maintenant: 0 });
    expect(await marquerVenue({ uid: UID }, ecrire, { maintenant: 61 * 60 * 1000 })).toBe(true);
    expect(ecrire).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(CLE)).toBe(String(61 * 60 * 1000));
  });

  it('5. stockage inaccessible (navigation privée) → on écrit quand même, sans erreur', async () => {
    const vraiGet = Storage.prototype.getItem;
    const vraiSet = Storage.prototype.setItem;
    Storage.prototype.getItem = () => { throw new Error('SecurityError'); };
    Storage.prototype.setItem = () => { throw new Error('SecurityError'); };
    try {
      const ecrire = vi.fn(async () => {});
      await expect(marquerVenue({ uid: UID }, ecrire)).resolves.toBe(true);
      expect(ecrire).toHaveBeenCalledOnce();
    } finally {
      Storage.prototype.getItem = vraiGet;
      Storage.prototype.setItem = vraiSet;
    }
  });

  it("6. l'écriture Firestore échoue → l'exception est avalée, la session continue", async () => {
    const ecrire = vi.fn(async () => { throw new Error('permission-denied'); });
    await expect(marquerVenue({ uid: UID }, ecrire)).resolves.toBe(false);
    // Rien n'est noté : la prochaine visite retentera
    expect(localStorage.getItem(CLE)).toBeNull();
  });
});

// Colonne « Dernière venue » de l'onglet Comptes (plan du 23/10/2026).
// Cas réels du 23/10 : Arol (inscrit 21/10 18 h 29, jamais revenu) et Dylan
// (inscrit 21/10 18 h 48, revenu le 22/10 à 06 h 07). Heures de Paris (UTC+2).
describe('libelleDerniereVenue', () => {
  const MAINTENANT = Date.parse('2026-10-23T16:00:00+02:00');
  const AROL = { id: 'arol', createdAt: Date.parse('2026-10-21T18:29:00+02:00'), lastSeenAt: Date.parse('2026-10-21T18:29:30+02:00') };
  const DYLAN = { id: 'dylan', createdAt: Date.parse('2026-10-21T18:48:00+02:00'), lastSeenAt: Date.parse('2026-10-22T06:07:00+02:00') };
  const ANCIEN = { id: 'ancien', createdAt: Date.parse('2026-08-01T10:00:00+02:00') };

  it('jamais tracé', () => {
    expect(libelleDerniereVenue(ANCIEN.createdAt, null, MAINTENANT)).toMatchObject({ texte: 'jamais tracé', ton: 'gris' });
  });
  it("Arol : pas revenu depuis l'inscription", () => {
    expect(libelleDerniereVenue(AROL.createdAt, AROL.lastSeenAt, MAINTENANT)).toMatchObject({ texte: "pas revenu depuis l'inscription", ton: 'orange' });
  });
  it('frontière exacte : 1 h après l’inscription = revenu', () => {
    const c = Date.parse('2026-10-23T08:00:00+02:00');
    expect(libelleDerniereVenue(c, c + H - 1, MAINTENANT).ton).toBe('orange');
    expect(libelleDerniereVenue(c, c + H, MAINTENANT).texte).toBe("aujourd'hui");
  });
  it("hier, puis « il y a N j », avec la date complète au survol", () => {
    expect(libelleDerniereVenue(DYLAN.createdAt, DYLAN.lastSeenAt, Date.parse('2026-10-22T20:00:00+02:00')).texte).toBe("aujourd'hui");
    expect(libelleDerniereVenue(DYLAN.createdAt, DYLAN.lastSeenAt, Date.parse('2026-10-23T05:00:00+02:00')).texte).toBe('hier');
    const l = libelleDerniereVenue(DYLAN.createdAt, DYLAN.lastSeenAt, MAINTENANT);
    expect(l.texte).toBe('il y a 1 j');
    expect(l.titre).toBe('22/10/2026 06:07');
  });
  it('accepte un Timestamp Firestore', () => {
    const ts = { toMillis: () => DYLAN.lastSeenAt };
    expect(libelleDerniereVenue({ seconds: DYLAN.createdAt / 1000 }, ts, MAINTENANT).texte).toBe('il y a 1 j');
  });
  it('tri : la plus récente d’abord, « jamais tracé » en dernier', () => {
    expect(trierParVenue([ANCIEN, AROL, DYLAN]).map((u) => u.id)).toEqual(['dylan', 'arol', 'ancien']);
  });
  it('filtres : Arol « pas revenu », Dylan « revenu depuis 7 jours »', () => {
    expect(filtrerParVenue([AROL, DYLAN, ANCIEN], 'pasRevenus', MAINTENANT).map((u) => u.id)).toEqual(['arol']);
    expect(filtrerParVenue([AROL, DYLAN, ANCIEN], 'revenus7j', MAINTENANT).map((u) => u.id)).toEqual(['dylan']);
    expect(filtrerParVenue([AROL, DYLAN, ANCIEN], 'tous', MAINTENANT)).toHaveLength(3);
  });
});
