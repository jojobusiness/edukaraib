import React, { useEffect } from 'react';
import { X, Download, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Visionneuse plein écran (photo / vidéo), façon Instagram :
 * fond noir, navigation clavier, téléchargement, fermeture au clic hors média.
 */
export default function MediaLightbox({ items = [], index = 0, onClose, onIndex }) {
  const item = items[index];

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'ArrowRight' && index < items.length - 1) onIndex?.(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex?.(index - 1);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [index, items.length, onClose, onIndex]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex items-center justify-center animate-[fadeIn_.15s_ease-out]"
      onClick={onClose}
      role="presentation"
    >
      <div className="absolute top-0 inset-x-0 flex items-center justify-between p-4 text-white/90">
        <span className="text-sm truncate max-w-[60%]">{item.name || ''}</span>
        <div className="flex items-center gap-2">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            download
            onClick={(e) => e.stopPropagation()}
            className="p-2 rounded-full hover:bg-white/10 transition"
            aria-label="Télécharger"
          >
            <Download size={20} />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 transition"
            aria-label="Fermer"
          >
            <X size={22} />
          </button>
        </div>
      </div>

      {index > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onIndex?.(index - 1);
          }}
          className="absolute left-2 sm:left-6 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
          aria-label="Précédent"
        >
          <ChevronLeft size={26} />
        </button>
      )}

      <div
        className="max-w-[92vw] max-h-[82vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        {item.kind === 'video' ? (
          <video
            src={item.url}
            controls
            autoPlay
            playsInline
            className="max-w-[92vw] max-h-[82vh] rounded-lg shadow-2xl bg-black"
          />
        ) : (
          <img
            src={item.url}
            alt={item.name || 'Pièce jointe'}
            className="max-w-[92vw] max-h-[82vh] object-contain rounded-lg shadow-2xl"
          />
        )}
      </div>

      {index < items.length - 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onIndex?.(index + 1);
          }}
          className="absolute right-2 sm:right-6 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
          aria-label="Suivant"
        >
          <ChevronRight size={26} />
        </button>
      )}

      {items.length > 1 && (
        <div className="absolute bottom-5 text-white/70 text-xs tracking-wide">
          {index + 1} / {items.length}
        </div>
      )}
    </div>
  );
}
