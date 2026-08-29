// Helpers pièces jointes de la messagerie (photos, vidéos, messages vocaux).
//
// Utilisé par frontend/pages/Messages.jsx — donc par TOUS les rôles, admin
// compris (AdminDashboard réutilise le composant <Messages />).

/** Limites de taille par type. Au-delà, on refuse côté client avant l'upload. */
export const LIMITES_MO = {
  image: 10,
  video: 50,
  audio: 10,
  file: 15,
};

/** Types acceptés dans le sélecteur de fichiers. */
export const ACCEPT_FICHIERS = 'image/*,video/*';

/** Durée maximale d'un message vocal (sécurité : taille + coût Storage). */
export const DUREE_MAX_AUDIO_S = 300; // 5 min

/** Déduit le « kind » métier à partir du type MIME. */
export function kindDepuisMime(mime = '') {
  const m = String(mime).toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'file';
}

/** Nom de fichier sûr pour Firebase Storage (ASCII, sans espaces). */
export function nomSur(nom = 'fichier') {
  return (
    String(nom)
      .normalize('NFD')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(-80) || 'fichier'
  );
}

/**
 * Valide un fichier avant upload.
 * @returns {string|null} message d'erreur, ou null si le fichier est bon.
 */
export function erreurFichier(file) {
  if (!file) return 'Fichier illisible.';
  const kind = kindDepuisMime(file.type);
  const maxMo = LIMITES_MO[kind] ?? LIMITES_MO.file;
  if (file.size > maxMo * 1024 * 1024) {
    return `« ${file.name} » dépasse ${maxMo} Mo (${formatTaille(file.size)}).`;
  }
  if (file.size === 0) return `« ${file.name} » est vide.`;
  return null;
}

export function formatTaille(octets = 0) {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

export function formatDuree(secondes = 0) {
  const s = Math.max(0, Math.round(secondes));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Choisit un conteneur audio enregistrable par CE navigateur.
 * Safari ne sait enregistrer qu'en mp4/aac, Chrome/Firefox qu'en webm/opus :
 * on prend le premier supporté plutôt que d'imposer un format qui échoue.
 * @returns {string} mimeType ('' = laisser le navigateur décider)
 */
export function mimeAudioSupporte() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidats = [
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  for (const c of candidats) {
    try {
      if (MediaRecorder.isTypeSupported?.(c)) return c;
    } catch {
      /* navigateur trop ancien : on continue */
    }
  }
  return '';
}

/** L'enregistrement vocal est-il possible ici ? (jsdom / http => non) */
export function enregistrementDispo() {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator?.mediaDevices?.getUserMedia
  );
}

/** Extension de fichier déduite du mime d'enregistrement. */
export function extensionAudio(mime = '') {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

/** Étiquette courte pour l'aperçu de conversation (lastMessage) et les emails. */
export function resumeAttachments(attachments = [], texte = '') {
  const t = (texte || '').trim();
  if (t) return t;
  if (!attachments.length) return '';
  const n = attachments.length;
  const kinds = new Set(attachments.map((a) => a.kind));
  if (n === 1) {
    const k = attachments[0].kind;
    if (k === 'image') return '📷 Photo';
    if (k === 'video') return '🎥 Vidéo';
    if (k === 'audio') return '🎤 Message vocal';
    return `📎 ${attachments[0].name || 'Pièce jointe'}`;
  }
  if (kinds.size === 1) {
    const k = attachments[0].kind;
    if (k === 'image') return `📷 ${n} photos`;
    if (k === 'video') return `🎥 ${n} vidéos`;
    if (k === 'audio') return `🎤 ${n} messages vocaux`;
  }
  return `📎 ${n} pièces jointes`;
}

/**
 * Message d'erreur lisible pour un échec d'upload Storage.
 * Le cas `storage/unauthorized` = règles Storage à ouvrir sur le préfixe `chat/`.
 */
export function messageErreurUpload(err) {
  const code = err?.code || '';
  if (code === 'storage/unauthorized') {
    return "Envoi refusé par le serveur de fichiers. Les règles Firebase Storage doivent autoriser le dossier « chat/ ».";
  }
  if (code === 'storage/canceled') return 'Envoi annulé.';
  if (code === 'storage/retry-limit-exceeded') {
    return 'Connexion trop lente : le fichier n’a pas pu être envoyé. Réessayez.';
  }
  return "Échec de l'envoi de la pièce jointe. Réessayez.";
}
