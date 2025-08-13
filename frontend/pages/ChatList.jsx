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
import { useUserRole } from "../hooks/useUserRole";

// ---------- Helpers ----------
async function fetchUserProfile(uid) {
  if (!uid) return null;
  // 1) users/{uid}
  try {
    const d = await getDoc(doc(db, "users", uid));
    if (d.exists()) return { id: uid, ...d.data() };
  } catch {}
  // 2) where uid == <uid>
  try {
    const q = query(collection(db, "users"), where("uid", "==", uid), limit(1));
    const s = await getDocs(q);
    if (!s.empty) {
      const d = s.docs[0];
      return { id: d.id, ...d.data() };
    }
  } catch {}
  return null;
}

export default function ChatList() {
  const [items, setItems] = useState([]);
  const { role: currentRole, loading } = useUserRole();

  useEffect(() => {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;

    // conversations: { participants:[uid1,uid2], lastMessage, lastSentAt, ... }
    const qConvs = query(
      collection(db, "conversations"),
      where("participants", "array-contains", myUid),
      orderBy("lastSentAt", "desc")
    );

    const unsub = onSnapshot(qConvs, async (snap) => {
      const list = await Promise.all(
        snap.docs.map(async (d) => {
          const c = { id: d.id, ...d.data() };
          const otherUid = (c.participants || []).find((u) => u !== myUid);
          const profile = await fetchUserProfile(otherUid);
          const name =
            profile?.fullName || profile?.name || profile?.displayName || "(Sans nom)";
          const avatar =
            profile?.avatarUrl || profile?.avatar_url || profile?.photoURL || "";
          const role = profile?.role || "";
          const lastDate = c.lastSentAt?.toDate ? c.lastSentAt.toDate() : null;

          return {
            cid: c.id,
            otherUid,
            name,
            avatar,
            role,
            lastMessage: c.lastMessage || "",
            lastDate,
          };
        })
      );
      setItems(list);
    });

    return () => unsub();
  }, []);

  // Attends d'avoir le rôle (évite un layout qui clignote / mauvais menu)
  if (loading) return null; // ou un petit skeleton si tu veux

  return (
    <DashboardLayout role={currentRole}>
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">💬 Mes conversations</h2>
        <div className="bg-white p-6 rounded-xl shadow border">
          {items.length === 0 ? (
            <div className="text-gray-500 text-center">Aucune conversation récente.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {items.map((c) => (
                <li key={c.cid} className="flex items-center gap-4 py-4">
                  <img
                    src={c.avatar || "/avatar-default.png"}
                    alt={c.name}
                    className="w-12 h-12 rounded-full object-cover border-2 border-primary"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-primary truncate">{c.name}</div>
                    <div className="text-xs text-gray-500">
                      {c.role === "teacher"
                        ? "Professeur"
                        : c.role === "parent"
                        ? "Parent"
                        : c.role === "student"
                        ? "Élève"
                        : ""}
                    </div>
                    <div className="text-sm text-gray-600 truncate mt-1">
                      {c.lastMessage || "Aucun message"}
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    {c.lastDate && (
                      <div className="text-xs text-gray-400 mb-2">
                        {c.lastDate.toLocaleDateString()} {c.lastDate.toLocaleTimeString()}
                      </div>
                    )}
                    {/* /chat/:id = UID de l’interlocuteur (ton Messages.jsx s'en charge) */}
                    <Link
                      to={`/chat/${c.otherUid}`}
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