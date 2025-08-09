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
  getDocs,
  limit,
} from "firebase/firestore";
import DashboardLayout from "../components/DashboardLayout";
import { Link } from "react-router-dom";

async function fetchUserProfile(uid) {
  // 1) Essai direct: /users/{uid}
  try {
    const d = await getDoc(doc(db, "users", uid));
    if (d.exists()) return { id: uid, ...d.data() };
  } catch {}

  // 2) Fallback: users where uid == <uid>
  try {
    const q = query(collection(db, "users"), where("uid", "==", uid), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const docSnap = snap.docs[0];
      return { id: docSnap.id, ...docSnap.data() };
    }
  } catch {}

  return null;
}

export default function ChatList() {
  const [contacts, setContacts] = useState([]);

  useEffect(() => {
    if (!auth.currentUser) return;

    const q = query(
      collection(db, "messages"),
      where("participants", "array-contains", auth.currentUser.uid),
      orderBy("sent_at", "desc")
    );

    const unsub = onSnapshot(q, async (snap) => {
      const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Récupère l'UID de l'interlocuteur pour chaque message
      const mapByContact = new Map(); // contactId -> lastMessage
      for (const m of msgs) {
        const contactId =
          m.sender_id === auth.currentUser.uid ? m.receiver_id : m.sender_id;
        if (!mapByContact.has(contactId)) {
          mapByContact.set(contactId, m);
        }
      }

      // Fetch des profils en parallèle
      const entries = Array.from(mapByContact.entries()); // [ [contactId, lastMessage], ... ]
      const profiles = await Promise.all(
        entries.map(async ([contactId, lastMessage]) => {
          const profile = await fetchUserProfile(contactId);
          const displayName =
            profile?.fullName ||
            profile?.name ||
            profile?.displayName ||
            "(Sans nom)";
          const avatarUrl =
            profile?.avatarUrl || profile?.avatar_url || profile?.photoURL || "";

          const role = profile?.role || "";

          return {
            uid: contactId, // <-- bien l'UID de l’interlocuteur
            fullName: displayName,
            avatarUrl,
            role,
            lastMessage: lastMessage?.message || "",
            lastDate: lastMessage?.sent_at?.toDate
              ? lastMessage.sent_at.toDate()
              : null,
          };
        })
      );

      // Tri final
      profiles.sort(
        (a, b) => (b.lastDate?.getTime() || 0) - (a.lastDate?.getTime() || 0)
      );
      setContacts(profiles);
    });

    return () => unsub();
  }, []);

  const currentRole = "student";

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
