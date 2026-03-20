import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { db, auth } from "../lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import ChatList from "./ChatList";
import Messages from "./Messages";

export default function MessagesWrapper() {
  const { id } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();

  const [selectedReceiver, setSelectedReceiver] = useState(null);
  const [fromAdmin, setFromAdmin] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);


  // Détecte ?from=admin et sélection initiale
  useEffect(() => {
    const qs = new URLSearchParams(search);
    const to = qs.get("to");
    const from = (qs.get("from") || "").toLowerCase();
    setFromAdmin(from === "admin");

    if (id) {
      setSelectedReceiver(id);
    } else if (to) {
      setSelectedReceiver(to);
      navigate(`/chat/${to}${from === "admin" ? "?from=admin" : ""}`, { replace: true });
    } else {
      setSelectedReceiver(null);
    }
  }, [id, search, navigate]);

  // Vérifie le rôle courant
  useEffect(() => {
    (async () => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) return setIsAdmin(false);
        const s = await getDoc(doc(db, "users", uid));
        const role = s.exists() ? (s.data()?.role || "") : "";
        setIsAdmin(role === "admin");
      } catch {
        setIsAdmin(false);
      }
    })();
  }, []);

  const handleSelectChat = (receiverId) => {
    setSelectedReceiver(receiverId);
    navigate(`/chat/${receiverId}${fromAdmin ? "?from=admin" : ""}`, { replace: false });
  };

  const handleBack = () => {
    setSelectedReceiver(null);
    if (fromAdmin && isAdmin) {
      navigate("/admin/dashboard", { replace: false });
    } else {
      navigate("/chat", { replace: false });
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {!selectedReceiver ? (
        <div className="flex-1 overflow-hidden">
          <ChatList onSelectChat={handleSelectChat} />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <Messages receiverId={selectedReceiver} onBack={handleBack} />
        </div>
      )}
    </div>
  );
}