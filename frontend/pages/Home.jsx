import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { signOut } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function Home() {
  const user = auth.currentUser;
  const [featuredProfs, setFeaturedProfs] = useState([]);

  // Chargement des professeurs en vedette
  useEffect(() => {
    const fetchProfs = async () => {
      const querySnap = await getDocs(collection(db, 'teachers'));
      const profs = querySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setFeaturedProfs(profs.slice(0, 3)); // Affiche 3 profs
    };
    fetchProfs();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      window.location.reload();
    } catch (error) {
      alert('Erreur de déconnexion : ' + error.message);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-white to-gray-50">
      <Navbar />

      {/* Hero Section */}
      <header className="flex-1 flex flex-col justify-center items-center py-16 px-4">
        <h1 className="text-4xl md:text-5xl font-bold text-primary mb-4">
          Bienvenue sur <span className="text-secondary">EduKaraib</span>
        </h1>
        <p className="text-lg text-gray-700 max-w-xl text-center mb-8">
          Plateforme guyanaise de soutien scolaire et de mise en relation entre élèves, parents et professeurs particuliers. <br />
          Simple, locale, adaptée à tous les besoins.
        </p>

        {user ? (
          <div className="mt-4">
            <p className="text-gray-800 mb-2">Connecté en tant que : <strong>{user.email}</strong></p>
            <button onClick={handleLogout} className="btn-primary">
              Se déconnecter
            </button>
          </div>
        ) : (
          <div className="flex gap-4 mt-4">
            <Link to="/login" className="btn-primary">Se connecter</Link>
            <Link to="/register" className="btn-primary bg-secondary text-white hover:bg-yellow-500">S'inscrire</Link>
          </div>
        )}
      </header>

      {/* CTA Section */}
      <section className="bg-white py-12 text-center px-4 border-t shadow-sm">
        <h2 className="text-2xl font-semibold mb-4 text-primary">Commencez à apprendre dès maintenant</h2>
        <Link
          to="/search"
          className="inline-block bg-primary hover:bg-primary-dark text-white font-medium py-3 px-6 rounded shadow transition"
        >
          Trouver un professeur
        </Link>
      </section>

      {/* Profs en vedette */}
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