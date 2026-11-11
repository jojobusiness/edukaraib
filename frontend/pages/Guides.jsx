import React from 'react';
import { Link } from 'react-router-dom';
import { useSEO } from '../hooks/useSEO';
import { GUIDES } from '../lib/guides';

// Index des guides publics (11/11/2026). Prérendu aussi : dist/guides/index.html.
export default function Guides() {
  useSEO({
    title: 'Guides du soutien scolaire en outre-mer',
    description: 'Prix, fonctionnement des cours en visio, brevet, Parcoursup, méthodes de révision : des réponses claires pour les familles des Antilles, de Guyane, de La Réunion et d’Afrique.',
    url: '/guides',
  });
  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900">Guides du soutien scolaire en outre-mer</h1>
        <p className="text-gray-600 mt-2">Des réponses courtes et sourcées pour les familles.</p>
        <ul className="mt-8 space-y-5">
          {GUIDES.map((g) => (
            <li key={g.slug}>
              <Link to={`/guides/${g.slug}`} className="text-lg font-semibold text-primary hover:underline">{g.titre}</Link>
              <p className="text-sm text-gray-600 mt-1">{g.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
