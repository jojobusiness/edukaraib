// Navigateur intégré à une appli (TikTok, Instagram, Facebook…) : Google y refuse
// la connexion (« disallowed_useragent »). On n'y propose donc pas le bouton :
// une erreur en pleine inscription, c'est un visiteur perdu (02/11/2026).
const INTEGRES = /musical_ly|BytedanceWebview|TikTok|Instagram|FBAN|FBAV|FB_IAB|Snapchat|Line\/|LinkedInApp|Twitter/i;

export function navigateurIntegre(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  return INTEGRES.test(String(ua));
}
