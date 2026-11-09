import { describe, it, expect } from 'vitest';
import { corrigerIndicatif, paysDepuisTelephone, paysDepuisEntete } from '../../api/_telephone.mjs';

describe('indicatif des DOM (09/11/2026)', () => {
  it('mobile guyanais saisi en +33 → +594 (cas réel de Cayenne)', () => {
    expect(corrigerIndicatif('+33694993063')).toBe('+594694993063');
  });
  it('Guadeloupe, Martinique, Réunion, Mayotte', () => {
    expect(corrigerIndicatif('+33690123456')).toBe('+590690123456');
    expect(corrigerIndicatif('+33696123456')).toBe('+596696123456');
    expect(corrigerIndicatif('+33697123456')).toBe('+596697123456');
    expect(corrigerIndicatif('+33692123456')).toBe('+262692123456');
    expect(corrigerIndicatif('+33639123456')).toBe('+262639123456');
    expect(corrigerIndicatif('+33594123456')).toBe('+594594123456');
  });
  it('mobile de métropole saisi avec l’indicatif Guyane par défaut → +33', () => {
    expect(corrigerIndicatif('+594612345678')).toBe('+33612345678');
  });
  it('ne touche pas aux bons numéros ni aux autres pays', () => {
    expect(corrigerIndicatif('+594694993063')).toBe('+594694993063');
    expect(corrigerIndicatif('+596696233601')).toBe('+596696233601');
    expect(corrigerIndicatif('+33612345678')).toBe('+33612345678');
    expect(corrigerIndicatif('+2250701020304')).toBe('+2250701020304');
    expect(corrigerIndicatif('')).toBe('');
    expect(corrigerIndicatif(undefined)).toBe('');
  });
  it('territoire déduit du numéro', () => {
    expect(paysDepuisTelephone('+33694993063')).toBe('GF');
    expect(paysDepuisTelephone('+33639123456')).toBe('YT');
    expect(paysDepuisTelephone('+33612345678')).toBe('FR');
    expect(paysDepuisTelephone('')).toBe('');
  });
  it('en-tête pays nettoyé', () => {
    expect(paysDepuisEntete('gf')).toBe('GF');
    expect(paysDepuisEntete('<script>')).toBe('');
  });
});
