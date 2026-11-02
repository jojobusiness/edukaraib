// Champ « code créateur » (02/11/2026).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { rendre } from './rendre';
import CodeCreateur from '../components/CodeCreateur';
import { getCampaignCode, saveCampaign } from '../lib/bacCampaign';

const reponse = (valide) => vi.fn(async () => ({ json: async () => ({ valide }) }));
const taper = (code) => {
  fireEvent.click(screen.getByRole('button', { name: /code créateur/ }));
  fireEvent.change(screen.getByLabelText('Code créateur'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
};

beforeEach(() => localStorage.clear());

describe('CodeCreateur', () => {
  it('code valide : gardé pour le paiement et confirmé', async () => {
    global.fetch = reponse(true);
    rendre(<CodeCreateur />);
    taper('marie973');
    expect(await screen.findByText(/Code MARIE973 appliqué/)).toBeTruthy();
    expect(getCampaignCode()).toBe('MARIE973');
  });
  it('code inconnu : rien de gardé, message clair', async () => {
    global.fetch = reponse(false);
    rendre(<CodeCreateur />);
    taper('FAUX99');
    expect(await screen.findByText(/n’existe pas/)).toBeTruthy();
    expect(getCampaignCode()).toBeNull();
  });
  it('venu par un lien : déjà appliqué, rien à taper', () => {
    saveCampaign({ code: 'MARIE973' });
    rendre(<CodeCreateur />);
    expect(screen.getByText(/Code MARIE973 appliqué/)).toBeTruthy();
    expect(screen.queryByLabelText('Code créateur')).toBeNull();
  });
});
