// Alertes admin (16/11/2026) : tout part vers contact@ (Zoho), plus rien vers
// le Gmail qu'on ne lit plus ; rappel si un message attend 2 h.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { ADMIN_INBOX, rappelAdminDu } from '../../api/_adminInbox.mjs';

describe('alertes admin', () => {
  it('la boîte des alertes est contact@edukaraib.com', () => {
    expect(ADMIN_INBOX).toBe('contact@edukaraib.com');
    expect(readFileSync('functions/index.js', 'utf8')).toMatch(/default: "contact@edukaraib\.com"/);
  });

  it("plus aucun envoi vers edukaraib@gmail.com dans l'API, les fonctions ou les pages", () => {
    const fichiers = [
      ...readdirSync('api').filter((f) => /\.(m?js)$/.test(f)).map((f) => `api/${f}`),
      'functions/index.js', 'frontend/pages/FAQ.jsx',
    ];
    for (const f of fichiers) expect(readFileSync(f, 'utf8'), f).not.toMatch(/edukaraib@gmail\.com/);
  });

  it('rappel à 2 h, une seule fois, jamais après une réponse', () => {
    const t0 = new Date('2026-11-16T09:52:00Z');
    const s = { premier_sans_reponse_at: t0, repondu_at: null, rappel_at: null };
    expect(rappelAdminDu(s, new Date('2026-11-16T11:51:00Z'))).toBe(false);
    expect(rappelAdminDu(s, new Date('2026-11-16T11:52:00Z'))).toBe(true);
    expect(rappelAdminDu({ ...s, repondu_at: new Date() }, new Date('2026-11-16T15:00:00Z'))).toBe(false);
    expect(rappelAdminDu({ ...s, rappel_at: new Date() }, new Date('2026-11-16T15:00:00Z'))).toBe(false);
    expect(rappelAdminDu({ premier_sans_reponse_at: { toDate: () => t0 } }, new Date('2026-11-16T12:00:00Z'))).toBe(true);
    expect(rappelAdminDu({}, new Date())).toBe(false);
  });
});
