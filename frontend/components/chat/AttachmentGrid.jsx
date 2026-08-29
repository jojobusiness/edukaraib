import React from 'react';
import { Play, FileText, Download } from 'lucide-react';
import AudioPlayer from './AudioPlayer';
import { formatTaille } from '../../lib/chatAttachments';

/**
 * Rendu des pièces jointes dans une bulle de message.
 * - 1 média         : grande vignette arrondie (WhatsApp / Instagram)
 * - 2 à 4 médias    : mosaïque carrée
 * - 5 et plus       : mosaïque + overlay « +N »
 * - vocal / fichier : lignes dédiées
 */
export default function AttachmentGrid({ attachments = [], isMine = false, onOpenMedia }) {
  const medias = attachments.filter((a) => a.kind === 'image' || a.kind === 'video');
  const audios = attachments.filter((a) => a.kind === 'audio');
  const fichiers = attachments.filter((a) => a.kind !== 'image' && a.kind !== 'video' && a.kind !== 'audio');

  const visibles = medias.slice(0, 4);
  const reste = medias.length - visibles.length;

  return (
    <div className="space-y-1.5">
      {visibles.length > 0 && (
        <div
          className={
            visibles.length === 1
              ? 'w-[240px] sm:w-[270px]'
              : 'grid grid-cols-2 gap-1 w-[240px] sm:w-[270px]'
          }
        >
          {visibles.map((a, i) => {
            const seul = visibles.length === 1;
            return (
              <button
                type="button"
                key={a.url || i}
                onClick={() => onOpenMedia?.(medias.indexOf(a))}
                className={`relative group overflow-hidden rounded-xl bg-black/5 ${
                  seul ? 'max-h-[320px] w-full' : 'aspect-square w-full'
                }`}
                aria-label={a.kind === 'video' ? 'Ouvrir la vidéo' : 'Ouvrir la photo'}
              >
                {a.kind === 'video' ? (
                  <>
                    <video
                      src={a.url}
                      preload="metadata"
                      muted
                      playsInline
                      className={`w-full ${seul ? 'max-h-[320px] object-cover' : 'h-full object-cover'} bg-black`}
                    />
                    <span className="absolute inset-0 grid place-items-center bg-black/25 group-hover:bg-black/35 transition">
                      <span className="w-12 h-12 rounded-full bg-white/90 grid place-items-center shadow-lg">
                        <Play size={22} className="ml-0.5 text-gray-900" fill="currentColor" />
                      </span>
                    </span>
                    {a.duration ? (
                      <span className="absolute bottom-1.5 right-1.5 text-[10px] font-medium text-white bg-black/60 px-1.5 py-0.5 rounded">
                        {a.duration}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <img
                    src={a.url}
                    alt={a.name || 'Photo'}
                    loading="lazy"
                    className={`w-full ${
                      seul ? 'max-h-[320px] object-cover' : 'h-full object-cover'
                    } group-hover:brightness-95 transition`}
                  />
                )}

                {i === visibles.length - 1 && reste > 0 && (
                  <span className="absolute inset-0 grid place-items-center bg-black/55 text-white text-xl font-semibold">
                    +{reste}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {audios.map((a, i) => (
        <div
          key={a.url || `audio-${i}`}
          className={`rounded-xl px-2 py-1.5 ${isMine ? 'bg-white/10' : 'bg-gray-50'}`}
        >
          <AudioPlayer src={a.url} duration={a.durationSec} isMine={isMine} />
        </div>
      ))}

      {fichiers.map((a, i) => (
        <a
          key={a.url || `file-${i}`}
          href={a.url}
          target="_blank"
          rel="noreferrer"
          download
          className={`flex items-center gap-3 rounded-xl px-3 py-2 w-[240px] sm:w-[270px] transition ${
            isMine ? 'bg-white/15 hover:bg-white/25' : 'bg-gray-50 hover:bg-gray-100 border border-gray-100'
          }`}
        >
          <span
            className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${
              isMine ? 'bg-white/25 text-white' : 'bg-primary/10 text-primary'
            }`}
          >
            <FileText size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block text-sm truncate ${isMine ? 'text-white' : 'text-gray-800'}`}>
              {a.name || 'Pièce jointe'}
            </span>
            <span className={`block text-[11px] ${isMine ? 'text-white/70' : 'text-gray-500'}`}>
              {a.size ? formatTaille(a.size) : 'Fichier'}
            </span>
          </span>
          <Download size={16} className={isMine ? 'text-white/80' : 'text-gray-400'} />
        </a>
      ))}
    </div>
  );
}
