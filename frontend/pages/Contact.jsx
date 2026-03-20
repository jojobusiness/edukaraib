import React, { useState } from 'react';
import { useSEO } from '../hooks/useSEO';

const MOYENS = [
  {
    icon: '✉️',
    titre: 'Email',
    detail: 'contact@edukaraib.com',
    href: 'mailto:contact@edukaraib.com',
    label: 'Écrire un email',
    delay: 'reply-time: sous 48h',
  },
];

export default function Contact() {
  useSEO({
    title: 'Contactez EduKaraib',
    description: "Contactez l'équipe EduKaraib par email ou WhatsApp pour toute question.",
    url: '/contact',
  });

  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [status, setStatus] = useState(null); // null | 'sending' | 'ok' | 'err'

  const handleChange = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('sending');
    try {
      await fetch('/api/notify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'contact@edukaraib.com',
          title: `[Contact] ${form.subject || 'Message depuis le site'}`,
          message: `De : ${form.name} <${form.email}>\n\n${form.message}`,
          ctaUrl: `mailto:${form.email}`,
          ctaText: 'Répondre',
        }),
      });
      setStatus('ok');
      setForm({ name: '', email: '', subject: '', message: '' });
    } catch {
      setStatus('err');
    }
  };

  return (
    <main className="min-h-screen bg-white">

      {/* Hero */}
      <section className="bg-gradient-to-br from-sky-50 to-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-14">
          <p className="text-sm font-semibold text-sky-500 uppercase tracking-widest mb-2">Support</p>
          <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 mb-3">Contactez-nous</h1>
          <p className="text-gray-500 text-lg max-w-xl">
            Une question, un problème technique ou une suggestion ? On vous répond.
          </p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-4 py-12 grid md:grid-cols-5 gap-10">

        {/* Moyens de contact */}
        <aside className="md:col-span-2 space-y-4">
          <h2 className="font-bold text-gray-800 mb-4">Nous joindre directement</h2>
          {MOYENS.map((m) => (
            <a
              key={m.titre}
              href={m.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-4 p-4 rounded-2xl border bg-white hover:border-sky-300 hover:shadow-sm transition group"
            >
              <span className="text-2xl">{m.icon}</span>
              <div>
                <div className="font-semibold text-gray-800 group-hover:text-sky-600">{m.titre}</div>
                <div className="text-sm text-gray-500">{m.detail}</div>
                <div className="text-xs text-gray-400 mt-1">{m.delay}</div>
              </div>
            </a>
          ))}
          <div className="mt-6 p-4 rounded-2xl bg-amber-50 border border-amber-100 text-sm text-amber-800">
            <strong>Vous êtes professeur ?</strong><br />
            Pour toute question sur vos paiements ou votre compte, passez par votre tableau de bord — c'est plus rapide.
          </div>
        </aside>

        {/* Formulaire */}
        <div className="md:col-span-3">
          <h2 className="font-bold text-gray-800 mb-5">Envoyer un message</h2>

          {status === 'ok' ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
              <div className="text-3xl mb-2">✅</div>
              <div className="font-semibold text-emerald-800">Message envoyé !</div>
              <p className="text-emerald-600 text-sm mt-1">Nous vous répondrons sous 48h.</p>
              <button
                onClick={() => setStatus(null)}
                className="mt-4 text-sm text-emerald-700 underline"
              >
                Envoyer un autre message
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
                  <input
                    type="text" name="name" required value={form.name} onChange={handleChange}
                    placeholder="Marie Dupont"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                  <input
                    type="email" name="email" required value={form.email} onChange={handleChange}
                    placeholder="marie@exemple.com"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sujet</label>
                <input
                  type="text" name="subject" value={form.subject} onChange={handleChange}
                  placeholder="Problème de réservation, question sur un cours…"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message *</label>
                <textarea
                  name="message" required value={form.message} onChange={handleChange}
                  rows={5}
                  placeholder="Décrivez votre demande…"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 resize-none"
                />
              </div>
              {status === 'err' && (
                <p className="text-sm text-red-600">Une erreur est survenue. Essayez par email directement.</p>
              )}
              <button
                type="submit"
                disabled={status === 'sending'}
                className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition"
              >
                {status === 'sending' ? 'Envoi…' : 'Envoyer le message'}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
