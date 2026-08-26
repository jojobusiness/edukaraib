# TUTO — Installer le Pixel Meta sur EduKaraib

> Objectif : mesurer les conversions des pubs Meta (Facebook/Instagram) — inscriptions + achats.
> Sans pixel, tu repars aveugle comme sur la campagne influ (impossible de savoir ce que rapporte chaque euro).
> Stack : React 18 + Vite, déploiement Vercel. `index.html` à la racine, routing dans `frontend/App.jsx`.

---

## Étape 0 — Récupérer ton Pixel ID (Meta)

1. Va sur **business.facebook.com** → **Gestionnaire d'événements** (Events Manager).
2. **Connecter des sources de données** → **Web** → **Pixel Meta** → Continuer.
3. Nomme-le `EduKaraib` → tu obtiens un **ID de pixel** (15-16 chiffres). Note-le.
4. (Recommandé) Active **les correspondances avancées automatiques** (advanced matching) dans les paramètres du pixel.

Dans la suite, remplace `TON_PIXEL_ID` par ce numéro partout.

---

## Étape 1 — Code de base dans `index.html`

Ouvre `index.html` (racine) et colle ce bloc juste avant `</head>` :

```html
<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', 'TON_PIXEL_ID');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=TON_PIXEL_ID&ev=PageView&noscript=1"/></noscript>
<!-- End Meta Pixel Code -->
```

Ça envoie un `PageView` au chargement initial. Mais EduKaraib est une **SPA** (React Router) : les changements de page ne rechargent pas le HTML → il faut suivre les navigations (étape 2).

---

## Étape 2 — PageView sur changement de route (SPA)

Bonne nouvelle : il existe déjà un tracker Google Analytics dans `frontend/App.jsx` (`PageViewTracker`, ~ligne 82). On s'y greffe — pas besoin d'en créer un.

Dans `PageViewTracker`, à l'intérieur du `useEffect` qui se déclenche au changement de `location`, ajoute la ligne Meta à côté du `gtag` existant :

```js
// ... gtag existant ...
if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
  window.fbq('track', 'PageView');
}
```

Résultat : chaque navigation interne renvoie un `PageView` au pixel.

---

## Étape 3 — Événement INSCRIPTION (`CompleteRegistration`)

C'est l'événement clé pour optimiser les pubs (Meta apprend qui s'inscrit).

Dans `frontend/pages/Register.jsx`, fonction **`finalizeWithUser`**, juste après le `await setDoc(doc(db, 'users', activeUser.uid), baseData);` (succès de création du compte) :

```js
if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
  window.fbq('track', 'CompleteRegistration', { content_name: form.role }); // student / parent / teacher
}
```

> ⚠️ Pense à faire la même chose dans le flux **Google Sign-In** (helper `ensureUserDoc` du plan tunnel) quand `isNew === true`, pour ne pas perdre les inscriptions Google.

---

## Étape 4 — Événement ACHAT (`Purchase`) avec le montant réel

L'achat se confirme sur `frontend/pages/pay/Success.jsx` (route `/pay/success`), qui appelle déjà `/api/pay/session-status` et stocke la réponse dans `status`.

Ajoute un `useEffect` qui se déclenche **une seule fois** quand le paiement est confirmé :

```js
const purchaseFired = React.useRef(false);
useEffect(() => {
  const paid = status?.paid === true || status?.payment_status === 'paid';
  if (paid && !purchaseFired.current && typeof window !== 'undefined' && window.fbq) {
    purchaseFired.current = true;
    // session-status renvoie le montant en centimes — adapte le nom du champ si besoin
    const cents = Number(status?.amount_total ?? status?.amount ?? 0);
    window.fbq('track', 'Purchase', {
      value: cents / 100,
      currency: 'EUR',
    });
  }
}, [status]);
```

> Vérifie le nom exact du champ montant renvoyé par `/api/pay/session-status` (ouvre `api/pay/session-status.mjs`). Si c'est `amount_total`, garde ; sinon ajuste. Le `useRef` empêche de compter l'achat deux fois si la page re-render.

---

## Étape 5 — Vérifier que ça marche

1. Installe l'extension Chrome **Meta Pixel Helper**.
2. `npm run dev` (ou sur la prod après déploiement) → navigue : tu dois voir `PageView` se déclencher à chaque page.
3. Fais une inscription test → `CompleteRegistration` apparaît.
4. Fais un paiement test (Stripe test mode) → `Purchase` avec la bonne `value`.
5. Dans Events Manager → onglet **Tester les événements** : colle l'URL du site, les events remontent en direct.

---

## Étape 6 (RGPD) — Consentement

En France, le pixel dépose des cookies → il faut un **bandeau de consentement** (CNIL). En v1 de test tu peux lancer, mais pour être propre : ne charge `fbq('init')` qu'après acceptation, ou utilise un CMP (ex : Axeptio, tarteaucitron). À régulariser avant de scaler le budget.

---

## (Optionnel, plus tard) — Conversions API server-side

Le pixel client est bloqué par les adblockers / iOS (~20-30% de pertes). Pour une mesure fiable, double le `Purchase` côté serveur depuis `api/stripe-webhook.mjs` (event `checkout.session.completed`) via l'**API de Conversions Meta**, avec le même `event_id` que le pixel client (déduplication). À faire seulement quand le budget pub justifie l'effort.

---

## Récap des événements posés

| Événement | Où | Quand |
|---|---|---|
| `PageView` | index.html + PageViewTracker | chargement + chaque navigation |
| `CompleteRegistration` | Register.jsx (+ ensureUserDoc Google) | compte créé |
| `Purchase` | pay/Success.jsx | paiement Stripe confirmé |
