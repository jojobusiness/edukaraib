import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { db, auth } from "../lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import ChatList from "./ChatList";
import Messages from "./Messages";
import { io } from "socket.io-client";

/**
 * MessagesWrapper.jsx
 * - Lit l'id de l'URL (/chat/:id) ou le query param (?to=uid)
 * - Propage le contexte `from=admin` pour que le bouton Retour renvoie au dashboard admin
 * - Vérifie le rôle avant de renvoyer sur /admin
 */

export default function MessagesWrapper() {
  const { id } = useParams();          // /chat/:id
  const { search } = useLocation();    // /chat?to=uid&from=admin
  const navigate = useNavigate();

  const [selectedReceiver, setSelectedReceiver] = useState(null);
  const [fromAdmin, setFromAdmin] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // ✅ Initialise socket.io en "polling only" (pas de WebSocket), avec reconnexion robuste
  useEffect(() => {
    const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "https://edukaraib-server.vercel.app";

    const socket = io(SERVER_URL, {
      // ⚠️ Forcer uniquement le polling pour Vercel functions
      transports: ["polling"],
      upgrade: false,
      path: "/socket.io", // laisser le path par défaut de ton server.js

      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      withCredentials: true,
    });

    socket.on("connect", () => console.log("socket connected (polling)"));
    socket.on("connect_error", (e) => console.warn("socket connect_error", e?.message || e));
    socket.on("reconnect_attempt", (n) => console.log("socket reconnect_attempt", n));
    socket.on("disconnect", (r) => console.log("socket disconnected:", r));

    return () => {
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch {}
    };
  }, []);

  // Détecte ?from=admin et sélecteur initial
  useEffect(() => {
    const qs = new URLSearchParams(search);
    const to = qs.get("to");
    const from = (qs.get("from") || "").toLowerCase();
    setFromAdmin(from === "admin");

    if (id) {
      setSelectedReceiver(id);
    } else if (to) {
      setSelectedReceiver(to);
      // Normalise l'URL, en gardant le flag from=admin si présent
      navigate(`/chat/${to}${from === "admin" ? "?from=admin" : ""}`, { replace: true });
    } else {
      setSelectedReceiver(null);
    }
  }, [id, search, navigate]);

  // Vérifie le rôle courant (pour le retour sécurisé vers /admin)
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
    // met à jour l'URL pour partage/refresh (garde from=admin si présent)
    navigate(`/chat/${receiverId}${fromAdmin ? "?from=admin" : ""}`, { replace: false });
  };

  const handleBack = () => {
    setSelectedReceiver(null);
    // Si on vient de l'admin ET qu'on est bien admin -> retour dashboard admin
    if (fromAdmin && isAdmin) {
      navigate("/admin/dashboard", { replace: false });
    } else {
      // sinon on reste dans le contexte messagerie
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