# PLAN — Réparer le tunnel de conversion (post-campagne L'Haïtien)

> Créé le 13/06/2026 après la 1re campagne influ (@lhaitien_off).
> Objectif : augmenter le taux visiteur → inscrit → paiement. À coder par Joseph.

## Contexte chiffré (ce qui a motivé ce plan)

Campagne organique L'Haïtien (Reel IG + 3+3 stories avec **link sticker déjà posé**) :

```
2 064 vues → 1 044 comptes touchés → 17 visiteurs site (24h) → 9 sur /bac → 2 sur /register → 0 inscrit
```

**Enseignements :**
1. Le clic vient surtout des **stories** (Fil = 56% des vues mais non cliquable par nature). Le link sticker a fonctionné proportionnellement — le souci est le **volume cliquable** + l'**offre**, pas le placement.
2. Fuite `/bac → /register` : 9 → 2 (**-78%**). Les gens regardent puis partent sans entrer dans le tunnel.
3. Fuite `/register → inscrit` : 2 → 0 (n trop petit pour conclure, mais le formulaire reste lourd sur mobile).
4. **82% du trafic = mobile / iOS.** Toute friction de saisie coûte cher.

Ce plan attaque les fuites 2 et 3 (le produit/landing). La partie créa vidéo + canal payant est gérée à part (Théo).

---

## ITEM 1 — 🥇 Google Sign-In (le plus gros gain de conversion register)

**Pourquoi :** sur mobile, demander email + mot de passe + confirmation + CGU = mur. Une connexion Google en 1 tap supprime la friction n°1 de l'inscription. Aujourd'hui : **aucun login social** dans le code (vérifié).

**Impact attendu :** +30 à +60% de complétion sur l'étape register (benchmark social login mobile).

### Pré-requis console (avant le code)
1. **Firebase Console → Authentication → Sign-in method → activer Google.**
2. **Authentication → Settings → Authorized domains** : vérifier que `edukaraib.com` ET `www.edukaraib.com` sont présents (sinon le popup/redirect échoue en prod).

### Code

**a) `frontend/lib/googleAuth.js`** (nouveau fichier — helper réutilisable Login + Register)

```js
import {
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
} from 'firebase/auth';
import { auth } from './firebase';

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// Mobile : popup souvent bloquée → redirect. Desktop : popup.
const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export async function signInWithGoogle() {
  if (isMobile()) {
    await signInWithRedirect(auth, provider); // ne retourne pas (redirige)
    return null;
  }
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

// À appeler au montage de Login/Register pour récupérer l'utilisateur après redirect mobile
export async function consumeGoogleRedirect() {
  try {
    const res = await getRedirectResult(auth);
    return res?.user || null;
  } catch {
    return null;
  }
}
```

**b) `frontend/utils/ensureUserDoc.js`** (nouveau — crée le doc Firestore si absent, mutualisé)

```js
import { db } from '../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import fetchWithAuth from './fetchWithAuth';

// Crée le doc users/{uid} si le compte Google est nouveau. role par défaut = 'student'.
// Retourne { role, isNew }.
export async function ensureUserDoc(user, { defaultRole = 'student' } = {}) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return { role: snap.data().role || defaultRole, isNew: false };

  const [firstName, ...rest] = (user.displayName || '').trim().split(' ');
  const baseData = {
    uid: user.uid,
    email: user.email,
    role: defaultRole,
    firstName: firstName || '',
    lastName: rest.join(' ') || '',
    fullName: user.displayName || '',
    avatarUrl: user.photoURL || '',
    city: 'En ligne',
    createdAt: serverTimestamp(),
  };
  await setDoc(ref, baseData);

  // Coupon de bienvenue -5€ (élève/parent uniquement) — même logique que Register.jsx
  if (defaultRole === 'student' || defaultRole === 'parent') {
    fetchWithAuth('/api/create-welcome-coupon', {
      method: 'POST',
      body: JSON.stringify({ uid: user.uid, email: user.email, fullName: user.displayName || '' }),
    }).catch(() => {});
  }
  return { role: defaultRole, isNew: true };
}
```

**c) Bouton dans `Register.jsx`** (au-dessus du `<form>`, visible aussi en express)

```jsx
import { signInWithGoogle, consumeGoogleRedirect } from '../lib/googleAuth';
import { ensureUserDoc } from '../utils/ensureUserDoc';
import { getCampaignSubject } from '../lib/bacCampaign';

// Redirige selon le tunnel après auth Google
const finishGoogle = async (user) => {
  if (!user) return;
  await ensureUserDoc(user, { defaultRole: 'student' });
  const subj = getCampaignSubject();
  if (isExpress) navigate(subj ? `/search?subject=${encodeURIComponent(subj)}` : '/search');
  else navigate('/dashboard-eleve');
};

useEffect(() => { consumeGoogleRedirect().then(finishGoogle); }, []); // retour redirect mobile

const handleGoogle = async () => {
  try { const u = await signInWithGoogle(); if (u) await finishGoogle(u); }
  catch (e) { alert('Connexion Google impossible : ' + (e?.message || '')); }
};
```

Bouton (style cohérent Tailwind, à placer en haut de la carte) :
```jsx
<button type="button" onClick={handleGoogle}
  className="w-full flex items-center justify-center gap-2 border border-gray-300 rounded-lg py-2.5 font-semibold text-gray-700 hover:bg-gray-50 transition mb-4">
  <img src="/google-icon.svg" alt="" className="h-5 w-5" /> Continuer avec Google
</button>
<div className="flex items-center gap-3 mb-4 text-xs text-gray-400">
  <span className="flex-1 h-px bg-gray-200" /> ou par email <span className="flex-1 h-px bg-gray-200" />
</div>
```
(ajouter `public/google-icon.svg` — logo Google officiel.)

**d) Même bouton dans `Login.jsx`** (réutilise `signInWithGoogle` + `ensureUserDoc`, puis redirige par rôle comme le fait déjà `handleLogin`).

### Acceptation
- [ ] Sur desktop : popup Google → si nouveau compte, doc Firestore créé, redirigé vers `/search?subject=...` en express.
- [ ] Sur mobile iOS : redirect Google → retour sur le site → connecté → même redirection.
- [ ] Un compte Google existant ne recrée pas de doc (pas de coupon en double).
- [ ] Le code promo campagne (localStorage) survit à la connexion Google → bien appliqué au checkout.

---

## ITEM 2 — Montrer les profs AVANT de demander l'inscription

**Pourquoi :** aujourd'hui sur `/bac` : pack → matière → **register** → profs. La preuve (de vrais profs existent) arrive APRÈS la friction. `/search` est déjà **public** (vérifié, pas de guard) et l'auth n'est exigée qu'à l'action « contacter le prof ». On inverse : valeur d'abord, barrière au dernier moment.

### Code
Dans `frontend/pages/Bac.jsx`, fonction `chooseSubject` (≈ ligne 160) — supprimer le détour register :

```js
const chooseSubject = (subject) => {
  saveCampaign({ subject });
  // Toujours montrer les profs d'abord, connecté ou non.
  navigate(`/search?subject=${encodeURIComponent(subject)}`);
};
```

Puis, dans `Search.jsx`, à l'action « contacter / réserver » (≈ ligne 584, le `if (auth.currentUser)`) : si non connecté, rediriger vers `/register?express=1` (le contexte campagne + matière est déjà en localStorage, il reviendra sur le bon prof). Vérifier que le `else` envoie bien vers register express et pas vers `/login`.

### Acceptation
- [ ] Depuis `/bac`, choisir une matière sans être connecté affiche directement la liste des profs.
- [ ] L'inscription n'est demandée qu'au clic « contacter le prof ».
- [ ] Après inscription (email OU Google), l'élève retombe sur la recherche / le prof voulu.

---

## ITEM 3 — Barre CTA collante sur mobile (/bac)

**Pourquoi :** fuite `/bac → register` 9→2 (-78%). Beaucoup scrollent et partent sans jamais cliquer. Un CTA fixe en bas d'écran maintient l'action visible en permanence (82% mobile).

### Code
Dans `Bac.jsx`, juste avant `<Footer />`, ajouter une barre fixe **mobile only** :

```jsx
{/* CTA collant mobile */}
<div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
  <button onClick={scrollToPacks}
    className="w-full bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold py-3 rounded-xl">
    Choisir mon pack {promoCode ? `· code ${promoCode}` : ''}
  </button>
</div>
<div className="md:hidden h-20" /> {/* spacer pour ne pas masquer le footer */}
```

### Acceptation
- [ ] Sur mobile, le bouton reste visible au scroll et ramène aux packs.
- [ ] Sur desktop, rien ne change (la barre est masquée).
- [ ] Le footer reste accessible (spacer en place).

---

## Ordre recommandé & effort

| # | Item | Effort | Gain attendu |
|---|------|--------|--------------|
| 1 | Google Sign-In | ~1-2 h | 🟢🟢🟢 (le plus rentable) |
| 2 | Profs avant inscription | ~30 min | 🟢🟢 |
| 3 | CTA collant mobile | ~15 min | 🟢 |

Coder dans l'ordre 1 → 2 → 3. Tester chaque item sur mobile réel (pas seulement desktop) avant commit, vu que 82% du trafic est mobile.

## Hors-scope de ce plan (géré ailleurs)
- **Créa vidéo + canal payant** (Meta Ads avec la vidéo en créa cliquable, droits Art 10) → Théo.
- **Fenêtre rattrapage (7-11 juillet)** = moment d'intention d'achat max → recharger stories + budget Meta À CE moment, une fois les items 1-3 livrés.
