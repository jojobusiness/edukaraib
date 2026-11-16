# PLAN — Joseph ne reçoit pas les alertes « nouveau message » d'EduKaraib

**Écrit le lundi 16/11/2026.** À exécuter depuis ce dépôt.
Déclencheur : une prof inscrite le 16/11 écrit à l'admin à 10 h 52 (heure de Paris) au sujet d'un bug. Joseph : *« pourquoi je reçois pas de mail ??? »*

## 1. Ce qui s'est passé (vérifié dans Resend et Gmail le 16/11)
À 10 h 52, deux mails sont partis :

| Mail | Envoyé par | À | Statut Resend |
|---|---|---|---|
| « 💬 Nouveau message de … » (alerte admin) | `functions/index.js` → `onMessageCreated` | `ADMIN_INBOX` = **edukaraib@gmail.com** (`functions/.env`) | ✅ **delivered**. Il est dans la boîte de réception Gmail, **non lu** |
| « Nouveau message sur EduKaraib » (avis au destinataire) | `notifyEmailUser` | l'adresse du compte admin, **adm…@edukaraib.com** | 🔴 **suppressed** : Resend refuse d'envoyer à cette adresse |

**Il y a donc deux causes, et le code d'alerte n'est pas en cause :**
1. **L'alerte va sur un Gmail que Joseph ne lit plus.** Son courrier business est sur Zoho depuis novembre.
2. **L'adresse du compte admin (`adm…@edukaraib.com`) est sur la liste de blocage de Resend.** Resend y met une adresse après un rejet définitif (boîte qui n'existe pas) ou un signalement en indésirable. Resend n'enverra plus rien à cette adresse tant qu'elle n'est pas retirée de la liste.

## 2. Ce qu'il faut faire

**DÉCIDÉ par Joseph (16/11) : `contact@edukaraib.com` pour tout.** Toutes les alertes admin, et l'adresse du compte admin elle-même, passent sur cette adresse. Plus rien ne doit partir vers edukaraib@gmail.com ni vers `adm…@edukaraib.com`.

1. **`functions/.env`** : `ADMIN_INBOX=contact@edukaraib.com`, puis `firebase deploy --only functions:onMessageCreated` (et toute autre fonction qui lit `ADMIN_INBOX_EMAIL`). Chercher aussi les autres envois vers l'admin qui codent l'adresse en dur : `grep -rn "edukaraib@gmail.com" api functions frontend scripts`. Les faire tous lire la même variable, côté Vercel comme côté Functions.
2. **L'adresse du compte admin** :
   - changer l'adresse du compte admin en `contact@edukaraib.com`, dans Firebase Auth ET dans `users/{uid}.email` ; vérifier que `isAdminUser` ne dépend pas de l'adresse ;
   - vérifier dans Resend que `contact@edukaraib.com` n'est **pas** dans la liste de blocage (Suppressions). Si elle y est, la retirer ;
   - `adm…@edukaraib.com` peut rester bloquée, puisque plus rien n'y part.
3. **Filet de sécurité** : `api/leads-sans-reponse-cron.mjs` existe déjà. Vérifier qu'il couvre aussi « message à l'admin sans réponse depuis 2 h ». Si ce n'est pas le cas, l'ajouter, avec un 2ᵉ mail de rappel vers la même adresse Zoho.
4. **En attendant le déploiement (aujourd'hui, sans code)** : dans Gmail `edukaraib@gmail.com` → Paramètres → Transfert, faire suivre tout ce qui vient de `notifications@edukaraib.com` vers `contact@edukaraib.com`.

## 3. Test (Claude)
- Depuis un compte élève de test, envoyer un message à l'admin.
- Dans Resend, les deux mails doivent être `delivered`, et aucun ne doit être `suppressed`.
- Le mail doit apparaître dans la boîte Zoho, et pas dans les indésirables.
- Supprimer ensuite le compte de test (bouton Supprimer de l'admin).

## RÉSULTAT
- Adresse choisie : `contact@edukaraib.com` (Joseph, 16/11) · **déployé le 16/11/2026** (Functions + commit `c6eab328`)
- **Fait** :
  - `ADMIN_INBOX=contact@edukaraib.com` dans `functions/.env`, valeur par défaut dans `functions/index.js`, variable posée sur Vercel (Production) ;
  - `api/_adminInbox.mjs` est la source unique côté API : cron, demandes de remboursement, partenaires ;
  - FAQ corrigée (elle affichait le Gmail) ; un test interdit tout retour de `edukaraib@gmail.com` dans `api/`, `functions/index.js` et la FAQ ;
  - compte admin passé sur `contact@edukaraib.com` (Firebase Auth + `users`), connexion par mot de passe inchangée. `isAdminUser` lit le rôle, pas l'adresse ;
  - filet de sécurité : `onMessageCreated` tient `suivi_messages_admin/{expéditeur}` (heure du 1er message sans réponse, aucun contenu), et le cron horaire envoie **un** rappel à 2 h. Une réponse de l'admin dans le chat clôt le suivi.
- **Resend** : `contact@` n'est pas bloquée (livrée les 02/11 et 16/11).
- **Test en prod (16/11, 11 h 55)** : un élève de test écrit à l'admin. Statut Resend des 3 mails vers `contact@` : alerte `delivered`, avis destinataire `delivered`, rappel 2 h (heure simulée) `delivered`. `repondu_at` est bien posé après la réponse de l'admin, puis le compte de test est supprimé par `/api/delete-account`.
- **Reste à Joseph** : vérifier que les 3 mails « Test Alerte Admin » sont dans la boîte Zoho et pas dans les indésirables. Le transfert Gmail du § 2.4 devient inutile.
