/**
 * bacCampaign.js — survie du contexte campagne (landing /bac) à travers le tunnel :
 * landing → inscription express → recherche → profil prof → paiement.
 *
 * Tout passe par localStorage avec une expiration (14 jours) pour que le code
 * promo influenceur (ex: LHATIEN81) soit auto-appliqué au paiement même si
 * l'élève paie plusieurs jours après avoir cliqué le lien TikTok.
 */

const CAMPAIGN_KEY = 'edk_bac_campaign';
const CHAT_DRAFT_KEY = 'edk_chat_draft';
const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 jours

function readCampaign() {
  try {
    const raw = localStorage.getItem(CAMPAIGN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || (data.exp && Date.now() > data.exp)) {
      localStorage.removeItem(CAMPAIGN_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/** Fusionne et sauvegarde le contexte campagne ({ code, pack, subject }) */
export function saveCampaign(partial) {
  try {
    const current = readCampaign() || {};
    const next = { ...current, ...partial, exp: Date.now() + TTL_MS };
    localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(next));
  } catch {}
}

/** Code promo influenceur capté via /bac?code=XXX (ou null) */
export function getCampaignCode() {
  const c = readCampaign();
  const code = (c?.code || '').trim().toUpperCase();
  return /^[A-Z0-9-]{4,20}$/.test(code) ? code : null;
}

/** Pack choisi sur la landing : 0 (solo), 5 ou 10 (ou null si rien) */
export function getCampaignPack() {
  const c = readCampaign();
  return c && [0, 5, 10].includes(c.pack) ? c.pack : null;
}

/** Matière choisie sur la landing (ou null) */
export function getCampaignSubject() {
  const c = readCampaign();
  return c?.subject || null;
}

/** Brouillon de message à injecter dans la messagerie (une seule fois) */
export function setChatDraft(text) {
  try { localStorage.setItem(CHAT_DRAFT_KEY, String(text || '')); } catch {}
}

export function consumeChatDraft() {
  try {
    const d = localStorage.getItem(CHAT_DRAFT_KEY);
    if (d) localStorage.removeItem(CHAT_DRAFT_KEY);
    return d || null;
  } catch {
    return null;
  }
}
