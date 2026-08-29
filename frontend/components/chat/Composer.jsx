import React, { useEffect, useRef, useState } from 'react';
import { Paperclip, Mic, Send, X, Trash2, Check, Image as ImageIcon, Film, Loader2 } from 'lucide-react';
import {
  ACCEPT_FICHIERS,
  DUREE_MAX_AUDIO_S,
  erreurFichier,
  extensionAudio,
  enregistrementDispo,
  formatDuree,
  kindDepuisMime,
  mimeAudioSupporte,
} from '../../lib/chatAttachments';

/**
 * Barre de saisie de la messagerie : texte + photos/vidéos + message vocal.
 *
 * Le composant possède les brouillons (fichiers choisis, enregistrement en
 * cours) ; l'upload et l'écriture Firestore restent dans Messages.jsx.
 *
 * onSend(texte, pieces) où pieces = [{ file, kind, previewUrl, durationSec }]
 */
export default function Composer({ value, onChange, onSend, sending, progress }) {
  const [pieces, setPieces] = useState([]);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [erreur, setErreur] = useState('');

  const inputFileRef = useRef(null);
  const media = useRef({ recorder: null, stream: null, chunks: [], timer: null, annule: false });
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;
  // Le handler `onstop` du MediaRecorder lit la durée : on la garde dans une ref
  // pour éviter la capture d'un état périmé (closure) au moment de l'arrêt.
  const recSecsRef = useRef(0);
  recSecsRef.current = recSecs;

  const peutEnregistrer = enregistrementDispo();

  // Nettoyage : object URLs + micro toujours relâché quand on quitte l'écran.
  useEffect(
    () => () => {
      piecesRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
      if (media.current.timer) clearInterval(media.current.timer);
      media.current.stream?.getTracks?.().forEach((t) => t.stop());
    },
    []
  );

  const ajouterFichiers = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const erreurs = [];
    const nouvelles = [];
    files.forEach((file) => {
      const e = erreurFichier(file);
      if (e) {
        erreurs.push(e);
        return;
      }
      nouvelles.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        file,
        kind: kindDepuisMime(file.type),
        previewUrl: URL.createObjectURL(file),
      });
    });
    setErreur(erreurs.join(' '));
    if (nouvelles.length) setPieces((cur) => [...cur, ...nouvelles].slice(0, 10));
  };

  const retirerPiece = (id) => {
    setPieces((cur) => {
      const cible = cur.find((p) => p.id === id);
      if (cible?.previewUrl) URL.revokeObjectURL(cible.previewUrl);
      return cur.filter((p) => p.id !== id);
    });
  };

  // ── Message vocal ──────────────────────────────────────────────────────────
  const stopFlux = () => {
    if (media.current.timer) clearInterval(media.current.timer);
    media.current.timer = null;
    media.current.stream?.getTracks?.().forEach((t) => t.stop());
    media.current.stream = null;
  };

  const demarrerEnregistrement = async () => {
    if (recording || sending) return;
    setErreur('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = mimeAudioSupporte();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      media.current = { recorder, stream, chunks: [], timer: null, annule: false };

      recorder.ondataavailable = (e) => {
        if (e.data?.size) media.current.chunks.push(e.data);
      };
      recorder.onstop = () => {
        const secondes = recSecsRef.current;
        stopFlux();
        setRecording(false);
        setRecSecs(0);
        if (media.current.annule) {
          media.current.chunks = [];
          return;
        }
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(media.current.chunks, { type });
        media.current.chunks = [];
        if (!blob.size || secondes < 1) {
          setErreur('Enregistrement trop court.');
          return;
        }
        const file = new File([blob], `vocal_${Date.now()}.${extensionAudio(type)}`, { type });
        setPieces((cur) => [
          ...cur,
          { id: `vocal-${Date.now()}`, file, kind: 'audio', previewUrl: null, durationSec: secondes },
        ]);
      };

      recorder.start();
      setRecording(true);
      setRecSecs(0);
      media.current.timer = setInterval(() => {
        setRecSecs((s) => {
          const suivant = s + 1;
          if (suivant >= DUREE_MAX_AUDIO_S) {
            try {
              recorder.stop();
            } catch {
              /* déjà arrêté */
            }
          }
          return suivant;
        });
      }, 1000);
    } catch {
      setErreur("Micro inaccessible. Autorisez l'accès au microphone dans votre navigateur.");
      stopFlux();
      setRecording(false);
    }
  };

  const arreterEnregistrement = (annule) => {
    media.current.annule = !!annule;
    try {
      media.current.recorder?.stop();
    } catch {
      stopFlux();
      setRecording(false);
      setRecSecs(0);
    }
  };

  // ── Envoi ──────────────────────────────────────────────────────────────────
  const submit = async (e) => {
    e.preventDefault();
    if (sending || recording) return;
    const texte = (value || '').trim();
    if (!texte && pieces.length === 0) return;
    const aEnvoyer = pieces;
    const ok = await onSend(texte, aEnvoyer);
    if (ok !== false) {
      aEnvoyer.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
      setPieces([]);
      setErreur('');
    }
  };

  const rienAEnvoyer = !(value || '').trim() && pieces.length === 0;

  return (
    <div className="bg-white/90 backdrop-blur border-t border-gray-200">
      {/* Aperçu des pièces jointes en attente */}
      {pieces.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 pt-3 pb-1">
          {pieces.map((p) => (
            <div
              key={p.id}
              className="relative shrink-0 w-20 h-20 rounded-xl overflow-hidden border border-gray-200 bg-gray-50 grid place-items-center"
            >
              {p.kind === 'image' && (
                <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
              )}
              {p.kind === 'video' && (
                <>
                  <video src={p.previewUrl} muted playsInline className="w-full h-full object-cover" />
                  <Film size={18} className="absolute text-white drop-shadow" />
                </>
              )}
              {p.kind === 'audio' && (
                <div className="text-center text-primary">
                  <Mic size={20} className="mx-auto" />
                  <div className="text-[11px] mt-0.5 tabular-nums text-gray-600">
                    {formatDuree(p.durationSec || 0)}
                  </div>
                </div>
              )}
              {p.kind === 'file' && <ImageIcon size={20} className="text-gray-400" />}

              <button
                type="button"
                onClick={() => retirerPiece(p.id)}
                aria-label="Retirer cette pièce jointe"
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 hover:bg-black/80 text-white grid place-items-center"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {erreur && (
        <div className="px-4 pt-2 text-xs text-red-600">{erreur}</div>
      )}

      {sending && typeof progress === 'number' && progress > 0 && progress < 100 && (
        <div className="h-1 bg-gray-100">
          <div
            className="h-full bg-primary transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <form onSubmit={submit} className="p-2.5 sm:p-3 flex items-end gap-2">
        {recording ? (
          <div className="flex-1 flex items-center gap-3 bg-red-50 border border-red-100 rounded-full px-4 py-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-medium text-red-600 tabular-nums">{formatDuree(recSecs)}</span>
            <span className="flex-1 flex items-center gap-[3px] h-4 overflow-hidden">
              {Array.from({ length: 28 }).map((_, i) => (
                <span
                  key={i}
                  className="flex-1 bg-red-300 rounded-full animate-pulse"
                  style={{
                    height: `${25 + ((i * 37) % 70)}%`,
                    animationDelay: `${(i % 7) * 90}ms`,
                  }}
                />
              ))}
            </span>
            <button
              type="button"
              onClick={() => arreterEnregistrement(true)}
              aria-label="Annuler l'enregistrement"
              className="text-gray-400 hover:text-red-600 transition"
            >
              <Trash2 size={18} />
            </button>
            <button
              type="button"
              onClick={() => arreterEnregistrement(false)}
              aria-label="Terminer l'enregistrement"
              className="w-9 h-9 rounded-full bg-red-500 hover:bg-red-600 text-white grid place-items-center transition active:scale-95"
            >
              <Check size={18} />
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => inputFileRef.current?.click()}
              disabled={sending}
              aria-label="Joindre une photo ou une vidéo"
              className="shrink-0 w-10 h-10 rounded-full grid place-items-center text-gray-500 hover:text-primary hover:bg-primary/10 transition disabled:opacity-40"
            >
              <Paperclip size={20} />
            </button>
            <input
              ref={inputFileRef}
              type="file"
              accept={ACCEPT_FICHIERS}
              multiple
              className="hidden"
              onChange={(e) => {
                ajouterFichiers(e.target.files);
                e.target.value = '';
              }}
            />

            <textarea
              rows={1}
              placeholder="Votre message…"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit(e);
                }
              }}
              className="flex-1 resize-none max-h-32 border border-gray-200 bg-gray-50 focus:bg-white focus:border-primary/40 focus:ring-2 focus:ring-primary/10 rounded-3xl px-4 py-2.5 outline-none text-[15px] transition"
            />

            {rienAEnvoyer && peutEnregistrer ? (
              <button
                type="button"
                onClick={demarrerEnregistrement}
                disabled={sending}
                aria-label="Enregistrer un message vocal"
                className="shrink-0 w-11 h-11 rounded-full bg-primary text-white grid place-items-center shadow hover:bg-primary-dark transition active:scale-95 disabled:opacity-50"
              >
                <Mic size={20} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={sending || rienAEnvoyer}
                aria-label="Envoyer"
                className="shrink-0 w-11 h-11 rounded-full bg-primary text-white grid place-items-center shadow hover:bg-primary-dark transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? <Loader2 size={19} className="animate-spin" /> : <Send size={19} />}
              </button>
            )}
          </>
        )}
      </form>
    </div>
  );
}
