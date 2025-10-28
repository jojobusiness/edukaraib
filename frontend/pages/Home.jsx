import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { db, auth } from '../lib/firebase';
import { collection, getDocs, doc, getDoc, query, limit, orderBy } from 'firebase/firestore';

/**
 * Page d'accueil inspirée de Superprof, adaptée à EduKaraib
 * - Hero avec barre de recherche (matière/ville/niveau)
 * - Marques de confiance + chiffres clés
 * - Catégories populaires
 * - Professeurs en vedette (tirés de Firestore: teachers)
 * - Fonctionnement en 3 étapes
 * - Témoignages (mock)
 * - FAQ SEO + texte éditorial
 */

export default function Home() {
  const navigate = useNavigate();

  // --- Redirection auto si admin connecté ---
  useEffect(() => {
    const checkRole = async () => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        const role = snap.exists() ? snap.data()?.role : null;
        if (role === 'admin') navigate('/admin/dashboard');
      } catch (e) {
        console.warn('Role check failed', e);
      }
    };
    checkRole();
  }, [navigate]);

  // --- Recherche contrôlée ---
  const [qSubject, setQSubject] = useState('');
  const [qCity, setQCity] = useState('');
  const [qLevel, setQLevel] = useState('');

  const onSearch = (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (qSubject.trim()) params.set('subject', qSubject.trim());
    if (qCity.trim()) params.set('city', qCity.trim());
    if (qLevel.trim()) params.set('level', qLevel.trim());
    navigate(`/search?${params.toString()}`);
  };

  // --- Profs en vedette ---
  const [featuredProfs, setFeaturedProfs] = useState([]);
  const [loadingProfs, setLoadingProfs] = useState(true);

  useEffect(() => {
    const run = async () => {
      try {
        const qTeachers = query(collection(db, 'teachers'), orderBy('created_at', 'desc'));
        const snap = await getDocs(qTeachers);
        const profs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // Trier par note si présente, sinon par date
        const sorted = profs
          .map((p) => ({
            ...p,
            _rating: Number(p.rating || p.avgRating || 0),
            _price: Number(p.price_per_hour || p.price || 0),
          }))
          .sort((a, b) => b._rating - a._rating);
        setFeaturedProfs(sorted.slice(0, 8));
      } finally {
        setLoadingProfs(false);
      }
    };
    run();
  }, []);

  // --- Catégories populaires (locales) ---
  const categories = useMemo(
    () => [
      { slug: 'maths', label: 'Mathématiques', emoji: '📐' },
      { slug: 'francais', label: 'Français', emoji: '📖' },
      { slug: 'anglais', label: 'Anglais', emoji: '🗣️' },
      { slug: 'physique', label: 'Physique-Chimie', emoji: '⚗️' },
      { slug: 'creole', label: 'Créole', emoji: '🌴' },
      { slug: 'svt', label: 'SVT', emoji: '🧬' },
      { slug: 'informatique', label: 'Informatique', emoji: '💻' },
      { slug: 'musique', label: 'Musique', emoji: '🎶' },
    ],
    []
  );

  const cities = useMemo(
    () => ['Cayenne', 'Kourou', 'Matoury', 'Rémire-Montjoly', 'Saint-Laurent-du-Maroni', 'Mana', 'Maripasoula'],
    []
  );

  /* =========================
   * ⬇️ AJOUT MINIMAL POUR AVIS ⬇️
   * ========================= */
  const [reviews, setReviews] = useState([]);
  const [hasRealReviews, setHasRealReviews] = useState(false);

  useEffect(() => {
    // Charger de VRAIS avis (avec commentaire + note)
    const loadReviews = async () => {
      try {
        const qReviews = query(collection(db, 'reviews'), orderBy('created_at', 'desc'), limit(9));
        const snap = await getDocs(qReviews);
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((r) => (r.comment?.trim()?.length ?? 0) > 0 && Number(r.rating) > 0);
        setReviews(list);
        setHasRealReviews(list.length > 0);
      } catch (e) {
        console.warn('Load reviews failed', e);
        setHasRealReviews(false);
      }
    };
    loadReviews();
  }, []);
  /* =========================
   * ⬆️ FIN AJOUT AVIS ⬆️
   * ========================= */

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Navbar />

      {/* HERO */}
      <header className="relative isolate overflow-hidden">
        <img
          src="/accueil.jpg"
          alt="Élève et professeur - EduKaraib"
          className="absolute inset-0 h-full w-full object-cover opacity-20"
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20">
          <div className="max-w-2xl">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900">
              Trouvez le meilleur prof <span className="text-primary">près de chez vous</span>
            </h1>
            <p className="mt-4 text-lg text-gray-600">
              Cours particuliers en Guyane : soutien scolaire, langues, musique, informatique et plus encore.
            </p>

            {/* Barre de recherche */}
            <form onSubmit={onSearch} className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-3 bg-white/90 p-3 rounded-2xl shadow">
              <input
                className="border rounded-xl px-3 py-3 w-full"
                placeholder="Quelle matière ? (ex: Mathématiques)"
                value={qSubject}
                onChange={(e) => setQSubject(e.target.value)}
              />
              <input
                className="border rounded-xl px-3 py-3 w-full"
                placeholder="Ville / commune (ex: Cayenne)"
                value={qCity}
                onChange={(e) => setQCity(e.target.value)}
              />
              <select
                className="border rounded-xl px-3 py-3 w-full text-gray-700"
                value={qLevel}
                onChange={(e) => setQLevel(e.target.value)}
              >
                <option value="">Niveau</option>
                <option value="Primaire">Primaire</option>
                <option value="Collège">Collège</option>
                <option value="Lycée">Lycée</option>
                <option value="Supérieur">Supérieur</option>
                <option value="Adulte">Adulte</option>
              </select>
              <button
                type="submit"
                className="bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl px-4 py-3"
              >
                Rechercher
              </button>
            </form>

            {/* Badges de confiance */}
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-600">
              <span className="inline-flex items-center gap-2"><span className="text-xl">⭐</span> Avis vérifiés</span>
              <span className="inline-flex items-center gap-2"><span className="text-xl">🔒</span> Paiement sécurisé</span>
              <span className="inline-flex items-center gap-2"><span className="text-xl">⚡</span> Réservation rapide</span>
            </div>
          </div>
        </div>
      </header>

      {/* CATÉGORIES POPULAIRES */}
      <section className="py-10 bg-gray-50 border-t">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-end justify-between mb-6">
            <h2 className="text-2xl font-bold">Matières populaires</h2>
            <Link to="/search" className="text-primary hover:underline">Tout voir</Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {categories.map((c) => (
              <button
                key={c.slug}
                onClick={() => navigate(`/search?subject=${encodeURIComponent(c.label)}`)}
                className="group bg-white border rounded-2xl p-4 text-left hover:shadow transition"
              >
                <div className="text-2xl mb-2">{c.emoji}</div>
                <div className="font-semibold group-hover:text-primary">{c.label}</div>
                <div className="text-xs text-gray-500">Professeurs disponibles</div>
              </button>
            ))}
          </div>

          {/* Villes rapides */}
          <div className="mt-6 text-sm text-gray-600 flex flex-wrap gap-2">
            {cities.map((city) => (
              <button
                key={city}
                onClick={() => navigate(`/search?city=${encodeURIComponent(city)}`)}
                className="px-3 py-1 rounded-full bg-white border hover:border-primary hover:text-primary"
              >
                {city}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* PROFESSEURS EN VEDETTE */}
      <section className="py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-end justify-between mb-6">
            <h2 className="text-2xl font-bold">Professeurs en vedette</h2>
            <Link to="/search" className="text-primary hover:underline">Trouver un prof</Link>
          </div>

          {loadingProfs ? (
            <div className="py-12 text-center text-gray-500">Chargement des professeurs…</div>
          ) : featuredProfs.length === 0 ? (
            <div className="py-12 text-center text-gray-400">Aucun professeur pour le moment.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {featuredProfs.map((prof) => (
                <Link
                  key={prof.id}
                  to={`/profils/${prof.id}`}
                  className="group border rounded-2xl overflow-hidden bg-white hover:shadow-lg transition"
                >
                  <div className="aspect-[4/3] bg-gray-100 overflow-hidden">
                    <img
                      src={prof.avatarUrl || prof.photoURL || '/avatar-default.png'}
                      alt={prof.fullName || 'Professeur'}
                      className="h-full w-full object-cover group-hover:scale-105 transition"
                    />
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold truncate">{prof.fullName || 'Professeur'}</h3>
                      <span className="text-sm text-amber-600">{(prof.avgRating || prof.rating || '—')}★</span>
                    </div>
                    <div className="mt-1 text-sm text-gray-600 truncate">
                      {(prof.subjects && Array.isArray(prof.subjects) ? prof.subjects.join(', ') : prof.main_subject || 'Matière non spécifiée')}
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      {prof.location || prof.city || 'Guyane'}
                    </div>
                    {prof.price_per_hour && (
                      <div className="mt-2 font-semibold">{Number(prof.price_per_hour).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} / h</div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* COMMENT ÇA MARCHE */}
      <section className="py-12 bg-gray-50 border-t">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-2xl font-bold mb-6">Comment ça marche ?</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white border rounded-2xl p-6">
              <div className="text-3xl mb-3">🔎</div>
              <h3 className="font-semibold mb-1">1. Recherchez</h3>
              <p className="text-gray-600 text-sm">Filtrez par matière, ville, niveau et disponibilités pour trouver le bon prof.</p>
            </div>
            <div className="bg-white border rounded-2xl p-6">
              <div className="text-3xl mb-3">💬</div>
              <h3 className="font-semibold mb-1">2. Contactez</h3>
              <p className="text-gray-600 text-sm">Discutez gratuitement via la messagerie sécurisée pour préciser vos besoins.</p>
            </div>
            <div className="bg-white border rounded-2xl p-6">
              <div className="text-3xl mb-3">📅</div>
              <h3 className="font-semibold mb-1">3. Réservez</h3>
              <p className="text-gray-600 text-sm">Payez en ligne et retrouvez votre cours en présentiel.</p>
            </div>
          </div>
        </div>
      </section>

      {/* TÉMOIGNAGES (mock)  -> deviens "avis réels sinon rien" */}
      {hasRealReviews && (
        <section className="py-12 bg-white">
          <div className="max-w-7xl mx-auto px-4">
            <h2 className="text-2xl font-bold mb-6">Ils nous font confiance</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {reviews.slice(0, 6).map((r) => {
                // Nom/Avatar de la personne qui a RÉELLEMENT laissé l'avis
                const reviewerName =
                  r.fullName ||
                  r.userName ||
                  r.reviewerName ||
                  'Utilisateur';
                const reviewerAvatar =
                  r.userAvatar ||
                  r.avatarUrl ||
                  r.photoURL ||
                  '/avatar-default.png';
                const stars = '★★★★★'.slice(0, Math.round(Number(r.rating) || 0));
                return (
                  <div key={r.id} className="border rounded-2xl p-6 bg-white">
                    <div className="flex items-center gap-3 mb-3">
                      <img
                        src={reviewerAvatar}
                        alt={reviewerName}
                        className="w-10 h-10 rounded-full object-cover border"
                      />
                      <div>
                        <div className="font-semibold">{reviewerName}</div>
                        <div className="text-xs text-amber-600">{stars}</div>
                      </div>
                    </div>
                    <p className="text-gray-600 text-sm">
                      {r.comment}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* CTA DOUBLE */}
      <section className="py-12 bg-primary text-white">
        <div className="max-w-7xl mx-auto px-4 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <div className="space-y-2">
            <h3 className="text-2xl font-bold">Vous cherchez un professeur ?</h3>
            <p className="text-white/90">Parcourez les profils et réservez en quelques clics.</p>
          </div>
          <div className="flex gap-3 md:justify-end">
            <Link to="/search" className="bg-white text-primary font-semibold px-5 py-3 rounded-xl hover:bg-white/90">Trouver un prof</Link>
            <Link to="/register" className="bg-black/20 border border-white/40 font-semibold px-5 py-3 rounded-xl hover:bg-black/30">S'inscrire</Link>
          </div>
        </div>
      </section>

      {/* FAQ + TEXTE SEO */}
      <section className="py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4 grid grid-cols-1 lg:grid-cols-3 gap-10">
          <div className="lg:col-span-2">
            <h2 className="text-2xl font-bold mb-4">Cours particuliers en Guyane : questions fréquentes</h2>
            <details className="border rounded-xl p-4 mb-3">
              <summary className="cursor-pointer font-semibold">Quels sont les tarifs moyens d'un cours ?</summary>
              <p className="mt-2 text-gray-600 text-sm">Les tarifs varient selon la matière, le niveau et l'expérience du professeur. Les prix sont fixés par les professuers.</p>
            </details>
            <details className="border rounded-xl p-4 mb-3">
              <summary className="cursor-pointer font-semibold">Puis-je avoir un cours en visio ?</summary>
              <p className="mt-2 text-gray-600 text-sm">Les visios ne sont pas encore disponibles, nos équipes travaillent actuellement pour les rendre disponibles.</p>
            </details>
            <details className="border rounded-xl p-4">
              <summary className="cursor-pointer font-semibold">Comment sont gérés les paiements et remboursements ?</summary>
              <p className="mt-2 text-gray-600 text-sm">Le paiement est sécurisé. En cas de problème, un remboursement peut être demandé depuis votre espace, selon nos conditions.</p>
            </details>
          </div>

          <div className="bg-gray-50 border rounded-2xl p-6">
            <h3 className="font-semibold mb-2">À propos d'EduKaraib</h3>
            <p className="text-sm text-gray-700">
              EduKaraib est la plateforme locale de mise en relation entre élèves, parents et professeurs en Guyane. Notre mission : rendre l'accompagnement pédagogique accessible à tous, avec une attention particulière aux réalités du territoire.
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}