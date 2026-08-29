import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Download } from 'lucide-react';
import { formatDuree } from '../../lib/chatAttachments';

/**
 * Lecteur de message vocal façon WhatsApp : bouton play, forme d'onde
 * cliquable (seek), durée qui défile pendant la lecture.
 *
 * La forme d'onde est déterministe (dérivée de l'URL) : pas d'analyse audio,
 * mais deux messages différents n'ont jamais la même allure — c'est ce qui
 * donne l'impression « vraie messagerie » sans coût de décodage.
 */

const NB_BARRES = 34;

function barresDepuisUrl(url = '') {
  // Hash simple et stable -> hauteurs pseudo-aléatoires reproductibles.
  let h = 0;
  for (let i = 0; i < url.length; i += 1) {
    h = (h * 31 + url.charCodeAt(i)) >>> 0;
  }
  const barres = [];
  for (let i = 0; i < NB_BARRES; i += 1) {
    h = (h * 1103515245 + 12345) >>> 0;
    // Enveloppe : plus haut au centre, comme une vraie voix.
    const centre = 1 - Math.abs(i / (NB_BARRES - 1) - 0.5) * 1.1;
    barres.push(0.25 + ((h % 1000) / 1000) * 0.75 * centre);
  }
  return barres;
}

export default function AudioPlayer({ src, duration, isMine = false }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duree, setDuree] = useState(Number(duration) || 0);
  const barres = useMemo(() => barresDepuisUrl(src), [src]);

  // Les blobs MediaRecorder ont souvent une durée `Infinity` tant qu'on n'a
  // pas cherché la fin du flux : c'est le contournement classique.
  const onLoadedMetadata = () => {
    const a = audioRef.current;
    if (!a) return;
    if (Number.isFinite(a.duration) && a.duration > 0) {
      setDuree(a.duration);
    } else if (!duration) {
      const onSeeked = () => {
        if (Number.isFinite(a.duration)) setDuree(a.duration);
        a.currentTime = 0;
        a.removeEventListener('timeupdate', onSeeked);
      };
      a.addEventListener('timeupdate', onSeeked);
      try {
        a.currentTime = 1e101;
      } catch {
        /* certains navigateurs refusent : on garde la durée fournie */
      }
    }
  };

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return undefined;
    const onTime = () => setPosition(a.currentTime || 0);
    const onEnd = () => {
      setPlaying(false);
      setPosition(0);
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('ended', onEnd);
    };
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      // Une seule lecture à la fois : on coupe les autres lecteurs de la page.
      document.querySelectorAll('audio').forEach((el) => {
        if (el !== a) el.pause();
      });
      a.play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  const seek = (e) => {
    const a = audioRef.current;
    if (!a || !duree) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * duree;
    setPosition(a.currentTime);
  };

  const progres = duree > 0 ? Math.min(1, position / duree) : 0;
  const restant = duree > 0 ? (playing || position ? duree - position : duree) : 0;

  return (
    <div className={`flex items-center gap-3 w-[240px] sm:w-[270px] ${isMine ? 'text-white' : 'text-gray-800'}`}>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Mettre en pause' : 'Écouter le message vocal'}
        className={`shrink-0 w-10 h-10 rounded-full grid place-items-center transition active:scale-95 ${
          isMine ? 'bg-white/25 hover:bg-white/35 text-white' : 'bg-primary text-white hover:bg-primary-dark'
        }`}
      >
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0">
        <div
          onClick={seek}
          role="presentation"
          className="flex items-end gap-[2px] h-8 cursor-pointer"
          title="Cliquer pour se déplacer dans le message"
        >
          {barres.map((h, i) => {
            const actif = i / NB_BARRES <= progres;
            return (
              <span
                key={i}
                style={{ height: `${Math.round(h * 100)}%` }}
                className={`flex-1 rounded-full transition-colors ${
                  isMine
                    ? actif
                      ? 'bg-white'
                      : 'bg-white/40'
                    : actif
                    ? 'bg-primary'
                    : 'bg-gray-300'
                }`}
              />
            );
          })}
        </div>
        <div className={`text-[11px] mt-1 tabular-nums ${isMine ? 'text-white/80' : 'text-gray-500'}`}>
          {formatDuree(restant)}
        </div>
      </div>

      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        download
        aria-label="Télécharger le message vocal"
        className={`shrink-0 opacity-60 hover:opacity-100 transition ${isMine ? 'text-white' : 'text-gray-500'}`}
      >
        <Download size={16} />
      </a>

      <audio ref={audioRef} src={src} preload="metadata" onLoadedMetadata={onLoadedMetadata} className="hidden" />
    </div>
  );
}
