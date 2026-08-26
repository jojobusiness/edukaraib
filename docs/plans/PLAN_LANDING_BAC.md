# PLAN — Landing `/bac` (campagne vidéo L'Haïtien)

> Objectif : convertir le trafic de la vidéo bac de L'Haïtien en réservations, avec un tunnel court qui **dirige vers les profs** (ce sont eux qui gèrent le créneau, pas Joseph). Réutilise au maximum l'existant (packs, messagerie, Stripe). À coder par Joseph.

---

## 1. Contexte & timing

- Vidéo L'Haïtien : **sort cette semaine**, code promo influenceur déjà créé.
- Deux temps à exploiter (L'Haïtien fera les deux angles) :
  - **Maintenant** → "Dernière ligne droite" (révision avant les écrits mi-juin)
  - **Début juillet** → **"SOS Rattrapage"** (résultats ~4 juillet, rattrapage ~7-10 juillet) ← **le créneau le plus rentable de l'année**, intention d'achat max.
- La même page sert les deux : on change juste le **hero + le compte à rebours** en juillet.

---

## 2. Le tunnel — 3 étapes (décision Joseph : self-serve dirigé vers les profs)

> ❌ Pas de concierge (marché guyanais trop lourd à gérer à la main). ✅ On décharge la gestion du créneau sur les profs — leur affiliation les incite à répondre vite (le prof réactif gagne le client = son cash).

1. **Choisir un pack** (sur la landing)
2. **Inscription express** (email + mdp + prénom — rôle élève/parent par défaut)
3. **Choisir son prof → le contacter avec un message pré-rempli** (pack + matière) → ils calent un créneau ensemble → **le prof confirme la réservation → l'élève paie** (Klarna 3x, code L'Haïtien auto-appliqué)

Le paiement = le tunnel Stripe existant, simplement **précédé du contact prof** au lieu du BookingModal à l'aveugle.

---

## 3. L'offre (rebranding des packs existants — AUCUN nouveau produit)

| Carte | Produit réel | Angle |
|---|---|---|
| SOS 1 matière | cours solo | "Une matière qui coince" |
| ⭐ **Pack Intensif 5h** *(mis en avant)* | pack 5h | "La dernière ligne droite / rattrapage" |
| Pack Prépa 10h | pack 10h | "Je sécurise mon bac" |

Afficher sur chaque carte : prix, **"payable en 3x sans frais (Klarna)"**, bonus pack existant (5h→+1h, 10h→+2h).

---

## 4. Structure de la page (mobile-first — trafic TikTok = 100% mobile)

1. **Hero** : titre orienté résultat + sous-titre + 1 CTA + **compte à rebours**
2. **Les 3 cartes d'offre** (Pack 5h "le plus choisi")
3. **Comment ça marche** : 3 étapes (choisis ton pack → inscris-toi en 30s → contacte ton prof)
4. **Pourquoi EduKaraib** : profs caribéens vérifiés · visio possible · Klarna 3x · satisfait ou remboursé
5. **1-2 témoignages**
6. **FAQ courte** (3 questions)
7. **CTA final + rareté** ("X profs dispo cette semaine")

---

## 5. Leviers de conversion (à intégrer dans la page)

1. **1 seul CTA** répété ("Choisir mon pack")
2. **Compte à rebours** vers résultats (~4/07) puis rattrapage (~7/07)
3. **Rareté** : "X profs dispo cette semaine" (chiffre manuel au début)
4. **Code L'Haïtien pré-rempli via l'URL** (`/bac?code=XXX`) → l'élève ne tape rien
5. **Garantie** : "1ère séance satisfait ou remboursé" (le remboursement self-service existe déjà → risque réel quasi nul)
6. **Klarna 3x** affiché sur chaque carte (déjà actif)

---

## 6. Points techniques (à coder)

| # | Tâche | Où / Réutilise |
|---|---|---|
| T1 | Créer la page `Bac.jsx` + route `/bac` (alias `/rattrapage`) | `frontend/pages/Bac.jsx` + `App.jsx` |
| T2 | `useSEO({ title:"Soutien scolaire Bac — Guyane & Antilles", ... })` → **page indexée** (recherche "cours bac guyane" récurrente) | hook `useSEO` existant |
| T3 | **Inscription express** : variante allégée du Register (email + mdp + prénom, rôle student/parent). ⚠️ Le Register actuel est lourd (villes/tél/Stripe = profs) → faire un chemin minimal pour les élèves venant de `/bac` | `Register.jsx` (variante / param) |
| T4 | **Survie du code promo** : capter `?code=` à l'arrivée → `localStorage` → injecter en `couponCode` au checkout | `PayButton` (`couponCode`) + `create-checkout-session.mjs` (déjà gère les codes) |
| T5 | **Porter l'intention "pack" jusqu'au prof** : pack choisi stocké (`localStorage`/state) → après inscription, rediriger vers la liste de profs bac | mécanique `packChoice`/`packKey` existante (`TeacherProfile`/`BookingModal`) |
| T6 | **Bouton "Contacter ce prof pour le Pack X"** avec **message pré-rempli** | messagerie interne (`Messages.jsx`/`ChatList`) ; fallback `mailto:` si besoin |
| T7 | Liste de profs "spécial bac" (filtrer matières clés : maths, philo, français, physique-chimie, SVT, SES, anglais, histoire-géo) | `Search` filtré |
| T8 | Test manuel **mobile** (`npm run dev`) avant livraison | — |

**Rappel règle CLAUDE.md** : un coupon ne réduit JAMAIS la part du prof, seulement `site_fee_cents`. Déjà géré côté `create-checkout-session.mjs` — ne rien casser.

---

## 7. Copy prêt à l'emploi

**Hero — version "révision" (maintenant) :**
> ### Bac 2026 : la dernière ligne droite se joue maintenant.
> Des profs caribéens, en visio ou près de chez toi. Réserve tes heures intensives, paie en 3x.
> **[ Choisir mon pack ]**  ⏳ J-X avant les écrits

**Hero — version "rattrapage" (juillet) :**
> ### Rattrapage du bac : 48h pour tout jouer. On t'aide à le décrocher.
> Un prof dispo cette semaine, sessions intensives, satisfait ou remboursé.
> **[ Choisir mon pack ]**  ⏳ Rattrapage dans X jours

**Message pré-rempli au prof (T6) :**
> Bonjour [Prénom prof], je suis intéressé(e) par le **[Pack Intensif 5h]** pour préparer le **bac/rattrapage en [matière]**. Quels créneaux avez-vous **cette semaine** ? Merci !

---

## 8. Pré-requis OPS (hors code — à faire en parallèle)

- **Confirmer dès cette semaine quels profs sont dispos la semaine du rattrapage (début juillet)** + sur quelles matières. La supply doit être prête avant la demande, sinon réputation cramée sur le meilleur créneau de l'année.
- Rappeler aux profs concernés : **répondre vite aux messages = gagner le client** (leur cash via l'affiliation).
- Donner à L'Haïtien : le **lien exact** (`edukaraib.com/bac?code=SONCODE`) + les **2 angles** (révision maintenant / rattrapage juillet) + le **-X€** de son code.

---

## 9. Définition de "terminé"

- [ ] `/bac` accessible, indexée, responsive mobile
- [ ] Inscription express fonctionnelle (élève créé en < 30s)
- [ ] Code `?code=` survit jusqu'au paiement (testé bout en bout)
- [ ] Bouton "Contacter le prof" ouvre un message pré-rempli avec le bon pack
- [ ] Paiement Klarna 3x OK sur un pack
- [ ] Lien transmis à L'Haïtien
