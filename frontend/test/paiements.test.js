// Onglet « Paiements & Revenus » (19/10/2026). L'ancien lisait des champs
// morts et affichait 0 partout ; ces tests figent les vrais champs écrits par
// le webhook et trigger-payout.
import { describe, it, expect } from 'vitest';
import { normaliser, filtrer, totaux, parProf, STATUTS } from '../lib/paiements';

const doc = (o) => ({
  id: 'p', status: 'held', gross_eur: 35, fee_eur: 10, net_to_teacher_eur: 25,
  teacher_uid: 'prof1', payer_uid: 'fam1', created_at: new Date('2026-10-10T12:00:00'), ...o,
});

describe('normaliser', () => {
  it('lit les champs réellement écrits par le webhook', () => {
    const l = normaliser(doc());
    expect(l).toMatchObject({ brut: 35, partProf: 25, commission: 10, profUid: 'prof1', encaisse: true });
    expect(l.libelle).toBe(STATUTS.held.libelle);
  });

  it('accepte encore teacher_id et un Timestamp Firestore', () => {
    const l = normaliser({ id: 'x', status: 'released', teacher_id: 'vieux', created_at: { toDate: () => new Date('2026-01-01') } });
    expect(l.profUid).toBe('vieux');
    expect(l.date.getFullYear()).toBe(2026);
  });

  it('un remboursé sans montant enregistré compte comme rendu en entier', () => {
    expect(normaliser(doc({ status: 'refunded' })).rembourse).toBe(35);
    expect(normaliser(doc({ status: 'refunded', refund_amount_eur: 10 })).rembourse).toBe(10);
  });

  it('ne propose le remboursement que là où refund.mjs sait le faire', () => {
    expect(normaliser(doc({ status: 'held' })).remboursable).toBe(true);
    expect(normaliser(doc({ status: 'released' })).remboursable).toBe(true);
    expect(normaliser(doc({ status: 'refunded' })).remboursable).toBe(false);
    expect(normaliser(doc({ status: 'payout_pending_rib' })).aVerser).toBe(true);
  });

  it('ne lève pas sur un document vide ou un statut inconnu', () => {
    expect(() => normaliser({})).not.toThrow();
    expect(normaliser({ status: 'bizarre' }).encaisse).toBe(false);
  });
});

describe('filtrer', () => {
  const lignes = [
    normaliser(doc({ id: 'a', created_at: new Date('2026-10-01T10:00:00') })),
    normaliser(doc({ id: 'b', created_at: new Date('2026-10-15T10:00:00'), status: 'released' })),
    normaliser(doc({ id: 'c', status: 'pending' })),
  ];

  it('cache les paiements non finalisés par défaut', () => {
    expect(filtrer(lignes).map((l) => l.id)).toEqual(['a', 'b']);
    expect(filtrer(lignes, { nonFinalises: true })).toHaveLength(3);
  });

  it('filtre par période, bornes incluses', () => {
    expect(filtrer(lignes, { du: '2026-10-15', au: '2026-10-15' }).map((l) => l.id)).toEqual(['b']);
  });

  it('filtre par statut', () => {
    expect(filtrer(lignes, { statut: 'released' }).map((l) => l.id)).toEqual(['b']);
  });
});

describe('totaux et parProf', () => {
  const lignes = [
    normaliser(doc({ id: '1', status: 'held' })),
    normaliser(doc({ id: '2', status: 'released' })),
    normaliser(doc({ id: '3', status: 'payout_pending_rib', teacher_uid: 'prof2' })),
    normaliser(doc({ id: '4', status: 'refunded', refund_amount_eur: 35 })),
    normaliser(doc({ id: '5', status: 'pending' })),
  ];

  it("ne compte que l'argent réellement encaissé", () => {
    const t = totaux(lignes);
    expect(t.nb).toBe(4);
    expect(t.encaisse).toBe(140);
    expect(t.rembourse).toBe(35);
    expect(t.commission).toBe(30); // le remboursé ne nous laisse rien
  });

  it('sépare versé, en attente du cours, et dû au prof', () => {
    const t = totaux(lignes);
    expect(t.verseProfs).toBe(25);
    expect(t.enAttenteCours).toBe(25);
    expect(t.duAuxProfs).toBe(25);
    expect(t.nbDus).toBe(1);
  });

  it("met en tête le prof à qui on doit de l'argent", () => {
    const r = parProf(lignes);
    expect(r[0]).toMatchObject({ profUid: 'prof2', du: 25 });
    expect(r.find((x) => x.profUid === 'prof1')).toMatchObject({ nb: 3, verse: 25, enAttente: 25 });
  });
});
