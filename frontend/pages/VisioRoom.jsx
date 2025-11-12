// src/pages/VisioRoom.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

function useQuery() {
  const { search } = useLocation();
  return new URLSearchParams(search);
}

const loadJitsiApi = () =>
  new Promise((resolve, reject) => {
    if (window.JitsiMeetExternalAPI) return resolve(window.JitsiMeetExternalAPI);
    const s = document.createElement('script');
    s.src = 'https://meet.jit.si/external_api.js';
    s.async = true;
    s.onload = () => resolve(window.JitsiMeetExternalAPI);
    s.onerror = reject;
    document.body.appendChild(s);
  });

export default function VisioRoom() {
  const { lessonId } = useParams();
  const q = useQuery();
  const token = q.get('k') || '';

  const [state, setState] = useState({ loading: true, allowed: false, reason: '', lesson: null });
  const containerRef = useRef(null);
  const apiRef = useRef(null);

  // 1) Contrôle d’accès (token, participants, fenêtre)
  useEffect(() => {
    (async () => {
      try {
        const u = auth.currentUser;
        if (!u) return setState({ loading: false, allowed: false, reason: 'NOT_AUTH', lesson: null });

        const snap = await getDoc(doc(db, 'lessons', String(lessonId)));
        if (!snap.exists()) return setState({ loading: false, allowed: false, reason: 'NOT_FOUND', lesson: null });

        const l = { id: snap.id, ...snap.data() };

        // token & revocation
        const v = l.visio || {};
        if (!token || !v.joinUrl?.includes(token) || v.revoked === true) {
          return setState({ loading: false, allowed: false, reason: 'TOKEN', lesson: l });
        }

        // participant autorisé (prof, élève, parent, membre groupe)
        const isTeacher = String(l.teacher_id) === u.uid;
        const isStudent = String(l.student_id) === u.uid;
        const inGroup = Array.isArray(l.participant_ids) && l.participant_ids.map(String).includes(u.uid);
        const isParent = String(l.parent_id) === u.uid;
        if (!(isTeacher || isStudent || inGroup || isParent)) {
          return setState({ loading: false, allowed: false, reason: 'NOT_PARTICIPANT', lesson: l });
        }

        // fenêtre temporelle
        const now = Date.now();
        const opensAt = v.opens_at ? new Date(v.opens_at).getTime() : null;
        const expiresAt = v.expires_at ? new Date(v.expires_at).getTime() : null;
        if (opensAt && now < opensAt) return setState({ loading: false, allowed: false, reason: 'NOT_OPEN_YET', lesson: l });
        if (expiresAt && now > expiresAt) return setState({ loading: false, allowed: false, reason: 'EXPIRED', lesson: l });

        setState({ loading: false, allowed: true, reason: '', lesson: l });
      } catch (e) {
        console.error(e);
        setState({ loading: false, allowed: false, reason: 'ERROR', lesson: null });
      }
    })();
  }, [lessonId, token]);

  // 2) Montage de l'iframe Jitsi si autorisé
  const roomName = useMemo(() => {
    const r = state.lesson?.visio?.room;
    return typeof r === 'string' && r.length > 10 ? r : `jk_${lessonId}`;
  }, [state.lesson, lessonId]);

  useEffect(() => {
    if (!state.allowed || !containerRef.current) return;
    let mounted = true;

    (async () => {
      try {
        const JitsiMeetExternalAPI = await loadJitsiApi();
        if (!mounted) return;

        // Infos utilisateur pour affichage du nom
        const u = auth.currentUser;
        const displayName = u?.displayName || 'Utilisateur';

        // Options IFrame (voir doc Jitsi external_api)
        const domain = 'meet.jit.si';
        const options = {
          roomName,
          parentNode: containerRef.current,
          width: '100%',
          height: 600,
          userInfo: { displayName },
          configOverwrite: {
            prejoinConfig: { enabled: false },
            disableRemoteMute: true,
            startWithAudioMuted: true,
            startWithVideoMuted: true,
            fileRecordingsEnabled: false,
            liveStreamingEnabled: false,
            enableWelcomePage: false,
            disableDeepLinking: true,
          },
          interfaceConfigOverwrite: {
            DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
            SHOW_JITSI_WATERMARK: false,
            SHOW_BRAND_WATERMARK: false,
            SHOW_POWERED_BY: false,
            HIDE_INVITE_MORE_HEADER: true,
          },
        };

        apiRef.current = new JitsiMeetExternalAPI(domain, options);

        // (optionnel) Événements utiles
        apiRef.current.addListener('videoConferenceJoined', () => {
          // console.log('joined');
        });
        apiRef.current.addListener('readyToClose', () => {
          // Quand tous partent / fin d’appel
        });
      } catch (e) {
        console.error('Jitsi init error', e);
        alert("Impossible de charger la salle visio.");
      }
    })();

    return () => {
      mounted = false;
      try {
        apiRef.current && apiRef.current.dispose();
      } catch {}
      apiRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, [state.allowed, roomName]);

  // 3) UI
  if (state.loading) return <div className="p-6 text-gray-600">Chargement de la salle…</div>;
  if (!state.allowed) {
    const msg = {
      NOT_AUTH: "Tu dois être connecté pour rejoindre la visio.",
      NOT_FOUND: "Cours introuvable.",
      TOKEN: "Lien visio invalide ou révoqué.",
      NOT_PARTICIPANT: "Tu n'es pas participant de ce cours.",
      NOT_OPEN_YET: "La salle n'est pas encore ouverte (reviens plus tard).",
      EXPIRED: "La salle est fermée (lien expiré).",
      ERROR: "Erreur lors du chargement de la visio.",
    }[state.reason] || "Accès visio refusé.";
    return (
      <div className="max-w-md mx-auto p-6 bg-white rounded-xl shadow border">
        <h2 className="text-xl font-bold mb-2">Accès visio refusé</h2>
        <p className="text-gray-600">{msg}</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4">
      <h2 className="text-xl font-bold text-primary mb-3">
        Salle visio — {state.lesson?.subject_id || 'Cours'}
      </h2>
      <div ref={containerRef} className="w-full rounded-xl overflow-hidden border shadow" />
      <p className="text-[11px] text-gray-500 mt-2">
        Pour des connexions difficiles, rafraîchis la page. Le micro/caméra sont coupés par défaut.
      </p>
    </div>
  );
}