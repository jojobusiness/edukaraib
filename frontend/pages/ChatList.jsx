import React, { useEffect, useState } from "react";
import { db, auth } from "../lib/firebase";
import { collection, query, where, orderBy, getDocs, doc, getDoc } from "firebase/firestore";
import DashboardLayout from "../components/DashboardLayout";
import { Link } from "react-router-dom";

export default function ChatList() {
  const [contacts, setContacts] = useState([]);

  useEffect(() => {
    const fetchChats = async () => {
      if (!auth.currentUser) return;

      // On récupère tous les messages où l'utilisateur est dans "participants"
      const q = query(
        collection(db, "messages"),
        where("participants", "array-contains", auth.currentUser.uid),
        orderBy("sent_at", "desc")
      );
      const snapshot = await getDocs(q);
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Regroupe les messages par contact
      const convoMap = {};
      for (let m of msgs) {
        const contactId =
          m.sender_id === auth.currentUser.uid ? m.receiver_id : m.sender_id;
        if (!convoMap[contactId]) {
          convoMap[contactId] = { lastMessage: m, contactId };
        }
      }

      // Récupère les infos des contacts
      const contactsInfo = await Promise.all(
        Object.values(convoMap).map(async (c) => {
          let userData = {
            uid: c.contactId,
            fullName: c.contactId,
            role: "",
            avatarUrl: "",
            lastMessage: c.lastMessage.message || "",
            lastDate: c.lastMessage.sent_at?.toDate
              ? c.lastMessage.sent_at.toDate()
              : null,
          };
          try {
            const snap = await getDoc(doc(db, "users", c.contactId));
            if (snap.exists()) {
              const data = snap.data();
              userData = {
                ...userData,
                fullName: data.fullName || c.contactId,
                role: data.role || "",
                avatarUrl: data.avatarUrl || "",
              };
            }
          } catch {}
          return userData;
        })
      );

      setContacts(contactsInfo);
    };

    fetchChats();
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