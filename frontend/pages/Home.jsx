import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { db } from '../lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

export default function Home() {
  const [featuredProfs, setFeaturedProfs] = useState([]);

  useEffect(() => {
    const fetchProfs = async () => {
      const querySnap = await getDocs(collection(db, 'teachers'));
      const profs = querySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setFeaturedProfs(profs.slice(0, 3));
    };
    fetchProfs();
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-white to-gray-50">
      <Navbar />

      {/* Illustration + Hero */}
      <header className="flex-1 flex flex-col items-center justify-center py-8 px-4">
        <img
          src="/frontend/pages/accueil.jpg"
          alt="Professeur et élève - EduKaraib"
          className="w-full max-w-md mx-auto mb-6 rounded-lg shadow"
        />
        <h1 className="text-4xl md:text-5xl font-bold text-primary mb-4 text-center">
          Bienvenue sur <span className="text-secondary">EduKaraib</span>
        </h1>
        <p className="text-lg text-gray-700 max-w-xl text-center mb-8">
          Plateforme guyanaise de soutien scolaire et de mise en relation entre élèves, parents et professeurs particuliers.<br />
          Simple, locale, adaptée à tous les besoins.
        </p>

        {/* Boutons d'action */}
        <div className="flex gap-4 mt-2">
          <Link to="/login" className="bg-primary text-white px-6 py-3 rounded shadow hover:bg-primary-dark text-lg font-medium transition">
            Se connecter
          </Link>
          <Link to="/register" className="bg-secondary text-white px-6 py-3 rounded shadow hover:bg-yellow-500 text-lg font-medium transition">
            S'inscrire
          </Link>
        </div>
      </header>

      {/* Section CTA */}
      <section className="bg-white py-12 text-center px-4 border-t shadow-sm">
        <h2 className="text-2xl font-semibold mb-4 text-primary">Commencez à apprendre dès maintenant</h2>
        <Link
          to="/search"
          className="inline-block bg-primary hover:bg-primary-dark text-white font-medium py-3 px-6 rounded shadow transition"
        >
          Trouver un professeur
        </Link>
      </section>

      {/* Professeurs en vedette */}
      <section className="py-12 px-6 bg-white border-t">
        <h2 className="text-2xl font-semibold text-center mb-6">👩‍🏫 Professeurs en vedette</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {featuredProfs.map((prof) => (
            <div key={prof.id} className="card text-center shadow-lg border border-gray-200 rounded-lg p-6 bg-white transition hover:scale-105">
              <img
                src={prof.avatarUrl || "/avatar-default.png"}
                alt={prof.fullName || "Professeur"}
                className="w-20 h-20 rounded-full mx-auto mb-3 object-cover border-2 border-primary"
              />
              <h3 className="text-lg font-bold">{prof.fullName || "Professeur"}</h3>
              <p className="text-gray-600">{prof.subjects || "Matière non spécifiée"} — {prof.location || "Ville"}</p>
              <Link
                to={`/profils/${prof.id}`}
                className="bg-primary text-white px-4 py-2 rounded mt-3 inline-block shadow hover:bg-primary-dark"
              >
                Voir profil
              </Link>
            </div>
          ))}
          {featuredProfs.length === 0 && (
            <div className="col-span-3 text-center text-gray-400">
              Aucun professeur mis en avant pour le moment.
            </div>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}