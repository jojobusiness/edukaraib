import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { db, auth } from '../lib/firebase';
import { collection, getDocs, doc, getDoc, query, orderBy, limit, where } from 'firebase/firestore';

export default function Home() {
  const navigate = useNavigate();

  // ── Redirection admin si connecté ─────────────────────────────
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

  // ── Barre de recherche ────────────────────────────────────────
  const [qSubject, setQSubject] = useState('');
  const [qCity, setQCity] = useState('');
  const [qLevel, setQLevel] = useState('');

  const onSearch = (e) => {
    e?.preventDefault?.();
    const params = new URLSearchParams();
    if (qSubject.trim()) params.set('subject', qSubject.trim());
    if (qCity.trim()) params.set('city', qCity.trim());
    if (qLevel.trim()) params.set('level', qLevel.trim());
    navigate(`/search?${params.toString()}`);
  };

  // ── Professeurs ───────────────────────────────────────────────
  const [teachers, setTeachers] = useState([]);
  const [loadingTeachers, setLoadingTeachers] = useState(true);
  const [teacherMap, setTeacherMap] = useState(new Map());

  useEffect(() => {
    const run = async () => {
      setLoadingTeachers(true);
      try {
        // 1) Essai principal : collection `teachers`
        const tSnap = await getDocs(collection(db, 'teachers'));
        let all = tSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // 2) Fallback : `users` where role=='teacher'
        if (!Array.isArray(all) || all.length === 0) {
          const qUsersTeachers = query(
            collection(db, 'users'),
            where('role', '==', 'teacher'),
            limit(100)
          );
          const uSnap = await getDocs(qUsersTeachers);
          all = uSnap.docs.map((d) => {
            const u = d.data();
            return {
              id: d.id,
              ...u,
              fullName:
                u.fullName ||
                u.name ||
                [u.firstName, u.lastName].filter(Boolean).join(' ') ||
                'Professeur',
              avatarUrl: u.avatarUrl || u.photoURL,
              location: u.city || u.location,
              subjects: Array.isArray(u.subjects) ? u.subjects : [],
              price_per_hour: u.price_per_hour || u.price,
              rating: u.rating,
            };
          });
        }

        // Tri : mieux notés à gauche (>=4.7), autres en aléatoire
        const withMeta = (all || []).map((p) => ({
          ...p,
          _rating: Number(p.avgRating ?? p.rating ?? 0),
        }));
        const top = withMeta.filter((p) => p._rating >= 4.7).sort((a, b) => b._rating - a._rating);
        const rest = withMeta.filter((p) => p._rating < 4.7);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        const arranged = [...top, ...rest];

        setTeachers(arranged);
        const map = new Map();
        arranged.forEach((t) => map.set(t.id, t));
        setTeacherMap(map);
      } catch (e) {
        console.error('Chargement des profs échoué:', e);
        setTeachers([]);
      } finally {
        setLoadingTeachers(false);
      }
    };
    run();
  }, []);

  // ── Avis (réels) ─────────────────────────────────────────────
  const [reviews, setReviews] = useState([]);
  const [hasRealReviews, setHasRealReviews] = useState(false);

  useEffect(() => {
    const run = async () => {
      try {
        const qReviews = query(
          collection(db, 'reviews'),
          orderBy('created_at', 'desc'),
          limit(12)
        );
        let list = (await getDocs(qReviews)).docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((r) => (r.comment?.trim()?.length ?? 0) > 0 && Number(r.rating) > 0);

        // Enrichir avec users/{user_id} si nom/avatar manquent
        list = await Promise.all(
          list.map(async (r) => {
            if (!(r.fullName || r.userName || r.reviewerName || r.userAvatar || r.photoURL)) {
              const reviewerId = r.user_id || r.student_id || r.parent_id;
              if (reviewerId) {
                try {
                  const us = await getDoc(doc(db, 'users', reviewerId));
                  if (us.exists()) {
                    const u = us.data();
                    r.fullName =
                      r.fullName ||
                      u.fullName ||
                      u.name ||
                      [u.firstName, u.lastName].filter(Boolean).join(' ') ||
                      'Utilisateur';
                    r.userAvatar = r.userAvatar || u.avatarUrl || u.photoURL;
                  }
                } catch {}
              }
            }
            return r;
          })
        );

        setReviews(list);
        setHasRealReviews((list?.length || 0) > 0);
      } catch (e) {
        console.error('Chargement des avis échoué:', e);
        setHasRealReviews(false);
      }
    };
    run();
  }, []);

  // ── Catégories / Villes ──────────────────────────────────────
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
    () => [
      'Cayenne',
      'Kourou',
      'Matoury',
      'Rémire-Montjoly',
      'Saint-Laurent-du-Maroni',
      'Mana',
      'Maripasoula',
    ],
    []
  );

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Navbar />

      {/* HERO */}
      <header className="relative isolate overflow-hidden">
        {/* Image desktop uniquement */}
        <img
          src="/hero-promo-2026.png"
          alt="Offre nouvelle année EduKaraib"
          className="hidden lg:block absolute inset-0 h-full w-full object-cover"
        />

        {/* Overlay flou desktop uniquement */}
        <div className="hidden lg:block absolute inset-0 bg-white/60 backdrop-blur-sm" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-28">
          {/* Image mobile visible (pas en background) */}
          <div className="lg:hidden mb-6">
            <img
              src="/hero-promo-2026.png"
              alt="Offre nouvelle année EduKaraib"
              className="w-full h-56 sm:h-64 object-cover rounded-2xl"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
            <div>
              <span className="inline-block mb-4 px-4 py-2 rounded-full bg-primary text-white text-sm font-semibold">
                🎓 Offre nouvelle année – Guyane
              </span>

              <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900">
                Commencez l’année scolaire
                <span className="block text-primary">avec les bons professeurs</span>
              </h1>

              <p className="mt-4 text-lg text-gray-700 max-w-xl">
                1 à 2 heures de cours offertes avec nos packs de soutien scolaire.
                Professeurs locaux, présentiel ou visio.
              </p>

              <ul className="mt-6 space-y-2 text-gray-700">
                <li>✔ Professeurs vérifiés en Guyane</li>
                <li>✔ Présentiel ou visio</li>
                <li>✔ Packs économiques pour l’année</li>
              </ul>
            </div>

            <div className="bg-white/95 backdrop-blur rounded-3xl shadow-xl border border-gray-100 p-4 md:p-6 mt-6 lg:mt-12">
              <form onSubmit={onSearch} className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <input
                  className="border rounded-2xl px-4 py-3 w-full text-base md:text-lg"
                  placeholder="Quelle matière ? (ex: Mathématiques)"
                  value={qSubject}
                  onChange={(e) => setQSubject(e.target.value)}
                />
                <input
                  className="border rounded-2xl px-4 py-3 w-full text-base md:text-lg"
                  placeholder="Ville / commune (ex: Cayenne)"
                  value={qCity}
                  onChange={(e) => setQCity(e.target.value)}
                />
                <select
                  className="border rounded-2xl px-4 py-3 w-full text-base md:text-lg text-gray-700"
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
                  className="bg-primary hover:bg-primary-dark text-white font-semibold rounded-2xl px-6 py-3 text-base md:text-lg"
                >
                  Rechercher
                </button>
              </form>

              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-600">
                <span className="inline-flex items-center gap-2"><span className="text-xl">⭐</span> Avis vérifiés</span>
                <span className="inline-flex items-center gap-2"><span className="text-xl">🔒</span> Paiement sécurisé</span>
                <span className="inline-flex items-center gap-2"><span className="text-xl">⚡</span> Réservation rapide</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* PROFESSEURS */}
      <section className="py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-end justify-between mb-6">
            <h2 className="text-2xl font-bold">Nos professeurs</h2>
            <Link to="/search" className="text-primary hover:underline">Tout voir</Link>
          </div>

          {loadingTeachers ? (
            <div className="py-12 text-center text-gray-500">Chargement des professeurs…</div>
          ) : teachers.length === 0 ? (
            <div className="py-12 text-center text-gray-400">Aucun professeur pour le moment.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
              {teachers.map((prof) => (
                <Link
                  key={prof.id}
                  to={`/profils/${prof.id}`}
                  className="group border rounded-2xl overflow-hidden bg-white hover:shadow-xl transition"
                >
                  <div className="aspect-square bg-gray-100 overflow-hidden">
                    <img
                      src={prof.avatarUrl || prof.photoURL || '/avatar-default.png'}
                      alt={prof.fullName || 'Professeur'}
                      className="h-full w-full object-cover group-hover:scale-105 transition"
                    />
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold truncate">{prof.fullName || 'Professeur'}</h3>
                      {Number(prof.avgRating ?? prof.rating) > 0 && (
                        <span className="text-sm text-amber-600">{Number(prof.avgRating ?? prof.rating)}★</span>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-gray-600 truncate">
                      {Array.isArray(prof.subjects) && prof.subjects.length > 0
                        ? prof.subjects.join(', ')
                        : prof.main_subject || 'Matière non spécifiée'}
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      {prof.location || prof.city || 'Guyane'}
                    </div>
                    {prof.price_per_hour && (
                      <div className="mt-2 font-semibold">
                        {(Number(prof.price_per_hour) + 10).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} / h
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ───────────────────────── CATÉGORIES POPULAIRES ───────────────────────── */}
      <section className="py-10 bg-gray-50 border-t">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-end justify-between mb-6">
            <h2 className="text-2xl font-bold">Matières populaires</h2>
            <Link to="/search" className="text-primary hover:underline">Parcourir</Link>
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

      {/* ───────────────────────── COMMENT ÇA MARCHE ───────────────────────── */}
      <section className="py-12 bg-gray-50">
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
              <p className="text-gray-600 text-sm">Payez en ligne et retrouvez votre cours au bon moment.</p>
            </div>
          </div>
        </div>
      </section>

      {/* COMMENTAIRES réels seulement */}
      {hasRealReviews && (
        <section className="py-12 bg-white">
          <div className="max-w-7xl mx-auto px-4">
            <h2 className="text-2xl font-bold mb-6">Ils nous font confiance</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {reviews.slice(0, 6).map((r) => {
                const t = r.teacher_id ? teacherMap.get(r.teacher_id) : null;
                const reviewerName = r.fullName || r.userName || r.reviewerName || t?.fullName || t?.name || 'Utilisateur';
                const reviewerAvatar =
                  r.userAvatar ||
                  r.avatarUrl ||
                  r.photoURL ||
                  (r.user_id && teacherMap.get(r.user_id)?.avatarUrl) || // récupère la vraie photo de l’auteur si stockée
                  (r.student_id && teacherMap.get(r.student_id)?.avatarUrl) ||
                  (r.parent_id && teacherMap.get(r.parent_id)?.avatarUrl) ||
                  '/avatar-default.png';
                const stars = '★★★★★'.slice(0, Math.round(Number(r.rating) || 0));
                return (
                  <div
                    key={r.id}
                    className="group border rounded-2xl overflow-hidden bg-white hover:shadow-xl transition"
                  >
                    <div className="aspect-[4/3] bg-gray-100 overflow-hidden">
                      <img
                        src={reviewerAvatar}
                        alt={reviewerName}
                        className="h-full w-full object-cover group-hover:scale-105 transition"
                      />
                    </div>
                    <div className="p-5">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <h3 className="font-semibold text-primary truncate">{reviewerName}</h3>
                        <span className="text-sm text-amber-600">{stars}</span>
                      </div>
                      <p className="text-gray-700 text-sm leading-relaxed italic">
                        “{r.comment}”
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="py-12 bg-primary text-white">
        <div className="max-w-7xl mx-auto px-4 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <div className="space-y-2">
            <h3 className="text-2xl font-bold">Vous cherchez un professeur ?</h3>
            <p className="text-white/90">Parcourez les profils et réservez en quelques clics.</p>
          </div>
          <div className="flex gap-3 md:justify-end">
            <Link to="/search" className="bg-white text-primary font-semibold px-5 py-3 rounded-xl hover:bg-white/90">Trouver un prof</Link>
            <Link to="/register" className="bg-yellow-300 text-black font-semibold px-5 py-3 rounded-xl hover:bg-yellow-400 transition">S'inscrire</Link>
          </div>
        </div>
      </section>

      {/* FAQ + À propos */}
      <section className="py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4 grid grid-cols-1 lg:grid-cols-3 gap-10">
          <div className="lg:col-span-2">
            <h2 className="text-2xl font-bold mb-4">Cours particuliers en Guyane : questions fréquentes</h2>
            <details className="border rounded-xl p-4 mb-3">
              <summary className="cursor-pointer font-semibold">Quels sont les tarifs moyens d'un cours ?</summary>
              <p className="mt-2 text-gray-600 text-sm">Les tarifs varient selon la matière, le niveau et l'expérience du professeur. Les prix sont fixés par les professeurs.</p>
            </details>
            <details className="border rounded-xl p-4 mb-3">
              <summary className="cursor-pointer font-semibold">Puis-je avoir un cours en visio ?</summary>
              <p className="mt-2 text-gray-600 text-sm">Les visios sont officiellement disponibles ! Connectez-vous dès maintenant et profitez pleinement de la fonctionnalité.</p>
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