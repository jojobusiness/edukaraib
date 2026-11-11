# Index des plans EduKaraib — relevé du 03/11/2026

> Relevé fait plan par plan, contre le code et l'historique git (pas sur la foi des plans).
> À tenir à jour : un plan livré prend une ligne « ✅ », un plan écarté une ligne « ⛔ ».

## ✅ Faits (preuve dans le code ou en production)
| Plan | Livré | Preuve |
|---|---|---|
| PLAN_TUNNEL_CONVERSION (13/06) | Google, profs avant inscription, barre collante mobile | `lib/googleAuth.js`, `CampaignLanding.jsx` |
| PLAN_LANDING_BAC | `/bac` en ligne | route `/bac` |
| PLAN_BAC_PROFS_FIRST (18/06) | Profs avant les prix sur `/bac` | section `profs-dispo` |
| PLAN_HARMONISATION_TECH (01/08) | Lint et tests | `npm test` |
| PLAN_LANDING_RENTREE (20/08) | `/rentree` | commit `16db14c2` ; ⚠️ contenu remplacé le 02/11 par la rentrée de novembre |
| PLAN_MODIFS_RENTREE_26-08 | 5 modifs | commit `01812783` |
| PLAN_pieces_jointes_chat (29/08) | Photos, vidéos, vocaux | `components/chat/` |
| PLAN_BAC_ORPHELINS_ET_ASSOS (14/09) | Tickets 1, 4 et 7 | commits `101ab298`, `31888f9e`, `a395852a` |
| PLAN_ATTRIBUTION (20/09) | Source de chaque inscrit | `api/_acquisition.mjs` |
| PLAN_PROF_INVISIBLE (25/09) | Bandeau d'état du prof | `EtatProfilProf.jsx` |
| PLAN_SAVOIR_QUI_REVIENT (02/10) | Dernière venue | `lib/derniereVenue.js` |
| PLAN_PAGE_METHODE (15/10) | `/methode` + alerte lead | route `/methode` |
| PLAN_PAGES_CHATGPT (11/11) | 12 guides prérendus, /llms.txt, pages locales lisibles sans JS | commit `83502489`, vérifié en prod ; mesure ChatGPT 18/11 et 25/11 |
| PLAN_MESSAGES_SECRET_CORRESPONDANCES (15/10) | Alerte sans extrait, onglet Leads | commit `cf8e0e3a` |
| PLAN_VERROU_DONNEES, PLAN_VERROU_COURS, PLAN_SECURITE_COMPLETE (23/10) | Sécurité | scripts `diag-regles-*`, `essai-reservation-prod` |
| PLAN_DERNIERE_CONNEXION (23/10) | Colonne admin + « Vu » | commit `fe9eb1db` |
| PLAN_CREATEURS (02/11) | Code créateur, barème, lien court | `essai-createur-prod.mjs` ; ⚠️ crédit et virement non prouvés sans vrai paiement |

## 🔨 Code — appliqués le 03/11
| Plan | État |
|---|---|
| PLAN_SUIVI_EMAILS (27/10) | ✅ Appliqué le 03/11 (commit 29a22e21) : « reçu » prouvé en prod ; « cliqué » à voir au premier clic réel. |
| PLAN_ANALYTICS_DRAIN_FIX | ✅ Remplacé le 03/11 par `api/visite.mjs` : prouvé avec une vraie visite de /rentree. |

## 🧑 À faire par Joseph (hors code)
| Plan | Où |
|---|---|
| Groupes Facebook de parents (16/10) | `EduKarib/01_MARKETING/campagnes/PLAN_GROUPES_FACEBOOK_PARENTS_16-10-2026.md` : collecter les groupes, aucune trace d'exécution |
| Programme Grandes Écoles (02/08) | `EduKarib/00_STRATEGIE/PLAN_EXCELLENCE_ET_CONFERENCES.md` : jamais lancé. La partie conférences est écartée (CLOS 14/09). |
| Associations de parents (14/09) | Envoyé (≈ 300 mails arrivés), 0 réponse notée. Le code partenaire est prêt. |

## ⛔ Écartés ou absorbés
- Conférence aux associations (Joseph, 14/09).
- Tickets 5 et 6 du plan BAC_ORPHELINS (absorbés par le ticket 7, conférence écartée).
- Mise en relation des familles par Joseph (Joseph, 02/11).

## ✏️ Erreurs corrigées dans les plans le 03/11
1. « `users` est en lecture publique » (ATTRIBUTION, SAVOIR_QUI_REVIENT, commentaire de `api/_acquisition.mjs`) : faux depuis le 23/10, `users` est privé.
2. « Règles Storage hors dépôt » (pieces_jointes_chat) : versionnées dans `storage.rules` depuis le 23/10.
3. Ticket 2 de BAC_ORPHELINS (générateur de code admin, IBAN) : obsolète. Les partenaires s'inscrivent seuls sur `/partenaire`, et les virements passent par Stripe Connect.
4. Seuil « ≥ 8 profs réservables » (BAC_ORPHELINS, ticket 3) : le compteur gonflait (semaines passées comptées). Corrigé le 02/11 : 2 réservables au 02/11.
5. PROF_INVISIBLE : `nbCreneaux` comptait les semaines passées jusqu'au 02/11.
6. SUIVI_EMAILS : numéros de ligne périmés. Les réglages Resend se font par l'API, sans clic de Joseph. `dernierMail` doit être protégé en écriture.
