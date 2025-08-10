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
import { useUserRole } from "../hooks/useUserRole";
import { Link } from "react-router-dom";

/**
 * Récupère un profil utilisateur à partir d'un UID.
 * Supporte /users/{uid} ou un doc autoId contenant un champ uid.
 */
async function fetchUserProfile(uid) {
  if (!uid) return null;

  // 1) Essai direct: users/{uid}
  try {
    const direct = await getDoc(doc(db, "users", uid));
    if (direct.exists()) return { id: uid, ...direct.data() };
  } catch {}

  // 2) Fallback: where uid == <uid>
  try {
    const q = query(collection(db, "users"), where("uid", "==", uid), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0];
      return { id: d.id, ...d.data() };
    }
  } catch {}

  return null;
}

/**
 * Extrait l'UID de l'interlocuteur à partir d'un message.
 * Priorité aux nouveaux champs *_uid, fallback sur les anciens.
 */
function getContactUidFromMessage(m, myUid) {
  const s = m.sender_uid ?? m.sender_id;
  const r = m.receiver_uid ?? m.receiver_id;
  if (!s || !r) return null;
  return s === myUid ? r : s;
}

export default function ChatList() {
  const [contacts, setContacts] = useState([]);

  useEffect(() => {
    if (!auth.currentUser) return;

    const myUid = auth.currentUser.uid;

    // Deux listeners : nouveau schéma + ancien schéma (pour compat)
    const qNew = query(
      collection(db, "messages"),
      where("participants_uids", "array-contains", myUid),
      orderBy("sent_at", "desc")
    );
    const qOld = query(
      collection(db, "messages"),
      where("participants", "array-contains", myUid),
      orderBy("sent_at", "desc")
    );

    let currentNew = [];
    let currentOld = [];

    const recompute = async () => {
      // Merge + dédupe par id
      const all = new Map();
      for (const d of [...currentNew, ...currentOld]) all.set(d.id, d);
      const msgs = Array.from(all.values());

      // Map par interlocuteur (dernier message uniquement)
      const mapByContact = new Map();
      for (const m of msgs) {
        const contactUid = getContactUidFromMessage(m, myUid);
        if (!contactUid) continue;
        if (!mapByContact.has(contactUid)) {
          mapByContact.set(contactUid, m);
        }
      }

      // Récup profils en parallèle
      const entries = Array.from(mapByContact.entries()); // [ [contactUid, lastMessage], ... ]
      const profiles = await Promise.all(
        entries.map(async ([contactUid, lastMessage]) => {
          const profile = await fetchUserProfile(contactUid);
          const fullName =
            profile?.fullName ||
            profile?.name ||
            profile?.displayName ||
            "(Sans nom)";
          const avatarUrl =
            profile?.avatarUrl ||
            profile?.avatar_url ||
            profile?.photoURL ||
            "";

          const role = profile?.role || "";

          return {
            uid: contactUid, // bien l’UID de l’interlocuteur
            fullName,
            avatarUrl,
            role,
            lastMessage: lastMessage?.message || "",
            lastDate: lastMessage?.sent_at?.toDate
              ? lastMessage.sent_at.toDate()
              : null,
          };
        })
      );

      profiles.sort(
        (a, b) => (b.lastDate?.getTime() || 0) - (a.lastDate?.getTime() || 0)
      );
      setContacts(profiles);
    };

    const unsubNew = onSnapshot(qNew, (snap) => {
      currentNew = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      recompute();
    });

    const unsubOld = onSnapshot(qOld, (snap) => {
      currentOld = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      recompute();
    });

    return () => {
      unsubNew();
      unsubOld();
    };
  }, []);

const { role: currentRole, loading } = useUserRole();
if (loading) return null; // ou un skeleton

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