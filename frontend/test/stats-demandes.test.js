// Demandes de mise en relation (15/10/2026) — le calcul que lisent l'onglet
// « 🔥 Leads » de l'admin ET scripts/diag-messages.mjs.
// ⚖️ Il ne doit JAMAIS dépendre de la collection `messages` : secret des
// correspondances (CPCE art. L32-3).
import { describe, it, expect } from 'vitest';
import { statsDemandes, dureeLisible, mediane } from '../lib/statsMessages';

const H = 3600000;
const MAINTENANT = new Date('2026-10-15T12:00:00Z');
const il_y_a = (ms) => new Date(MAINTENANT.getTime() - ms);

const users = [
  { uid: 'e1', role: 'student', fullName: 'Chamsia ABDOUL', acquisition: { source: 'video' } },
  { uid: 'e2', role: 'parent', fullName: 'Tayrik Ringuet' },
  { uid: 'p1', role: 'teacher', fullName: 'Durock Jean Louis' },
  { uid: 'p2', role: 'teacher', fullName: 'Aurélie ARCON' },
  { uid: 'test1', role: 'student', fullName: 'Compte Test' },
];

describe('statsDemandes', () => {
  it('classe répondu, sans réponse et réservé', () => {
    const { lignes, totaux } = statsDemandes({
      demandes: [
        { id: 'e1_p1', eleve_uid: 'e1', prof_uid: 'p1', created_at: il_y_a(10 * H), prof_repondu_at: il_y_a(8 * H) },
        { id: 'e2_p2', eleve_uid: 'e2', prof_uid: 'p2', created_at: il_y_a(6 * H), prof_repondu_at: null },
      ],
      users,
      lessons: [{ student_id: 'e1', teacher_id: 'p1' }],
      jours: 30,
      maintenant: MAINTENANT,
    });
    expect(lignes.map((l) => l.statut)).toEqual(['sans réponse', 'réservé']);
    expect(totaux.demandes).toBe(2);
    expect(totaux.sansReponse).toBe(1);
    expect(totaux.tauxReponse).toBe(50);
    expect(lignes.find((l) => l.statut === 'sans réponse').attendDepuis).toBe(6 * H);
    expect(lignes.find((l) => l.statut === 'réservé').delai).toBe(2 * H);
  });

  it('reprend la source d’acquisition de l’élève', () => {
    const { lignes } = statsDemandes({
      demandes: [{ eleve_uid: 'e1', prof_uid: 'p1', created_at: il_y_a(H) }],
      users,
      jours: 30,
      maintenant: MAINTENANT,
    });
    expect(lignes[0].source).toBe('video');
  });

  it('écarte les comptes de test et respecte la fenêtre', () => {
    const { totaux } = statsDemandes({
      demandes: [
        { eleve_uid: 'test1', prof_uid: 'p1', created_at: il_y_a(H) },
        { eleve_uid: 'e1', prof_uid: 'p1', created_at: il_y_a(40 * 24 * H) },
      ],
      users,
      jours: 30,
      maintenant: MAINTENANT,
    });
    expect(totaux.demandes).toBe(0);
  });

  it('compte par professeur, et signale celui qui ne répond jamais', () => {
    const { parProf } = statsDemandes({
      demandes: [
        { eleve_uid: 'e1', prof_uid: 'p2', created_at: il_y_a(5 * H) },
        { eleve_uid: 'e2', prof_uid: 'p2', created_at: il_y_a(4 * H) },
        { eleve_uid: 'e1', prof_uid: 'p1', created_at: il_y_a(3 * H), prof_repondu_at: il_y_a(2 * H) },
      ],
      users,
      jours: 30,
      maintenant: MAINTENANT,
    });
    expect(parProf[0]).toMatchObject({ prof: 'Aurélie ARCON', recues: 2, repondues: 0 });
    expect(parProf[1]).toMatchObject({ prof: 'Durock Jean Louis', recues: 1, repondues: 1 });
  });

  it('ne plante pas sans données', () => {
    const { lignes, totaux } = statsDemandes();
    expect(lignes).toEqual([]);
    expect(totaux.tauxReponse).toBeNull();
  });

  it('affiche des durées lisibles', () => {
    expect(dureeLisible(30 * 60000)).toBe('30 min');
    expect(dureeLisible(5 * H)).toBe('5.0 h');
    expect(dureeLisible(72 * H)).toBe('3 j');
    expect(dureeLisible(null)).toBe('—');
    expect(mediane([1, 3, 5])).toBe(3);
    expect(mediane([])).toBeNull();
  });
});
