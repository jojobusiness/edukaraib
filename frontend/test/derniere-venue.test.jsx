// « Savoir qui revient » (plan du 02/10/2026) : une trace de passage par jour,
// jamais plus, et qui ne gêne jamais une connexion.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { marquerVenue, PREFIXE_CLE } from '../lib/derniereVenue';

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

  it('3. revenu 2 heures plus tard → aucune écriture', async () => {
    const ecrire = vi.fn(async () => {});
    await marquerVenue({ uid: UID }, ecrire, { maintenant: 0 });
    ecrire.mockClear();
    expect(await marquerVenue({ uid: UID }, ecrire, { maintenant: 2 * H })).toBe(false);
    expect(ecrire).not.toHaveBeenCalled();
  });

  it('4. revenu 30 heures plus tard → une écriture, la clé est rafraîchie', async () => {
    const ecrire = vi.fn(async () => {});
    await marquerVenue({ uid: UID }, ecrire, { maintenant: 0 });
    expect(await marquerVenue({ uid: UID }, ecrire, { maintenant: 30 * H })).toBe(true);
    expect(ecrire).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(CLE)).toBe(String(30 * H));
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
