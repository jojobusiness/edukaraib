import React, { useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

// notifications : array [{ id, type, withName?, with_id?, created_at }]
export default function NotifList({ notifications }) {
  const [names, setNames] = useState({});

  useEffect(() => {
    // On va chercher les noms manquants (si pas withName déjà)
    const idsToFetch = notifications
      .map(n => n.with_id)
      .filter(id => id && !names[id]);

    if (idsToFetch.length === 0) return;

    const fetchNames = async () => {
      const updates = {};
      for (let id of idsToFetch) {
        try {
          const snap = await getDoc(doc(db, 'users', id));
          if (snap.exists()) updates[id] = snap.data().fullName || 'Utilisateur';
        } catch { updates[id] = 'Utilisateur'; }
      }
      setNames(prev => ({ ...prev, ...updates }));
    };
    fetchNames();
    // eslint-disable-next-line
  }, [notifications]);

  return (
    <ul className="text-gray-700 space-y-2">
      {notifications.length === 0 && <li>Pas de notification récente.</li>}
      {notifications.map((n, idx) => {
        // Prend d'abord le nom présent, sinon le nom récupéré, sinon fallback
        const personName = n.withName || (n.with_id && names[n.with_id]) || "un utilisateur";

        let phrase = "";
        if (n.type === "cours_accepted")
          phrase = <>Votre cours avec <b>{personName}</b> a été accepté.</>;
        else if (n.type === "cours_rejected")
          phrase = <>Votre cours avec <b>{personName}</b> a été refusé.</>;
        else if (n.type === "new_message")
          phrase = <>Nouveau message de <b>{personName}</b></>;
        else if (n.type === "paiement")
          phrase = <>Paiement validé pour le cours avec <b>{personName}</b></>;
        else
          phrase = n.text || "Notification";

        return (
          <li key={n.id || idx}>
            <span className="mr-2">
              {n.type === "cours_accepted" && "✅"}
              {n.type === "cours_rejected" && "❌"}
              {n.type === "new_message" && "💬"}
              {n.type === "paiement" && "💳"}
            </span>
            {phrase}
            <span className="text-xs text-gray-400 ml-2">
              {n.created_at?.toDate?.().toLocaleString?.() || ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}