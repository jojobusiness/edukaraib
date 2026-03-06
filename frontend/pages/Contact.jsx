import React from 'react';
import { useSEO } from '../hooks/useSEO';

export default function Contact() {
  useSEO({
    title: 'Contactez EduKaraib',
    description: 'Contactez l\'équipe EduKaraib par email ou WhatsApp pour toute question.',
    url: '/contact',
  });
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h2 className="text-2xl font-bold mb-4 text-primary">Contactez-nous</h2>
      <p className="mb-4">
        Une question, un souci ou une proposition ? Écrivez-nous à <a href="mailto:contact@edukaraib.com" className="text-primary underline">contact@edukaraib.com</a>.<br />
      </p>
      <p>
        Vous pouvez aussi utiliser le formulaire de contact (à venir).
      </p>
    </div>
  );
}