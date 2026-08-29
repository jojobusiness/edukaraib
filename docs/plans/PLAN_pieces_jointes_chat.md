# Pièces jointes dans la messagerie — photos, vidéos, messages vocaux

**Statut : ✅ LIVRÉ le 29/08/2026** (lint 0 erreur, 107 tests verts, build OK).

Disponible pour **tous les rôles** — élève, parent, prof, influenceur **et admin**
(`AdminDashboard` réutilise le composant `<Messages />`, il n'y a qu'une seule
messagerie dans l'application).

---

## Ce qui a été ajouté

| Élément | Fichier |
|---|---|
| Règles métier (types, limites, résumés, mime audio) | `frontend/lib/chatAttachments.js` |
| Barre de saisie (📎 fichiers + 🎤 vocal + aperçus) | `frontend/components/chat/Composer.jsx` |
| Rendu des pièces jointes dans les bulles | `frontend/components/chat/AttachmentGrid.jsx` |
| Lecteur vocal façon WhatsApp (forme d'onde, seek) | `frontend/components/chat/AudioPlayer.jsx` |
| Visionneuse plein écran photo/vidéo | `frontend/components/chat/MediaLightbox.jsx` |
| Upload Storage + écriture Firestore | `frontend/pages/Messages.jsx` |
| Email admin qui décrit les pièces jointes | `functions/index.js` (`onMessageCreated`) |
| Tests | `frontend/test/chat.test.jsx` (10 tests) |

### Comportement

- **Photos / vidéos** : bouton trombone, sélection multiple (10 max par message),
  aperçu avant envoi avec croix de retrait, barre de progression pendant l'upload.
- **Message vocal** : bouton micro (visible quand le champ texte est vide),
  chrono + forme d'onde animée pendant l'enregistrement, corbeille pour annuler,
  ✓ pour valider. Coupure automatique à 5 min.
- **Affichage** : 1 média = grande vignette, 2–4 = mosaïque, 5+ = mosaïque `+N`.
  Clic = visionneuse plein écran (flèches clavier, téléchargement, Échap).
- **Aperçu de conversation** (`ChatList`) et **emails** : « 📷 Photo »,
  « 🎤 Message vocal », etc. quand le message n'a pas de texte.

### Modèle de données

Le document `messages/{id}` porte un champ `attachments` (tableau, absent sur les
anciens messages — le rendu le gère) :

```js
{
  url: "https://firebasestorage.../...",
  storage_path: "chat/{conversationId}/{uid}/{timestamp}_{nom}",
  kind: "image" | "video" | "audio" | "file",
  name: "photo.jpg",
  size: 182340,
  mime: "image/jpeg",
  durationSec: 12          // messages vocaux uniquement
}
```

Limites côté client : image 10 Mo, vidéo 50 Mo, vocal 10 Mo.

La suppression d'une conversation efface aussi les fichiers dans Storage
(`deleteObject` sur chaque `storage_path`) — sinon le bucket accumulerait des
médias facturés indéfiniment.

---

## ⚠️ Point à vérifier une fois : les règles Firebase Storage

Les règles Storage **ne sont pas dans le dépôt** (`firebase.json` ne déclare pas
de bloc `storage`) : elles vivent dans la console Firebase. Les uploads écrivent
désormais sous le préfixe **`chat/`**.

- Si les règles actuelles sont du type `allow read, write: if request.auth != null;`
  sur `{allPaths=**}` (ce que laisse supposer le fait que `lessons/`,
  `avatars/`, `intro-videos/` et `refund-proofs/` fonctionnent déjà), **il n'y a
  rien à faire**.
- Sinon, l'envoi affiche : « Envoi refusé par le serveur de fichiers… ». Dans ce
  cas, ajouter ce bloc dans **Firebase Console → Storage → Rules**, sans toucher
  au reste :

```
match /chat/{conversationId}/{uid}/{fichier} {
  allow read: if request.auth != null;
  allow write: if request.auth != null
               && request.auth.uid == uid
               && request.resource.size < 50 * 1024 * 1024;
}
```

## Limite connue — audio inter-navigateurs

Chrome/Firefox enregistrent en `webm/opus`, Safari en `mp4/aac` : le code choisit
automatiquement le format supporté par le navigateur qui enregistre. Un vocal
enregistré sur Chrome se lit sans problème sur iOS 16+ ; sur un Safari plus
ancien, le bouton de téléchargement du lecteur sert de repli. Passer par une
conversion serveur (ffmpeg) n'a de sens que si des plaintes remontent.
