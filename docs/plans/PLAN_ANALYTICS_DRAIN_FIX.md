# Plan — Réparer le pipeline `analytics-drain` (option B)

> **Statut : EN ATTENTE — priorité basse.** Le focus business immédiat est l'acquisition + la conversion (0 inscrit / 0 paiement au 17/06/2026). Ce doc existe pour que n'importe qui sur le projet puisse reprendre proprement. Ne pas y passer de temps tant que la conversion n'est pas réglée.

## Contexte

`api/analytics-drain.js` reçoit un **Vercel Log Drain** et agrège des stats dans Firestore (`analytics_daily`, `analytics_monthly`, `analytics_top/*`) pour les afficher dans l'AdminDashboard (section visites internes).

Objectif : avoir nos stats de trafic dans notre propre admin sans dépendre du dashboard Vercel.

## Ce qui est DÉJÀ corrigé (17/06/2026)

- ✅ **Signature 401 « Signature invalide »** — la vérification utilisait HMAC-**SHA256**. Vercel signe les log drains en HMAC-**SHA1** (hex brut, header `x-vercel-signature`, pas de préfixe). Corrigé dans `verifySignature()` (`hash: 'SHA-1'`).
- ✅ `bodyParser: false` présent (bug connu #7).
- ✅ URL du drain = `https://edukaraib.vercel.app/api/analytics-drain` (bug connu #8, pas le domaine custom qui redirige en 307).

## Ce qui reste CASSÉ (le vrai travail de l'option B)

Le parser attend des events `type === 'webAnalytics'` (lignes 82-83) :

```js
const evtType = evt.type || evt.eventType || '';
if (evtType !== 'webAnalytics' && evtType !== 'pageview') continue;
```

**Problème :** un Log Drain Vercel ne transporte PAS de Web Analytics. Il transporte des **logs de requêtes**. Le Web Analytics (visiteurs/pages/pays dans le dashboard Vercel) est un produit séparé, non drainable. Donc après le fix signature, chaque batch va logger `processed: 0`.

### Schéma réel d'une entrée de log drain (format JSON)

```jsonc
{
  "id": "...",
  "timestamp": 1718600000000,
  "type": "stdout" | "stderr",
  "source": "lambda" | "static" | "edge" | "build" | "external",
  "projectId": "...",
  "deploymentId": "...",
  "host": "www.edukaraib.com",
  "proxy": {
    "method": "GET",
    "host": "www.edukaraib.com",
    "path": "/bac",                 // ← la page visitée
    "userAgent": ["Mozilla/5.0 ..."],// ← ARRAY, pas string
    "referer": "https://instagram.com/...",
    "clientIp": "x.x.x.x",
    "region": "cdg1",               // ← région Vercel, PAS le pays
    "statusCode": 200,
    "scheme": "https"
  }
}
```

### Étapes de réécriture

1. **Filtrer les vraies pages vues**, pas `type === 'webAnalytics'` :
   - garder uniquement les entrées avec `evt.proxy` présent
   - `evt.proxy.statusCode` entre 200 et 399
   - `evt.proxy.method === 'GET'`
   - exclure les assets : `path` ne commence pas par `/api/`, `/_next/`, `/assets/`, et n'a pas d'extension `.js/.css/.png/.svg/.ico/.woff...`
2. **Remapper les champs** :
   - `path` ← `evt.proxy.path`
   - `ua` ← `evt.proxy.userAgent` (c'est un **array** → prendre `[0]`)
   - `referrer` ← `evt.proxy.referer`
   - `sessionId` ← hash de `clientIp + userAgent + jour` (pas d'ID visiteur natif dans un log drain → fabriquer une clé de dédup approximative)
   - `timestamp` ← `evt.proxy.timestamp || evt.timestamp`
3. **Pays** : un log drain ne donne PAS le pays (`proxy.region` = datacenter, ex `cdg1`, pas le pays du visiteur). Deux options :
   - (a) abandonner la stat « pays » dans l'admin (le dashboard Vercel l'a déjà), OU
   - (b) résoudre `clientIp` → pays via une lib/API geoIP (coût + latence — déconseillé pour ce besoin).
   - **Reco : option (a)**, on ne maintient pas une géoloc maison.
4. **Garder** la logique d'agrégation existante (dayMap/monthMap/pageMap/deviceMap/browserMap/referrerMap) — elle est bonne, seuls les champs d'entrée changent.
5. **Validation** : après deploy, vérifier dans les logs Vercel que les batches renvoient `{ ok: true, processed: X }` avec X > 0, et que `analytics_daily/<jour>` s'incrémente dans Firestore.

### Garde-fou anti-bruit

Un log drain envoie BEAUCOUP d'entrées (chaque asset, chaque requête edge). Bien filtrer (étape 1) sinon les compteurs explosent et coûtent en écritures Firestore. Surveiller la facture Firestore après mise en route.

## Alternative à garder en tête

Si le coût/complexité ne vaut pas le coup : **supprimer le drain** et mettre dans l'admin un simple lien/embed vers le dashboard Vercel Analytics (qui fait déjà tout : pages, pays, devices, référents). Décision business, pas technique.

---
*Rédigé le 17/06/2026. Le fix signature est mergé ; la réécriture du parser ci-dessus reste à faire quand la priorité acquisition/conversion sera stabilisée.*
