import React from 'react';

export default function Contact() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h2 className="text-2xl font-bold mb-4 text-primary">Contactez-nous</h2>
      <p className="mb-4">
        Une question, un souci ou une proposition ? Écrivez-nous à <a href="mailto:contact@edukaraib.com" className="text-primary underline">contact@edukaraib.com</a>.<br />
        Ou via WhatsApp : <a href="https://wa.me/33766437668" className="text-primary underline">+33 7 66 43 76 68</a>
      </p>
      <p>
        Vous pouvez aussi utiliser le formulaire de contact (à venir).
      </p>
    </div>
  );
}