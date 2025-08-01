import React, { useEffect, useState } from 'react';
import { db, auth } from '../lib/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';
import { Link } from 'react-router-dom';

export default function ChatList() {
  const [contacts, setContacts] = useState([]);

  useEffect(() => {
    const fetch = async () => {
      // Récupère tous les messages de la base (optimise si trop gros volume !)
      const snapshot = await getDocs(collection(db, 'messages'));
      const msgs = snapshot.docs.map(doc => doc.data());
      // Filtre ceux qui concernent l'utilisateur courant
      const related = msgs.filter(
        m => m.sender_id === auth.currentUser.uid || m.receiver_id === auth.currentUser.uid
      );
      // Liste des IDs de contacts (hors soi-même, pas de doublons)
      const contactIds = [...new Set(
        related.map(m =>
          m.sender_id === auth.currentUser.uid ? m.receiver_id : m.sender_id
        )
      )];

      // Récupère info de chaque contact (nom, role, avatar…)
      const infos = await Promise.all(contactIds.map(async (uid) => {
        let user = { uid, fullName: uid, role: '', avatarUrl: '' };
        try {
          const snap = await getDoc(doc(db, 'users', uid));
          if (snap.exists()) {
            user = { ...user, ...snap.data() };
          }
        } catch {}
        return user;
      }));

      setContacts(infos);
    };
    fetch();
  }, []);

  return (
    <DashboardLayout role="student">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">💬 Mes conversations</h2>
        <div className="bg-white p-6 rounded-xl shadow border">
          {contacts.length === 0 ? (
            <div className="text-gray-500 text-center">Aucune conversation récente.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {contacts.map(u => (
                <li key={u.uid} className="flex items-center gap-4 py-4">
                  <img
                    src={u.avatarUrl || "/avatar-default.png"}
                    alt={u.fullName || u.uid}
                    className="w-12 h-12 rounded-full object-cover border-2 border-primary"
                  />
                  <div className="flex-1">
                    <div className="font-bold text-primary">{u.fullName}</div>
                    <div className="text-xs text-gray-500">
                      {u.role === "teacher"
                        ? "Professeur"
                        : u.role === "parent"
                        ? "Parent"
                        : u.role === "student"
                        ? "Élève"
                        : ""}
                    </div>
                  </div>
                  <Link
                    to={`/chat/${u.uid}`}
                    className="bg-primary text-white px-4 py-2 rounded shadow font-semibold hover:bg-primary-dark transition"
                  >
                    Discuter
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}