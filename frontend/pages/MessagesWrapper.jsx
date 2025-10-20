import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ChatList from "./ChatList";
import Messages from "./Messages";

/**
 * MessagesWrapper.jsx
 * - Lit l'id de l'URL (/chat/:id) et ouvre la discussion
 * - Sinon affiche la liste et attend un onSelectChat
 */
export default function MessagesWrapper() {
  const { id } = useParams(); // :id = receiverId
  const navigate = useNavigate();
  const [selectedReceiver, setSelectedReceiver] = useState(null);

  // Si on arrive via /chat/:id, on sélectionne automatiquement
  useEffect(() => {
    if (id) setSelectedReceiver(id);
  }, [id]);

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