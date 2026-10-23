# PLAN — Audit de sécurité complet et corrections · 23/10/2026

> **Demande de Joseph (23/10)** : « fait tout […] arrête de me dire que des choses importantes pour la sécurité sont pas encore faites […] fait un travail COMPLET ».
> **Méthode** : tout a été relu, pas seulement ce qui était déjà repéré :
> - chaque API (41 fichiers) : qui a le droit d'agir sur QUELLE ressource ;
> - chaque collection Firestore et chaque dossier Storage ;
> - chaque champ que le serveur croit sur parole.
>
> Suite de `PLAN_VERROU_DONNEES_23-10-2026.md` et `PLAN_VERROU_COURS_23-10-2026.md`.

## 1. Ce que l'audit a trouvé, et ce qui est corrigé

### 💸 Argent
| Faille | Correctif |
|---|---|
| **Prix forgé.** `create-checkout-session` prenait le tarif dans le COURS, que crée la famille. Avec `price_per_hour = 1`, elle payait 1 € et le prof touchait 1 €. | Tarif lu dans le profil du prof (`api/_tarifs.mjs`), même calcul que sa page. Sans tarif : refus, aucun montant inventé. `pay/diag.mjs` est aligné. |
| **Pack étiré.** Un seul paiement de pack marquait payés tous les cours rangés sous la même clé, sans limite. | Plafond : 7 cours pour un pack de 5 h, 12 pour un pack de 10 h. Au-delà, `PACK_TROP_DE_COURS`. |
| **« Heure offerte » forgée.** `is_free_hour` posé sur un cours simple : la famille n'était jamais invitée à payer. | Règle : gratuit seulement dans un pack ou un essai proposé par le prof, et jamais ajouté après coup. Cloud Function : nombre d'heures offertes limité au bonus du pack. |
| **Essai gratuit illimité.** « Déjà utilisé » n'était qu'un drapeau dans le navigateur. | La Cloud Function retire la gratuité de tout 2ᵉ essai chez le même prof. La règle exige que le prof propose l'essai. `trialUsedWith` ne peut plus que grandir. |
| **Code « premier avis » réutilisable.** Il était vérifié dans le navigateur et jamais marqué comme utilisé. | La Cloud Function le vérifie et le passe à `used`. `promo_codes` n'est plus lisible que par son propriétaire. |
| **Versement avant le cours.** Le prof passait le cours en « terminé » et déclenchait aussitôt son virement. | `trigger-payout` refuse avant la fin prévue du cours (`api/_coursHoraire.mjs`). L'horaire d'un cours est figé (règle), sauf pour réactiver une demande refusée. La durée ne se modifie plus. |

### 🔒 Comptes
| Faille | Correctif |
|---|---|
| Un compte pouvait lui-même :<br>- se débannir (`disabled`) ;<br>- se déclarer « Stripe prêt » ;<br>- effacer son parrainage pour le rejouer ;<br>- s'attribuer des filleuls ou un code promo ;<br>- prendre le code parrain d'un autre ;<br>- se déclarer « e-mail vérifié ». | Ces champs ne s'écrivent que par le serveur ou l'admin. Le formulaire du profil, qui renvoie la fiche entière, reste accepté. |
| `delete-account` :<br>- supprimait le cours **collectif** des autres élèves ;<br>- effaçait les conversations, contre la conservation de 12 mois promise ;<br>- laissait les fiches enfants orphelines ;<br>- laissait un prof supprimer son compte Stripe avec de l'argent en attente. | Le compte est retiré du cours collectif, sans le supprimer. Les conversations sont masquées. Les fiches enfants, favoris, diplômes et vidéo sont supprimés. La suppression est refusée tant qu'un paiement est en cours, avec un message clair. |

### ✉️ Relais d'e-mails
| Faille | Correctif |
|---|---|
| N'importe quel compte créait une notification pour n'importe quel inscrit. La Cloud Function envoyait par mail son titre et son texte **libres**, sans échappement HTML. | Les types autorisés sont fixés et le texte est borné. Les types créés depuis le navigateur reçoivent un **texte fixe**. L'annonce est réservée à l'admin. Tout est échappé. |

### ⭐ Avis
| Faille | Correctif |
|---|---|
| N'importe quel compte notait n'importe quel prof. | Un avis par compte et par cours terminé dont on fait partie (identifiant `{cours}_{compte}`), note de 1 à 5. |

### 🎥 Visio
| Faille | Correctif |
|---|---|
| Tout compte connecté recevait un jeton JaaS valable pour toutes les salles. Le prof n'était jamais modérateur (bug de recherche du cours). Les parents d'un enfant inscrit étaient refusés. | Jeton seulement pour les comptes du cours, avec un lien visio valide. Le prof est modérateur. Les parents passent par `acces`. |

### 📁 Storage (règles posées dans la console, jamais versionnées)
| Faille | Correctif |
|---|---|
| `allow read, write: if request.auth != null` sur tout : n'importe quel compte listait, téléchargeait, remplaçait ou supprimait les justificatifs de remboursement, les diplômes, les pièces jointes du chat et les documents de cours. | `storage.rules` dans le dépôt, un propriétaire par dossier, tailles et types limités. |

## 2. Vérifié et déjà correct (rien à changer)
- `refund` (admin seulement), `refund-request` (payeur), `cancel-subscription` (payeur), `session-status`, `pay/diag` (payeur ou parent).
- `trigger-payout` (prof du cours), `admin-*` (`requireAdmin`), crons (`CRON_SECRET`), webhook (signature Stripe), `analytics-drain` (signature Vercel).
- `connect-*` et `partner-*` (compte lui-même), `create-welcome-coupon` (un par compte), `create-promo-first-review` (cours terminé et lien vérifié).

## 3. Choix assumé
`participantsMap.*.is_paid` reste dans le cours, au lieu d'une sous-collection. La règle `paiementNonForge` empêche tout participant de le passer à `true`, et le versement au prof exige un vrai paiement `held`. Déplacer la donnée, c'est migrer les 6 écrans et le webhook pour un gain de sécurité nul ; le risque de casser le paiement, lui, est réel.

## 4. Preuve
- Émulateur (`npm run test:regles`) : Firestore et Storage, intrus contre écrans légitimes. Chaque bloc échoue sur les règles d'avant.
- Vitest : la fraude au prix (cours à 1 €/h facturé 25 €), les tarifs, les horaires et les gratuités.
- Prod :
  - `scripts/essai-reservation-prod.mjs` : parcours réel, plus les fraudes à la gratuité, l'avis, la notification et les champs de compte ;
  - `scripts/diag-regles-donnees.mjs` : complété avec le Storage, les avis, les notifications et les codes promo.

## 5. Résultat (23/10/2026, ~20 h)
- ✅ **Tout est livré et vérifié en production.**
  - Commit `48b5ae9e` et ses suivis.
  - Règles Firestore et Storage déployées.
  - Cloud Functions `onLessonWrittenSync` (gratuités) et `onNotificationCreated` (textes fixes) déployées.
- **Parcours réel contre la prod** (`scripts/essai-reservation-prod.mjs`) : tout passe.
  - Réservation, groupe, doublon.
  - Fraudes refusées : payé forgé, heure offerte hors pack, enfant d'autrui, faux avis, notification piège, annonce admin, déban, Stripe prêt.
  - 2ᵉ essai gratuit : rendu payant à 30 € par le serveur.
  - 2ᵉ heure offerte d'un pack 5 h : retirée.
- **Diagnostic prod** (`scripts/diag-regles-donnees.mjs`) : 0 faille. Côté Storage, sans compte comme avec un compte jetable, tout est refusé : justificatifs, chat, documents de cours. Photos et diplômes publics : 200.
- `scripts/diag-regles-paiements.mjs` : 0 faille.
- **Incidents pendant la livraison, corrigés :**
  - au premier essai, la notification piège est passée, car le propagation des règles prend jusqu'à 1 min. Revérifiée à froid : refusée ;
  - un créneau public orphelin a été recréé par une exécution en retard de la Cloud Function. Elle revérifie maintenant que le cours existe avant d'écrire, et l'orphelin est supprimé.
- Émulateur : 48 tests Firestore et 10 Storage. Sur les règles d'avant, 8 tests Storage sur 10 échouent.
- Vitest : 287 tests, lint 0 erreur, build OK.
