/**
 * bacCampaign.js — survie du contexte campagne (landing /bac) à travers le tunnel :
 * landing → inscription express → recherche → profil prof → paiement.
 *
 * Tout passe par localStorage avec une expiration (14 jours) pour que le code
 * partenaire (ex: APEL973, LHATIEN81) soit auto-appliqué au paiement même si
 * l'élève paie plusieurs jours après avoir cliqué le lien TikTok.
 */

const CAMPAIGN_KEY = 'edk_bac_campaign';
const CHAT_DRAFT_KEY = 'edk_chat_draft';
// 90 jours depuis le 02/11/2026 (14 avant) : une famille peut suivre un créateur
// longtemps avant d'acheter. Même durée que la source d'acquisition.
const TTL_MS = 90 * 24 * 60 * 60 * 1000;
const UN_JOUR_MS = 24 * 60 * 60 * 1000;
const CODE_RE = /^[A-Z0-9-]{4,20}$/;

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

/** Code partenaire capté via /bac?code=XXX ou /rentree?code=XXX (ou null) */
export function getCampaignCode() {
  const c = readCampaign();
  const code = (c?.code || '').trim().toUpperCase();
  return /^[A-Z0-9-]{4,20}$/.test(code) ? code : null;
}

/** Code partenaire porté par une adresse : ?code=, ?partenaire= ou /p/CODE (ou null). */
export function codeDepuisUrl(search = '', pathname = '') {
  const p = new URLSearchParams(search);
  const court = String(pathname).match(/^\/p\/([^/]+)/)?.[1] || '';
  let brut = p.get('code') || p.get('partenaire') || court;
  try { brut = decodeURIComponent(brut); } catch { /* garde la valeur brute */ }
  const code = String(brut).trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/**
 * À appeler au démarrage, sur N'IMPORTE QUELLE page (02/11/2026) : avant, seuls
 * /bac et /rentree lisaient le code. Un lien vers l'accueil ou une fiche prof
 * ne donnait ni remise à la famille, ni reversement au créateur.
 * Compte aussi un clic par code et par 24 h. Ne lève jamais.
 */
export function capterCodePartenaire() {
  if (typeof window === 'undefined') return;
  try {
    const code = codeDepuisUrl(window.location.search, window.location.pathname);
    if (!code) return;
    saveCampaign({ code });
    const cle = `edk_clic_${code}`;
    if (Date.now() - Number(localStorage.getItem(cle) || 0) < UN_JOUR_MS) return;
    localStorage.setItem(cle, String(Date.now()));
    fetch('/api/partner-clic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* stockage bloqué : sans gravité */ }
}

/** Le code à poser sur ce compte, s'il n'y a pas déjà été posé (ou null). */
export function codeARattacher(uid) {
  const code = getCampaignCode();
  if (!code || !uid) return null;
  try { return localStorage.getItem(`edk_code_pose_${uid}`) === code ? null : code; } catch { return code; }
}
export function noterCodeRattache(uid, code) {
  try { localStorage.setItem(`edk_code_pose_${uid}`, code); } catch { /* sans gravité */ }
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
