import React from 'react';
import { Link } from 'react-router-dom';
import { useSEO } from '../hooks/useSEO';

const VALEURS = [
  {
    icon: '🎓',
    titre: 'Excellence pédagogique',
    texte: 'Nous sélectionnons des professeurs qualifiés et passionnés, engagés à faire progresser chaque élève.',
  },
  {
    icon: '🤝',
    titre: 'Confiance & transparence',
    texte: 'Tarifs clairs, paiement sécurisé, avis vérifiés. Aucune mauvaise surprise entre parents, élèves et professeurs.',
  },
  {
    icon: '🌴',
    titre: 'Ancré en au Caraïbe',
    texte: 'Nous connaissons les réalités locales — programmes scolaires, géographie, besoins spécifiques du territoire.',
  },
  {
    icon: '📱',
    titre: 'Simple & accessible',
    texte: 'Réservation en quelques clics, visio intégrée, suivi de cours : tout depuis un seul espace.',
  },
];

const CHIFFRES = [
  { valeur: '100+', label: 'Professeurs inscrits' },
  { valeur: '500+', label: 'Cours dispensés' },
  { valeur: '4.8/5', label: 'Note moyenne' },
  { valeur: '10+', label: 'Matières disponibles' },
];

export default function About() {
  useSEO({
    title: 'À propos de EduKaraib',
    description: "Découvrez la mission, l'équipe et la vision derrière EduKaraib, la plateforme de cours particuliers en au Caraïbe.",
    url: '/about',
  });

  return (
    <main className="min-h-screen bg-white">

      {/* Hero */}
      <section className="bg-gradient-to-br from-sky-50 to-white border-b">
        <div className="max-w-5xl mx-auto px-4 py-16 lg:py-24">
          <p className="text-sm font-semibold text-sky-500 uppercase tracking-widest mb-3">Notre histoire</p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 leading-tight mb-6">
            L'éducation de qualité,<br className="hidden md:block" />
            partout en au Caraïbe.
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl leading-relaxed">
            EduKaraib est né d'un constat simple : trouver un bon professeur particulier en au Caraïbe
            relevait souvent du parcours du combattant. Nous avons voulu changer ça — en créant
            une plateforme locale, pensée pour les familles guyanaises.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="max-w-5xl mx-auto px-4 py-14">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Notre mission</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              Connecter les élèves et les familles de au Caraïbe avec des professeurs sérieux,
              vérifiés et disponibles — que ce soit en présentiel à Cayenne, Kourou, Saint-Laurent,
              ou en visio pour les zones plus éloignées.
            </p>
            <p className="text-gray-600 leading-relaxed">
              Chaque enfant mérite un accompagnement adapté à son rythme et à ses besoins.
              EduKaraib rend cela possible, simplement et en toute confiance.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {CHIFFRES.map((c) => (
              <div key={c.label} className="bg-sky-50 border border-sky-100 rounded-2xl p-5 text-center">
                <div className="text-3xl font-extrabold text-sky-600">{c.valeur}</div>
                <div className="text-sm text-gray-500 mt-1">{c.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Valeurs */}
      <section className="bg-gray-50 border-y">
        <div className="max-w-5xl mx-auto px-4 py-14">
          <h2 className="text-2xl font-bold text-gray-900 mb-10 text-center">Ce qui nous guide</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {VALEURS.map((v) => (
              <div key={v.titre} className="bg-white rounded-2xl border p-6 shadow-sm">
                <span className="text-3xl">{v.icon}</span>
                <h3 className="font-bold text-gray-900 mt-3 mb-2">{v.titre}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{v.texte}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Rejoignez la communauté EduKaraib</h2>
        <p className="text-gray-500 mb-8">Vous êtes professeur ou parent d'élève ? Créez votre compte gratuitement.</p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link to="/search" className="bg-sky-500 hover:bg-sky-600 text-white font-semibold px-6 py-3 rounded-xl transition">
            Trouver un professeur
          </Link>
          <Link to="/register" className="border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold px-6 py-3 rounded-xl transition">
            Devenir professeur
          </Link>
        </div>
      </section>

    </main>
  );
}