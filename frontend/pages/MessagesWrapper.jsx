import React, { useState } from "react";
import ChatList from "./ChatList";
import Messages from "./Messages";

/**
 * MessagesWrapper.jsx
 * Point d'entrée de la messagerie :
 * - Affiche la liste des discussions
 * - Charge Messages.jsx quand une discussion est sélectionnée
 */
export default function MessagesWrapper() {
  const [selectedReceiver, setSelectedReceiver] = useState(null);

  // Quand on clique sur une discussion dans ChatList :
  const handleSelectChat = (receiverId) => {
    setSelectedReceiver(receiverId);
  };

  // Bouton retour depuis la discussion :
  const handleBack = () => {
    setSelectedReceiver(null);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {!selectedReceiver ? (
        // ✅ Mode liste : aucune discussion ouverte
        <div className="flex-1 overflow-hidden">
          <ChatList onSelectChat={handleSelectChat} />
        </div>
      ) : (
        // ✅ Mode discussion : on affiche Messages.jsx
        <div className="flex-1 overflow-hidden">
          <Messages receiverId={selectedReceiver} onBack={handleBack} />
        </div>
      )}
    </div>
  );
}