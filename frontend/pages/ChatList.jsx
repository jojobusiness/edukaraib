import React, { useEffect, useState } from "react";
import { db, auth } from "../lib/firebase";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
} from "firebase/firestore";
import DashboardLayout from "../components/DashboardLayout";
import { Link } from "react-router-dom";

export default function ChatList() {
  const [contacts, setContacts] = useState([]);

  useEffect(() => {
    if (!auth.currentUser) return;

    // Messages où je suis participant, triés par plus récent
    const q = query(
      collection(db, "messages"),
      where("participants", "array-contains", auth.currentUser.uid),
      orderBy("sent_at", "desc")
    );

    const unsub = onSnapshot(q, async (snap) => {
      const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Regroupe par contact (l’autre personne)
      const mapByContact = new Map(); // contactId -> { lastMessage, contactId }
      for (const m of msgs) {
        const contactId =
          m.sender_id === auth.currentUser.uid ? m.receiver_id : m.sender_id;
        if (!mapByContact.has(contactId)) {
          mapByContact.set(contactId, { contactId, lastMessage: m });
        }
      }

      // Va chercher les infos des contacts (nom, avatar, rôle)
      const result = [];
      for (const { contactId, lastMessage } of mapByContact.values()) {
        let fullName = contactId;
        let avatarUrl = "";
        let role = "";
        try {
          const uSnap = await getDoc(doc(db, "users", contactId));
          if (uSnap.exists()) {
            const u = uSnap.data();
            fullName = u.fullName || fullName;
            avatarUrl = u.avatarUrl || "";
            role = u.role || "";
          }
        } catch {}
        result.push({
          uid: contactId,
          fullName,
          avatarUrl,
          role,
          lastMessage: lastMessage.message || "",
          lastDate: lastMessage.sent_at?.toDate
            ? lastMessage.sent_at.toDate()
            : null,
        });
      }

      // Pas obligatoire mais pratique : retrier par date au cas où
      result.sort((a, b) => (b.lastDate?.getTime() || 0) - (a.lastDate?.getTime() || 0));
      setContacts(result);
    });

    return () => unsub();
  }, []);

  // Si tu veux adapter le menu à chaque rôle, récupère-le depuis /users/{uid}
  const currentRole = "student"; // ou "teacher"/"parent" selon ton layout actuel

  return (
    <DashboardLayout role={currentRole}>
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">💬 Mes conversations</h2>
        <div className="bg-white p-6 rounded-xl shadow border">
          {contacts.length === 0 ? (
            <div className="text-gray-500 text-center">Aucune conversation récente.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {contacts.map((u) => (
                <li key={u.uid} className="flex items-center gap-4 py-4">
                  <img
                    src={u.avatarUrl || "/avatar-default.png"}
                    alt={u.fullName || u.uid}
                    className="w-12 h-12 rounded-full object-cover border-2 border-primary"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-primary truncate">{u.fullName}</div>
                    <div className="text-xs text-gray-500">
                      {u.role === "teacher"
                        ? "Professeur"
                        : u.role === "parent"
                        ? "Parent"
                        : u.role === "student"
                        ? "Élève"
                        : ""}
                    </div>
                    <div className="text-sm text-gray-600 truncate mt-1">
                      {u.lastMessage || "Aucun message"}
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    {u.lastDate && (
                      <div className="text-xs text-gray-400 mb-2">
                        {u.lastDate.toLocaleDateString()} {u.lastDate.toLocaleTimeString()}
                      </div>
                    )}
                    <Link
                      to={`/chat/${u.uid}`}
                      className="bg-primary text-white px-4 py-2 rounded shadow font-semibold hover:bg-primary-dark transition"
                    >
                      Discuter
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}