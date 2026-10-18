// Ce que chaque paiement nous laisse (18/10/2026).
//
// Question de Joseph : « le prof touche bien 100 % de son tarif même avec la
// com Stripe ? ». Oui — et ces tests figent la conséquence : les frais sortent
// de NOTRE commission, et quand un coupon ramène cette commission à 0 €, c'est
// nous qui payons. Le chiffre doit remonter, pas être avalé en silence.
import { describe, it, expect } from 'vitest';
import {
  margePaiement, resumeMarges, fraisStripeEstimes, fraisVirement, grilleDe, GRILLES,
} from '../../api/_marge.mjs';

// Cours d'1 h : prof 25 €, commission 10 €, la famille paie 35 €.
const cours = { status: 'held', gross_eur: 35, net_to_teacher_eur: 25, fee_eur: 10 };

describe('grille Stripe', () => {
  it('reprend les tarifs France de la doc', () => {
    expect(GRILLES.carte_eee).toMatchObject({ pct: 0.015, fixe: 25 });
    expect(GRILLES.klarna).toMatchObject({ pct: 0.0499, fixe: 40 });
  });

  it('retombe sur la carte EEE quand le moyen de paiement est inconnu', () => {
    expect(grilleDe(undefined)).toBe('carte_eee');
    expect(grilleDe('card')).toBe('carte_eee');
    expect(grilleDe('klarna')).toBe('klarna');
  });

  it('calcule 1,5 % + 0,25 € sur 35 €', () => {
    expect(fraisStripeEstimes(3500, 'card')).toBe(78);   // 52,5 → 53 + 25
    expect(fraisStripeEstimes(3500, 'klarna')).toBe(215); // 174,65 → 175 + 40
    expect(fraisStripeEstimes(0, 'card')).toBe(0);
  });

  it('ne facture le virement que s’il a eu lieu', () => {
    expect(fraisVirement(0)).toBe(0);
    expect(fraisVirement(2500)).toBe(16); // 0,25 % + 0,10 €
  });
});

describe('margePaiement', () => {
  it('⛔ le prof touche son tarif entier, les frais sortent de notre commission', () => {
    const m = margePaiement(cours);
    expect(m.prof).toBe(2500);        // 100 % du tarif, intouché
    expect(m.commission).toBe(1000);
    expect(m.fraisStripe).toBe(78);
    expect(m.net).toBe(922);          // c'est NOTRE part qui absorbe
  });

  it('compte le virement au prof une fois l’argent versé', () => {
    expect(margePaiement({ ...cours, status: 'released' }).net).toBe(906);
  });

  it('coûte plus cher en Klarna, toujours sans toucher au prof', () => {
    const m = margePaiement({ ...cours, payment_method_type: 'klarna' });
    expect(m.prof).toBe(2500);
    expect(m.net).toBe(785);
  });

  it('🚨 commission annulée par un coupon = perte pour nous, prof payé quand même', () => {
    // Parrainage −10 € sur un cours d'1 h : la famille paie le seul tarif prof.
    const m = margePaiement({ status: 'held', gross_eur: 25, net_to_teacher_eur: 25, fee_eur: 0 });
    expect(m.prof).toBe(2500);
    expect(m.commission).toBe(0);
    expect(m.net).toBeLessThan(0);
    expect(m.net).toBe(-63);
  });

  it('préfère les frais réels de Stripe à l’estimation', () => {
    const m = margePaiement({ ...cours, stripe_fee_cents: 91 });
    expect(m.fraisStripe).toBe(91);
    expect(m.estime).toBe(false);
    expect(margePaiement(cours).estime).toBe(true);
  });

  it('remboursement total : Stripe garde ses frais, la commission part', () => {
    const m = margePaiement({ ...cours, status: 'refunded', refund_amount_eur: 35 });
    expect(m.commission).toBe(0);
    expect(m.net).toBeLessThan(0);
  });

  it('remboursement partiel : la commission part au prorata', () => {
    const m = margePaiement({ ...cours, status: 'refunded', refund_amount_eur: 3.5 });
    expect(m.commission).toBe(900); // 10 % rendus
  });
});

describe('resumeMarges', () => {
  const perte = { id: 'p2', status: 'held', gross_eur: 25, net_to_teacher_eur: 25, fee_eur: 0 };

  it('ignore les sessions abandonnées (status pending)', () => {
    const r = resumeMarges([{ ...cours, status: 'pending' }, cours]);
    expect(r.nbPaiements).toBe(1);
  });

  it('totalise et remonte les paiements à perte, le pire en premier', () => {
    const r = resumeMarges([cours, perte, { ...perte, id: 'p3', gross_eur: 250, net_to_teacher_eur: 250 }]);
    expect(r.nbPaiements).toBe(3);
    expect(r.verseProfs).toBe(30000);
    expect(r.negatifs).toHaveLength(2);
    expect(r.negatifs[0].source.id).toBe('p3'); // la plus grosse perte d'abord
    expect(r.net).toBe(922 - 63 - 400);
  });

  it('ne rend aucun négatif quand tout couvre ses frais', () => {
    expect(resumeMarges([cours, cours]).negatifs).toHaveLength(0);
  });
});
