import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { db, auth } from "../lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import ChatList from "./ChatList";
import Messages from "./Messages";
import { io } from "socket.io-client";

export default function MessagesWrapper() {
  const { id } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();

  const [selectedReceiver, setSelectedReceiver] = useState(null);
  const [fromAdmin, setFromAdmin] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // ✅ Socket.io : polling only + path + credentials
  useEffect(() => {
    const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "https://edukaraib-server.vercel.app";

    const socket = io(SERVER_URL, {
      path: "/socket.io",         // ⚠ identique au serveur
      transports: ["polling"],    // pas de WebSocket sur Vercel
      upgrade: false,
      withCredentials: true,      // envoie les cookies si nécessaires
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    // Ajoute cette ligne :
    socket.io.opts.extraHeaders = { "X-Requested-By": "edukaraib" };

    // Et masque les erreurs polling inutiles :
    socket.on("connect_error", (e) => {
      if (e?.message?.includes("xhr poll error")) return;
      console.warn("socket connect_error", e?.message || e);
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