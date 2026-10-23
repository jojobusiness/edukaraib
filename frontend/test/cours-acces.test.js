// Verrou des cours (23/10/2026) : qui figure dans `acces`, ce que montre la
// copie publique `creneaux`, et ce que pose /api/rejoindre-groupe.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { ajoutParticipant, champsPack, demandeInvalide } from '../../api/_rejoindreGroupe.mjs';
import { concerneUnDe } from '../lib/mesCours';

const { accesDuCours, creneauPublic, placesPrises, memeListe } = createRequire(import.meta.url)('../../functions/coursAcces.js');

const GROUPE = {
  teacher_id: 'prof', is_group: true, capacity: 4, status: 'booked',
  slot_day: 'Mar', slot_hour: 17, date: '2026-10-27', week: '2026-10-26', price_per_hour: 30,
  participant_ids: ['enfant', 'eleve', 'parti'],
  participantsMap: {
    enfant: { parent_id: 'parent', booked_by: 'parent', is_paid: true, status: 'confirmed' },
    eleve: { booked_by: 'eleve', status: 'pending_teacher' },
    parti: { booked_by: 'parti', status: 'removed' },
  },
};
const fiches = { enfant: { parent_id: 'parent', full_name: 'Léa' }, ficheLiee: { user_id: 'compteEleve' } };
const lireEleve = async (id) => fiches[id] || null;

describe('acces d’un cours', () => {
  it('prof, élèves, parents, réservants', async () => {
    expect(await accesDuCours(GROUPE, lireEleve)).toEqual(['eleve', 'enfant', 'parent', 'parti', 'prof']);
  });
  it("ajoute le parent d'une fiche enfant même si participantsMap ne le cite pas (invitation du prof)", async () => {
    const l = { teacher_id: 'prof', participant_ids: ['enfant'] };
    expect(await accesDuCours(l, lireEleve)).toContain('parent');
  });
  it('ajoute le compte élève lié à une fiche students (alias)', async () => {
    expect(await accesDuCours({ teacher_id: 'prof', student_id: 'ficheLiee' }, lireEleve)).toContain('compteEleve');
  });
  it('memeListe ignore l’ordre', () => {
    expect(memeListe(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(memeListe(undefined, ['a'])).toBe(false);
  });
});

describe('copie publique (creneaux)', () => {
  it("aucun identifiant d'élève, de parent, de prix ou de paiement", () => {
    const c = creneauPublic(GROUPE);
    const texte = JSON.stringify(c);
    for (const secret of ['enfant', 'eleve', 'parent', 'parti', 'is_paid', 'price']) expect(texte).not.toContain(secret);
    expect(c).toMatchObject({ teacher_id: 'prof', slot_day: 'Mar', slot_hour: 17, date: '2026-10-27', is_group: true, capacity: 4 });
  });
  it('places prises : les retirés ne comptent pas', () => {
    expect(placesPrises(GROUPE)).toBe(2);
    expect(placesPrises({ student_id: 'x', status: 'booked' })).toBe(1);
  });
});

describe('rejoindre un groupe (serveur)', () => {
  const fv = { arrayUnion: (...x) => ({ union: x }), serverTimestamp: () => 'TS', deleteField: () => 'DEL' };
  it('ajoute le participant en attente du prof, jamais « payé »', () => {
    const m = ajoutParticipant('enfant2', { moi: 'parent', pourEnfant: true, packHours: 0, mode: 'visio', packId: null }, fv);
    expect(m['participantsMap.enfant2.is_paid']).toBe(false);
    expect(m['participantsMap.enfant2.status']).toBe('pending_teacher');
    expect(m['participantsMap.enfant2.parent_id']).toBe('parent');
    expect(m.participant_ids).toEqual({ union: ['enfant2'] });
    expect(m.acces).toEqual({ union: ['enfant2', 'parent'] });
    expect(m['participantsMap.enfant2.pack']).toBe('DEL');
  });
  it('pack 5 h', () => {
    expect(champsPack('e', { packHours: 5, mode: 'visio', packId: 'p1' }, 'DEL')).toMatchObject({
      'participantsMap.e.pack': true, 'participantsMap.e.pack_type': 'pack5', 'participantsMap.e.pack_id': 'p1',
    });
  });
  it('refuse une demande incomplète', () => {
    expect(demandeInvalide({ teacherId: 'p', targetStudentId: 'e', slot: { day: 'Mar', hour: 17, date: '2026-10-27' } })).toBeNull();
    expect(demandeInvalide({ teacherId: 'p', targetStudentId: 'e', slot: { day: 'Mar', hour: '17', date: 'x' } })).toBe('SLOT');
    expect(demandeInvalide({ teacherId: 'p', targetStudentId: 'e', slot: { day: 'Mar', hour: 17, date: 'x' }, packHours: 7 })).toBe('PACK');
  });
});

describe('concerneUnDe (pages parent)', () => {
  it('élève principal ou participant', () => {
    expect(concerneUnDe(GROUPE, ['enfant'])).toBe(true);
    expect(concerneUnDe({ student_id: 'k1' }, ['k1'])).toBe(true);
    expect(concerneUnDe(GROUPE, ['autre'])).toBe(false);
  });
});
