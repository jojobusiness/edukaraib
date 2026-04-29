import React from 'react';
import { Link } from 'react-router-dom';
import { useSEO } from '../hooks/useSEO';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const SUBJECTS = [
  'Mathématiques', 'Français', 'Anglais', 'Histoire-Géographie',
  'Physique-Chimie', 'SVT', 'Philosophie', 'Espagnol', 'Informatique',
];

export default function SEOLocalPage({
  title,
  description,
  urlPath,
  heading,
  subheading,
  island,
  subject,
  islandDescription,
  keywords,
  faq,
}) {
  useSEO({
    title,
    description,
    url: urlPath,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'EducationalOrganization',
      name: 'EduKaraib',
      url: 'https://edukaraib.com',
      description,
      areaServed: {
        '@type': 'Place',
        name: island,
      },
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: subject ? `Cours de ${subject} en ${island}` : `Cours particuliers en ${island}`,
        itemListElement: SUBJECTS.map((s) => ({
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: `Cours de ${s} en ${island}`,
          },
        })),
      },
    },
  });

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Navbar />
      <main className="flex-1">
        {/* Hero */}
        <section className="bg-gradient-to-br from-primary to-secondary py-16 px-4 text-white text-center">
          <div className="max-w-3xl mx-auto">
            <h1 className="text-3xl md:text-5xl font-extrabold mb-4 leading-tight">
              {heading}
            </h1>
            <p className="text-lg md:text-xl opacity-90 mb-8">{subheading}</p>
            <Link
              to="/search"
              className="inline-block bg-white text-primary font-bold px-8 py-3 rounded-full shadow hover:bg-gray-100 transition text-lg"
            >
              Trouver un professeur
            </Link>
          </div>
        </section>

        <div className="max-w-4xl mx-auto px-4 py-12 space-y-12">
          {/* Présentation locale */}
          <section>
            <h2 className="text-2xl font-bold text-primary mb-4">
              {subject
                ? `Pourquoi choisir EduKaraib pour les cours de ${subject} en ${island} ?`
                : `Pourquoi choisir EduKaraib pour les cours particuliers en ${island} ?`}
            </h2>
            <div className="prose prose-gray max-w-none text-gray-700 leading-relaxed space-y-4">
              <p>{islandDescription}</p>
              <p>
                EduKaraib est la première plateforme de soutien scolaire des Antilles avec
                paiement sécurisé en ligne et cours en visioconférence. Que vous soyez en{' '}
                {island}, vos enfants peuvent accéder aux meilleurs professeurs depuis chez vous,
                sans déplacement, à des tarifs clairs et transparents.
              </p>
              <p>
                Contrairement aux plateformes européennes généralistes, EduKaraib est
                spécialement conçu pour les familles caribéennes. Nos professeurs connaissent
                les programmes académiques de l&apos;Académie de Martinique, de Guadeloupe et de
                Guyane, et comprennent les spécificités culturelles locales qui facilitent
                l&apos;apprentissage.
              </p>
              {subject ? (
                <p>
                  Les cours de <strong>{subject}</strong> en {island} sont dispensés par des
                  professeurs certifiés, diplômés Bac+3 minimum, avec avis vérifiés. Chaque
                  professeur est évalué par les familles après chaque cours, garantissant un
                  haut niveau de qualité.
                </p>
              ) : (
                <p>
                  Nos cours particuliers en {island} couvrent toutes les matières du primaire
                  au lycée : Maths, Français, Anglais, Physique-Chimie, SVT,
                  Histoire-Géographie et plus encore. Chaque professeur est évalué par les
                  familles après chaque cours.
                </p>
              )}
            </div>
          </section>

          {/* Comment ça marche */}
          <section>
            <h2 className="text-2xl font-bold text-primary mb-6">Comment ça marche ?</h2>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  step: '1',
                  title: 'Cherchez un prof',
                  desc: `Filtrez par matière, niveau et disponibilité. Consultez les avis des familles en ${island}.`,
                },
                {
                  step: '2',
                  title: 'Réservez en ligne',
                  desc: 'Choisissez un créneau, payez en toute sécurité par carte ou en 3 fois. Zéro cash, zéro chèque.',
                },
                {
                  step: '3',
                  title: 'Commencez les cours',
                  desc: 'Rejoignez la visio directement depuis votre espace. Le cours démarre, le prof est évalué après.',
                },
              ].map((item) => (
                <div
                  key={item.step}
                  className="bg-white rounded-xl p-6 shadow border text-center"
                >
                  <div className="w-10 h-10 rounded-full bg-primary text-white font-bold flex items-center justify-center mx-auto mb-3 text-lg">
                    {item.step}
                  </div>
                  <h3 className="font-bold text-primary mb-2">{item.title}</h3>
                  <p className="text-sm text-gray-600">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Matières disponibles */}
          <section>
            <h2 className="text-2xl font-bold text-primary mb-4">
              Matières disponibles en {island}
            </h2>
            <div className="flex flex-wrap gap-2">
              {SUBJECTS.map((s) => (
                <span
                  key={s}
                  className="px-4 py-2 bg-white border rounded-full text-sm font-medium text-gray-700 shadow-sm"
                >
                  {s}
                </span>
              ))}
            </div>
            <p className="text-sm text-gray-500 mt-3">
              Et bien d&apos;autres matières selon la disponibilité des professeurs inscrits.
            </p>
          </section>

          {/* Avantages */}
          <section className="bg-white rounded-xl p-8 shadow border">
            <h2 className="text-2xl font-bold text-primary mb-6">
              Les avantages EduKaraib en {island}
            </h2>
            <ul className="space-y-3 text-gray-700">
              {[
                'Paiement 100% sécurisé par carte bancaire — paiement en 3 fois disponible',
                'Cours en visioconférence depuis chez vous, zéro déplacement',
                'Professeurs diplômés avec avis vérifiés par de vraies familles',
                "Programmes adaptés à l'Académie de Martinique / Guadeloupe / Guyane",
                'Réduction fiscale de 50% pour les familles françaises (crédit d\'impôt)',
                'Facture téléchargeable pour votre déclaration fiscale',
                'Packs 5h et 10h pour économiser sur les cours réguliers',
                'Support disponible 7j/7 par email',
              ].map((benefit) => (
                <li key={benefit} className="flex items-start gap-3">
                  <span className="text-green-500 mt-0.5 shrink-0">✓</span>
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* FAQ */}
          {faq?.length > 0 && (
            <section>
              <h2 className="text-2xl font-bold text-primary mb-6">
                Questions fréquentes — {subject || 'Cours particuliers'} en {island}
              </h2>
              <div className="space-y-4">
                {faq.map((item) => (
                  <div key={item.q} className="bg-white rounded-xl p-5 shadow border">
                    <h3 className="font-bold text-gray-800 mb-2">{item.q}</h3>
                    <p className="text-gray-600 text-sm leading-relaxed">{item.a}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* CTA final */}
          <section className="bg-gradient-to-br from-primary to-secondary rounded-xl p-8 text-white text-center">
            <h2 className="text-2xl font-bold mb-3">
              Prêt à commencer ?
            </h2>
            <p className="opacity-90 mb-6">
              Rejoignez des centaines de familles en {island} qui font confiance à EduKaraib.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                to="/search"
                className="bg-white text-primary font-bold px-8 py-3 rounded-full hover:bg-gray-100 transition"
              >
                Trouver un professeur
              </Link>
              <Link
                to="/register"
                className="border-2 border-white text-white font-bold px-8 py-3 rounded-full hover:bg-white hover:text-primary transition"
              >
                Créer un compte gratuit
              </Link>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
