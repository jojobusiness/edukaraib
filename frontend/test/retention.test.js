// Conservation des conversations (15/10/2026) : 12 mois, puis purge.
// Un seul bug ici et on détruit une preuve de harcèlement, ou on garde des
// conversations pour toujours — les deux sont graves, dans des sens opposés.
import { describe, it, expect } from 'vitest';
import { aPurger, derniereActivite, MOIS_CONSERVATION } from '../../api/_retention.mjs';

const MAINTENANT = new Date('2026-10-15T12:00:00Z');
const ilYAMois = (n) => {
  const d = new Date(MAINTENANT);
  d.setMonth(d.getMonth() - n);
  return d;
};

describe('aPurger', () => {
  it('garde une conversation récente', () => {
    expect(aPurger({ lastSentAt: ilYAMois(3) }, { maintenant: MAINTENANT }).purger).toBe(false);
  });

  it('purge une conversation inactive depuis plus de 12 mois', () => {
    expect(aPurger({ lastSentAt: ilYAMois(13) }, { maintenant: MAINTENANT }).purger).toBe(true);
  });

  it('garde celle qui a tout juste 12 mois (on ne purge pas à la minute près)', () => {
    expect(aPurger({ lastSentAt: ilYAMois(12) }, { maintenant: MAINTENANT }).purger).toBe(false);
  });

  it('⛔ ne purge JAMAIS une conversation gelée par un signalement, même très ancienne', () => {
    const r = aPurger({ lastSentAt: ilYAMois(36), conservation_litige: true }, { maintenant: MAINTENANT });
    expect(r.purger).toBe(false);
    expect(r.raison).toMatch(/litige|signalement/);
  });

  it('ne purge pas sur une date absente : on ne devine pas', () => {
    expect(aPurger({}, { maintenant: MAINTENANT }).purger).toBe(false);
    expect(aPurger(undefined, { maintenant: MAINTENANT }).purger).toBe(false);
  });

  it('retombe sur la date de création quand il n’y a jamais eu de message', () => {
    expect(derniereActivite({ created_at: ilYAMois(14) })).toEqual(ilYAMois(14));
    expect(aPurger({ created_at: ilYAMois(14) }, { maintenant: MAINTENANT }).purger).toBe(true);
  });

  it('accepte un horodatage Firestore comme une date', () => {
    const vieux = ilYAMois(20);
    expect(aPurger({ lastSentAt: { toDate: () => vieux } }, { maintenant: MAINTENANT }).purger).toBe(true);
  });

  it('la durée annoncée aux utilisateurs est bien celle du code', () => {
    expect(MOIS_CONSERVATION).toBe(12);
  });
});
