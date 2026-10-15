# PLAN — Alerte lead et relevé des messages : se mettre en règle avec le secret des correspondances · 15/10/2026

> **Origine** : Joseph, le 15/10 : *« normalement je ne suis pas censé lire ça »*, puis il a demandé une analyse juridique. L'analyse lui donne raison.
> **Correctif de** `5d33301f` (alerte « 🔥 Nouveau lead » + `diag-messages` + CGU 7.2 bis), en ligne depuis le 15/10 à 10 h 34.
> ⚖️ Analyse faite par Claude à partir des textes. **Ce n'est pas l'avis d'un avocat inscrit.** Pour un avis opposable : avocat en droit du numérique, ou la permanence juridique du Pépite.

## 1. Les textes

| Texte | Ce qu'il dit | Conséquence pour EduKaraib |
|---|---|---|
| **CPCE art. L32-3, II** (version en vigueur depuis le 02/07/2025) | Les **fournisseurs de services de communication au public en ligne permettant à leurs utilisateurs d'échanger des correspondances**, et **leur personnel**, respectent le secret des correspondances. Le secret couvre **le contenu, l'identité des correspondants**, l'intitulé et les pièces jointes. | La messagerie élève ↔ prof est visée. Joseph est le « personnel ». |
| **L32-3, III** | Seule exception : un **traitement automatisé** pour afficher, trier ou acheminer les messages, ou pour détecter le spam et les programmes malveillants. | Aucune exception pour une **lecture humaine** du contenu. |
| **L32-3, IV** | Un traitement automatisé à des fins **publicitaires, statistiques ou d'amélioration du service** est interdit sans le **consentement exprès** de l'utilisateur. Ce consentement est spécifique à chaque traitement et se renouvelle **au moins une fois par an**. | `diag-messages`, qui calcule des statistiques **à partir des messages**, tombe dedans. Une ligne dans les CGU n'est pas un consentement exprès. |
| **Code pénal art. 226-15, al. 2** | Intercepter, détourner, **utiliser** ou divulguer de mauvaise foi des correspondances électroniques : **1 an et 45 000 €**. | Le risque pénal. La « mauvaise foi » se discute, mais lire des messages de mineurs dans sa boîte mail n'est pas une position à défendre. |
| **RGPD art. 5-1-c et art. 8** + loi Informatique et Libertés, **art. 45** | Minimisation des données. Avant 15 ans, le consentement doit être donné **conjointement avec un parent**. | Une partie des expéditeurs sont mineurs : le consentement exprès devient presque impossible à recueillir proprement. |

**Conclusion :** l'**extrait du message** dans l'alerte n'a aucune base solide. La phrase ajoutée aux CGU ne la crée pas : elle n'est ni exprès, ni annuelle, ni valable pour un moins de 15 ans. **À retirer.**

## 2. Ce qui reste légal et suffit au besoin de Joseph

Le besoin réel n'est pas de **lire**, c'est de **savoir qu'une mise en relation a été demandée et si le prof y a donné suite**.

➜ **Créer un objet distinct de la correspondance : la « demande de mise en relation ».** C'est un événement du service, comme une réservation, enregistré quand l'élève clique sur « Écrire à un prof » ou « Demander ses disponibilités », ou envoie son 1ᵉʳ message. La plateforme est payée pour mettre en relation : suivre cette mise en relation relève de l'**exécution du contrat** (RGPD art. 6-1-b), pas de l'analyse de correspondances.

## 3. Les changements

1. **`functions/index.js`, alerte lead** : supprimer `extrait` et le bloc « « … » » (texte et HTML). Le mail garde le prénom et le rôle de l'élève, sa source, le prof et la matière **du profil du prof**, plus le lien vers le prof. Objet inchangé.
2. **Collection `demandes_contact/{eleveUid_profUid}`**, écrite **côté serveur** et interdite en écriture client dans `firestore.rules` : `eleve_uid`, `prof_uid`, `role`, `source`, `matiere_profil`, `created_at`, `prof_repondu_at` (posé automatiquement au 1ᵉʳ message du prof : c'est un traitement d'acheminement, couvert par le III), `alerte_sans_reponse_at`.
3. **`api/leads-sans-reponse-cron.mjs`** et **`scripts/diag-messages.mjs`** lisent **uniquement `demandes_contact`**, plus jamais la collection `messages`. Le relevé devient : demandes · % répondues · délai médian · par prof · demandes → réservations. **Aucun nombre de messages par conversation** : c'est une statistique sur la correspondance (IV).
   ➜ Si Joseph tient au nombre de messages, il faut un **consentement exprès séparé**, renouvelé chaque année, et refusé par défaut aux moins de 15 ans. Ma reco : **ne pas le faire**. « A répondu / n'a pas répondu, et en combien de temps » suffit pour relancer un prof.
4. **CGU 7.2 bis + politique de confidentialité** : remplacer la phrase sur la « consultation des échanges » par :
   - « EduKaraib ne lit pas vos messages. » ;
   - la plateforme enregistre les demandes de mise en relation (qui, quel professeur, quand, et si le professeur a répondu) pour suivre la qualité du service ;
   - **un bouton « Signaler »** : un message signalé par un utilisateur est transmis à EduKaraib **par cet utilisateur**, qui le montre lui-même. C'est la voie légale pour la sécurité des mineurs (cf. DSA art. 16 et 28).
5. **Bouton « Signaler ce message »** dans `Messages.jsx` : il crée `signalements/{id}` avec le message signalé et l'alerte va à `ADMIN_INBOX`. C'est le seul cas où Joseph voit un contenu.
6. **Purger les extraits déjà envoyés** : supprimer de la boîte `ADMIN_INBOX` les mails « 🔥 Nouveau lead » qui contiennent un extrait (entre le 15/10 10 h 34 et le déploiement du correctif).

## 4. Contrôles
- `npm test` + `npm --prefix functions run lint`, puis `firebase deploy --only functions`. ⚠️ Un push ne déploie **pas** les Cloud Functions : vérifier que le correctif est bien en ligne.
- Test : un élève de test écrit à un prof de test. Le mail arrive **sans aucun texte du message**, et `demandes_contact` contient 1 ligne. Le prof répond : `prof_repondu_at` est posé. `diag-messages` affiche la demande en « répondu ». Supprimer les comptes de test.
- `grep -n "extrait\|\.message\|\.text" functions/index.js api/leads-sans-reponse-cron.mjs scripts/diag-messages.mjs` : aucune lecture de contenu en dehors de la branche « destinataire = admin », qui existait déjà.
