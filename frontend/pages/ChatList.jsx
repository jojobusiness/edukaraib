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
  try {
    const d = await getDoc(doc(db, "users", uid));
    if (d.exists()) return { id: uid, ...d.data() };
  } catch {}
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

function formatDate(date) {
  if (!date) return "";
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "à l’instant";
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
  return date.toLocaleDateString();
}

export default function ChatList({ onSelectChat }) {
  const [items, setItems] = useState([]);
  const { role: currentRole, loading } = useUserRole();

  useEffect(() => {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;

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

          // Présence (statut en ligne)
          let isOnline = false;
          try {
            const pres = await getDoc(doc(db, "presence", otherUid));
            isOnline = pres.exists() && pres.data().online;
          } catch {}

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
            isOnline,
            lastMessage: c.lastMessage || "",
            lastDate,
          };
        })
      );
      setItems(list);
    });

    return () => unsub();
  }, []);

  if (loading) return null;

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
                  <div className="relative">
                    <img
                      src={c.avatar || "/avatar-default.png"}
                      alt={c.name}
                      className="w-12 h-12 rounded-full object-cover border-2 border-primary"
                    />
                    {c.isOnline && (
                      <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
                    )}
                  </div>

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

                  <div className="flex items-center gap-2">
                    {c.lastDate && (
                      <div className="text-xs text-gray-400">
                        {formatDate(c.lastDate)}
                      </div>
                    )}

                    {onSelectChat ? (
                      <button
                        onClick={() => onSelectChat(c.otherUid)}
                        className="bg-primary text-white px-4 py-2 rounded shadow font-semibold hover:bg-primary-dark transition"
                      >
                        Discuter
                      </button>
                    ) : (
                      <Link
                        to={`/chat/${c.otherUid}`}
                        className="bg-primary text-white px-4 py-2 rounded shadow font-semibold hover:bg-primary-dark transition"
                      >
                        Discuter
                      </Link>
                    )}
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