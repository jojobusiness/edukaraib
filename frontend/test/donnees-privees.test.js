// Verrou des données personnelles (23/10/2026). Ces règles décident de ce
// qui sort de la base vers un autre utilisateur : une régression ici
// republie des e-mails, des téléphones ou des dates de naissance d'enfants.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { adressesDe, ctaSur, lienDuSite } from '../../api/_destinataires.mjs';
import { peutVoirEleve, ficheTiers, participeAuCours } from '../../api/_fichesEleves.mjs';
import { accesDuCours } from '../lib/accesCours';

const { profilPublic, CHAMPS_PROF, CHAMPS_NOM } = createRequire(import.meta.url)('../../functions/profilPublic.js');

const PRIVES = ['email', 'phone', 'birth', 'stripeAccountId', 'acquisition', 'lastSeenAt',
  'partner_uid', 'referralCode', 'studentReferralCode', 'profileViews', 'promo', 'trialUsedWith'];

describe('profilPublic — la copie publique d’un compte', () => {
  const prof = {
    role: 'teacher', fullName: 'Jean Prof', subjects: ['Maths'], price_per_hour: 30, availability: { Lun: [9] },
    email: 'jean@x.fr', phone: '0600', birth: '1990-01-01', stripeAccountId: 'acct_1', acquisition: { source: 'x' },
    lastSeenAt: 1, referralCode: 'PROF-1', stripeChargesEnabled: true,
  };
  it('garde la vitrine du prof', () => {
    const p = profilPublic('u1', prof);
    expect(p).toMatchObject({ uid: 'u1', role: 'teacher', fullName: 'Jean Prof', subjects: ['Maths'], price_per_hour: 30, stripeChargesEnabled: true });
  });
  it('ne publie AUCUN champ privé', () => {
    const p = profilPublic('u1', prof);
    for (const k of PRIVES) expect(p).not.toHaveProperty(k);
  });
  it("ne garde que le nom et l'avatar d'un élève", () => {
    const p = profilPublic('e1', { role: 'student', fullName: 'Élève', avatarUrl: 'a.png', price_per_hour: 99, city: 'Cayenne', email: 'e@x.fr' });
    expect(p).toEqual({ uid: 'e1', role: 'student', fullName: 'Élève', avatarUrl: 'a.png' });
  });
  it('aucun champ privé dans les listes blanches', () => {
    for (const k of PRIVES) {
      expect(CHAMPS_PROF).not.toContain(k);
      expect(CHAMPS_NOM).not.toContain(k);
    }
  });
  it('compte supprimé : rien à publier', () => {
    expect(profilPublic('u1', null)).toBeNull();
  });
});

describe('notify-email — on écrit à un identifiant, pas à une adresse', () => {
  const base = {
    'users/prof': { email: 'Prof@X.fr' },
    'users/parent': { email: 'parent@x.fr' },
    'students/enfant1': { parent_id: 'parent' },
    'students/enfant2': { parent_id: 'parent' },
  };
  const lire = async (col, id) => base[`${col}/${id}`] || null;
  it("trouve l'adresse d'un compte, et celle du parent pour un enfant", async () => {
    expect(await adressesDe(['prof', 'enfant1'], lire)).toEqual(['prof@x.fr', 'parent@x.fr']);
  });
  it('un parent de deux enfants ne reçoit qu’un mail', async () => {
    expect(await adressesDe(['enfant1', 'enfant2'], lire)).toEqual(['parent@x.fr']);
  });
  it('identifiant inconnu : personne', async () => {
    expect(await adressesDe(['inconnu', null, ''], lire)).toEqual([]);
  });
  it('seuls les liens du site passent', () => {
    expect(lienDuSite('https://edukaraib.com/prof/dashboard')).toBe(true);
    expect(lienDuSite('https://www.edukaraib.com/x')).toBe(true);
    expect(lienDuSite('https://edukaraib.com.pirate.io/x')).toBe(false);
    expect(lienDuSite('http://edukaraib.com/x')).toBe(false);
    expect(lienDuSite('javascript:alert(1)')).toBe(false);
    expect(ctaSur('https://pirate.io', 'https://edukaraib.com/smart-dashboard')).toBe('https://edukaraib.com/smart-dashboard');
  });
});

describe('fiche d’un enfant pour un tiers', () => {
  const enfant = { full_name: 'Léa', birth_date: '2015-05-05', school_level: 'CM2', parent_id: 'parent' };
  const lecon = { teacher_id: 'prof', participant_ids: ['enfant'], participantsMap: { enfant: { parent_id: 'parent', booked_by: 'parent' } } };
  it('le parent et l’admin la voient', () => {
    expect(peutVoirEleve('parent', enfant, [])).toBe(true);
    expect(peutVoirEleve('admin', enfant, [], true)).toBe(true);
  });
  it('le prof d’un cours où figure l’enfant la voit, un autre prof non', () => {
    expect(peutVoirEleve('prof', enfant, [lecon])).toBe(true);
    expect(peutVoirEleve('autreProf', enfant, [lecon])).toBe(false);
    expect(peutVoirEleve('prof', enfant, [])).toBe(false);
  });
  it('jamais la date de naissance', () => {
    expect(ficheTiers('enfant', enfant)).toEqual({ id: 'enfant', full_name: 'Léa', school_level: 'CM2', parent_id: 'parent' });
  });
  it('participeAuCours reconnaît prof, élève, parent et réservant', () => {
    expect(participeAuCours('prof', lecon)).toBe(true);
    expect(participeAuCours('enfant', lecon)).toBe(true);
    expect(participeAuCours('parent', lecon)).toBe(true);
    expect(participeAuCours('intrus', lecon)).toBe(false);
  });
});

describe('accès aux fichiers d’un cours', () => {
  it('prof, élèves, parents et auteur, sans doublon', () => {
    const lecon = { teacher_id: 'prof', student_id: 'enfant', participant_ids: ['enfant', 'eleve2'], participantsMap: { enfant: { parent_id: 'parent', booked_by: 'parent' } } };
    expect(accesDuCours(lecon, 'prof').sort()).toEqual(['eleve2', 'enfant', 'parent', 'prof']);
  });
  it('cours supprimé : l’auteur seul', () => {
    expect(accesDuCours(null, 'auteur')).toEqual(['auteur']);
  });
});
