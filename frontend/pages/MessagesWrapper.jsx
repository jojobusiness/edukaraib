import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import ChatList from "./ChatList";
import Messages from "./Messages";

/**
 * MessagesWrapper.jsx
 * - Lit l'id de l'URL (/chat/:id) ou le query param (?to=uid) et ouvre la discussion
 * - Sinon affiche la liste et attend un onSelectChat
 */

export default function MessagesWrapper() {
  const { id } = useParams();          // /chat/:id
  const { search } = useLocation();    // /chat?to=uid
  const navigate = useNavigate();
  const [selectedReceiver, setSelectedReceiver] = useState(null);

  // Sélection auto depuis :id OU ?to=
  useEffect(() => {
    const qs = new URLSearchParams(search);
    const to = qs.get('to');
    if (id) {
      setSelectedReceiver(id);
    } else if (to) {
      setSelectedReceiver(to);
      // normalise l’URL vers /chat/:id (plus propre pour le refresh / partage)
      navigate(`/chat/${to}`, { replace: true });
    } else {
      setSelectedReceiver(null);
    }
  }, [id, search, navigate]);

  const handleSelectChat = (receiverId) => {
    setSelectedReceiver(receiverId);
    // met à jour l'URL pour partage/refresh
    navigate(`/chat/${receiverId}`, { replace: false });
  };

  const handleBack = () => {
    setSelectedReceiver(null);
    // revient à la liste
    navigate("/chat", { replace: false });
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