import React, { useEffect, useState, useMemo } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Link, useNavigate } from 'react-router-dom';

export default function Search() {
  const [teachers, setTeachers] = useState([]);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  // ── Filtres ─────────────────────────────────────────
  const [level, setLevel] = useState('');       // Primaire/Collège/Lycée/Supérieur/Adulte
  const [city, setCity] = useState('');         // Cayenne, etc.
  const [priceMin, setPriceMin] = useState(''); // numérique
  const [priceMax, setPriceMax] = useState('');
  const [sortBy, setSortBy] = useState('');     // '', 'priceAsc','priceDesc','ratingDesc'
  const [mode, setMode]   = useState('');       // '', 'visio', 'presentiel'

  // Bouton Retour : dashboard si connecté, sinon accueil
  const handleBack = () => {
    if (auth.currentUser) navigate('/smart-dashboard');
    else navigate('/');
  };

  useEffect(() => {
    const fetchTeachers = async () => {
      const qy = query(collection(db, 'users'), where('role', '==', 'teacher'));
      const querySnapshot = await getDocs(qy);
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTeachers(data);
    };
    fetchTeachers();
  }, []);

  // Helpers
  const parsePrice = (raw) => {
    const n = typeof raw === 'string' ? Number(raw.replace(',', '.')) : Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const getSubjectsText = (subs) => {
    if (Array.isArray(subs)) return subs.join(' ');
    if (typeof subs === 'string') return subs;
    return '';
  };
  const hasLevel = (teacher, targetLevel) => {
    if (!targetLevel) return true;
    const lv = teacher.level || teacher.levels || teacher.teaching_levels;
    if (Array.isArray(lv)) return lv.includes(targetLevel);
    if (typeof lv === 'string') return lv.toLowerCase().includes(targetLevel.toLowerCase());
    return false;
  };
  const matchesMode = (teacher, m) => {
    if (!m) return true;
    const online   = !!(teacher.mode_online ?? teacher.online ?? teacher.visio);
    const inperson = !!(teacher.mode_inperson ?? teacher.presentiel ?? teacher.in_person);
    if (m === 'visio') return online === true;
    if (m === 'presentiel') return inperson === true;
    return true;
  };
  const matchesCity = (teacher, c) => {
    if (!c) return true;
    const tCity = (teacher.city || teacher.location || '').toLowerCase();
    return tCity.includes(c.toLowerCase());
  };

  // 1) Filtrage de base (toujours actif, même sans recherche texte)
  const baseFiltered = useMemo(() => {
    const min = priceMin ? Number(priceMin) : null;
    const max = priceMax ? Number(priceMax) : null;

    let list = teachers.filter((t) => {
      if (!hasLevel(t, level)) return false;
      if (!matchesCity(t, city)) return false;
      if (!matchesMode(t, mode)) return false;

      const p = parsePrice(t.price_per_hour || t.price);
      if (min != null && (p == null || p < min)) return false;
      if (max != null && (p == null || p > max)) return false;

      return true;
    });

    // tri
    if (sortBy) {
      const priceOf = (x) => parsePrice(x.price_per_hour || x.price);
      if (sortBy === 'priceAsc') {
        list = list.slice().sort((a, b) => (priceOf(a) ?? 1e9) - (priceOf(b) ?? 1e9));
      } else if (sortBy === 'priceDesc') {
        list = list.slice().sort((a, b) => (priceOf(b) ?? -1e9) - (priceOf(a) ?? -1e9));
      } else if (sortBy === 'ratingDesc') {
        const ra = t => Number(t.avgRating ?? t.rating ?? 0);
        list = list.slice().sort((a, b) => ra(b) - ra(a));
      }
    }

    return list;
  }, [teachers, level, city, mode, priceMin, priceMax, sortBy]);

  // 2) Si recherche texte, on découpe baseFiltered en "Résultats" vs "Autres"
  const q = search.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [];
    return baseFiltered.filter((t) => {
      const name  = (t.fullName || '').toLowerCase();
      const subs  = getSubjectsText(t.subjects).toLowerCase();
      const tCity = (t.city || t.location || '').toLowerCase();
      const bio   = (t.bio || '').toLowerCase();
      return name.includes(q) || subs.includes(q) || tCity.includes(q) || bio.includes(q);
    });
  }, [baseFiltered, q]);

  const others = useMemo(() => {
    if (!q) return baseFiltered;                 // ⬅️ sans recherche : on affiche la liste filtrée complète
    const ids = new Set(results.map(r => r.id)); // ⬅️ avec recherche : “Autres” = filtrés – résultats
    return baseFiltered.filter(t => !ids.has(t.id));
  }, [baseFiltered, results, q]);

  // Compteurs / libellés
  const resultsCount = (q ? results.length : others.length);
  const subjectLabel = q ? search.trim() : 'Professeurs particuliers';

  const toggleMode = (target) => setMode(prev => (prev === target ? '' : target));

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-blue-50">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={handleBack}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-sm"
          >
            <span aria-hidden>←</span> Retour
          </button>

          <div className="flex-1 max-w-3xl">
            <div className="flex rounded-xl border border-gray-300 overflow-hidden bg-white">
              <input
                type="text"
                placeholder="Ex : Guitare, Maths, Anglais…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full px-4 py-2 outline-none"
              />
              <button
                className="px-4 py-2 text-sm font-semibold bg-primary text-white hover:bg-primary/90"
                onClick={() => {}}
                aria-label="Rechercher"
              >
                Rechercher
              </button>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <button
              onClick={() => toggleMode('visio')}
              className={`px-3 py-1.5 rounded-full text-sm border ${mode==='visio' ? 'bg-primary text-white border-primary' : 'bg-white hover:bg-gray-50 border-gray-200'}`}
            >
              Visio
            </button>
            <button
              onClick={() => toggleMode('presentiel')}
              className={`px-3 py-1.5 rounded-full text-sm border ${mode==='presentiel' ? 'bg-primary text-white border-primary' : 'bg-white hover:bg-gray-50 border-gray-200'}`}
            >
              Présentiel
            </button>
          </div>
        </div>
      </div>

      {/* Header titre/compteur */}
      <div className="max-w-6xl mx-auto px-4 pt-6">
        <h1 className="text-2xl md:text-3xl font-semibold bg-gradient-to-r from-indigo-600 to-pink-500 text-transparent bg-clip-text">
          {subjectLabel} en {city || 'France'}
        </h1>
        <p className="text-gray-600 mt-1">{resultsCount} prof(s) disponible(s)</p>
      </div>

      {/* Grille : sidebar filtres + résultats */}
      <div className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Sidebar filtres */}
        <aside className="md:col-span-4 lg:col-span-3">
          <div className="md:sticky md:top-20 space-y-4">
            <section className="bg-gradient-to-br from-white to-indigo-50 rounded-2xl border border-indigo-100 shadow-md p-4 hover:shadow-lg transition">
              <h3 className="font-semibold mb-3">Mode</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setMode('')}
                   className={`px-3 py-1.5 rounded-full text-sm border transition ${
                      mode===''
                        ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white border-indigo-400 shadow-sm'
                        : 'bg-white hover:bg-indigo-50 border-gray-200 text-gray-700'
                    }`}
                >
                  Tous
                </button>
                <button
                  onClick={() => toggleMode('visio')}
                   className={`px-3 py-1.5 rounded-full text-sm border transition ${
                      mode==='visio'
                        ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white border-indigo-400 shadow-sm'
                        : 'bg-white hover:bg-indigo-50 border-gray-200 text-gray-700'
                    }`}
                >
                  Visio
                </button>
                <button
                  onClick={() => toggleMode('presentiel')}
                  className={`px-3 py-1.5 rounded-full text-sm border transition ${
                      mode==='présentiel'
                        ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white border-indigo-400 shadow-sm'
                        : 'bg-white hover:bg-indigo-50 border-gray-200 text-gray-700'
                    }`}
                >
                  Présentiel
                </button>
              </div>
            </section>

            <section className="bg-gradient-to-br from-white to-indigo-50 rounded-2xl border border-indigo-100 shadow-md p-4 hover:shadow-lg transition">
              <h3 className="font-semibold mb-3">Niveau</h3>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              >
                <option value="">Tous niveaux</option>
                <option value="Primaire">Primaire</option>
                <option value="Collège">Collège</option>
                <option value="Lycée">Lycée</option>
                <option value="Supérieur">Supérieur</option>
                <option value="Adulte">Adulte</option>
              </select>
            </section>

            <section className="bg-gradient-to-br from-white to-indigo-50 rounded-2xl border border-indigo-100 shadow-md p-4 hover:shadow-lg transition">
              <h3 className="font-semibold mb-3">Ville</h3>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              >
                <option value="">{'Toute la France'}</option>
                {Array.from(new Set(teachers.map(t => (t.city || t.location || '').trim()).filter(Boolean))).sort().map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </section>

            <section className="bg-gradient-to-br from-white to-indigo-50 rounded-2xl border border-indigo-100 shadow-md p-4 hover:shadow-lg transition">
              <h3 className="font-semibold mb-3">Tarif horaire</h3>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="Min €"
                  className="w-1/2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={priceMin}
                  onChange={(e) => setPriceMin(e.target.value)}
                />
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="Max €"
                  className="w-1/2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={priceMax}
                  onChange={(e) => setPriceMax(e.target.value)}
                />
              </div>
            </section>

            <section className="bg-gradient-to-br from-white to-indigo-50 rounded-2xl border border-indigo-100 shadow-md p-4 hover:shadow-lg transition">
              <h3 className="font-semibold mb-3">Trier par</h3>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="">Pertinence</option>
                <option value="ratingDesc">Meilleure note</option>
                <option value="priceAsc">Prix croissant</option>
                <option value="priceDesc">Prix décroissant</option>
              </select>
            </section>
          </div>
        </aside>

        {/* Résultats */}
        <main className="md:col-span-8 lg:col-span-9">
          {/* Si recherche saisie : montrer “Résultats” d’abord */}
          {q && (
            <section className="mb-6">
              {results.length === 0 ? (
                <div className="bg-white border rounded-2xl p-8 text-center text-gray-500">
                  Aucun professeur trouvé pour cette recherche.
                </div>
              ) : (
                <div className="space-y-4">
                  {results.map((teacher) => (
                    <TeacherCard key={teacher.id} teacher={teacher} navigate={navigate} />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Liste générale */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Autres professeurs</h2>
            {others.length === 0 ? (
              <div className="bg-white border rounded-2xl p-8 text-center text-gray-500">
                Aucun professeur disponible.
              </div>
            ) : (
              <div className="space-y-4">
                {others.map((teacher) => (
                  <TeacherCard key={teacher.id} teacher={teacher} navigate={navigate} />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

// ───────────────────────── Carte professeur ─────────────────────────
function TeacherCard({ teacher, navigate }) {
  // prix final = prix prof + 10 €
  const finalHourlyPrice = (() => {
    const raw = teacher?.price_per_hour || teacher?.price;
    const n = typeof raw === 'string' ? Number(raw.replace(',', '.')) : Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return n + 10;
  })();

  const subjectsText = Array.isArray(teacher.subjects)
    ? teacher.subjects.join(', ')
    : (teacher.subjects || 'Matière non précisée');

  const isVisio = !!(teacher.mode_online ?? teacher.online ?? teacher.visio);
  const isPres  = !!(teacher.mode_inperson ?? teacher.presentiel ?? teacher.in_person);

  const rating = Number(teacher.avgRating ?? teacher.rating ?? 0);
  const reviewsCount = Number(teacher.reviewsCount ?? teacher.totalReviews ?? 0);

  const handleContact = async () => {
    if (!auth.currentUser) {
      navigate('/login');
      return;
    }
    const receiverUid = teacher.id || teacher.uid;
    if (!receiverUid) {
      alert("Profil professeur invalide.");
      return;
    }
    navigate(`/chat/${receiverUid}`);
  };

  return (
    <div className="bg-gradient-to-br from-white to-indigo-50 rounded-2xl border border-indigo-100 shadow-md p-4 md:p-5 flex gap-4 hover:shadow-lg transition-all duration-200 hover:-translate-y-[2px]">
      <div className="shrink-0">
        <img
          src={teacher.avatarUrl || "/avatar-default.png"}
          alt={teacher.fullName || "Prof"}
          className="w-24 h-24 md:w-28 md:h-28 rounded-2xl object-cover border"
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-lg md:text-xl bg-gradient-to-r from-indigo-600 to-pink-500 text-transparent bg-clip-text">{teacher.fullName || 'Professeur'}</h3>
          {rating > 0 && (
            <span className="inline-flex items-center gap-1 text-sm text-amber-600 font-semibold">
              ★ {rating.toFixed(1)} <span className="text-gray-400 font-normal">({reviewsCount})</span>
            </span>
          )}
        </div>

        <div className="text-gray-700 mt-1">{subjectsText}</div>
        <div className="mt-1 text-xs text-gray-500">
          {(teacher.city || teacher.location || 'Guyane')}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {isVisio && <span className="px-2 py-1 rounded-full text-xs border border-gray-300 bg-gray-50">Visio</span>}
          {isPres  && <span className="px-2 py-1 rounded-full text-xs border border-gray-300 bg-gray-50">Présentiel</span>}
          {Array.isArray(teacher.levels) && teacher.levels.slice(0,3).map((lv) => (
            <span key={lv} className="px-2 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/20">
              {lv}
            </span>
          ))}
        </div>

        <p className="mt-2 text-sm text-gray-600 line-clamp-2">{teacher.bio}</p>
      </div>

      <div className="shrink-0 flex flex-col items-end justify-between">
        <div className="text-right">
          {finalHourlyPrice == null ? (
            <span className="inline-block text-sm text-amber-700 font-semibold">Prix non précisé</span>
          ) : (
            <>
              <div className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-pink-500 text-transparent bg-clip-text">
                {finalHourlyPrice.toFixed(0)}<span className="text-base text-gray-700 font-medium"> €</span>
              </div>
              <div className="text-xs text-gray-500">/ heure</div>
            </>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <Link
            to={`/profils/${teacher.id}`}
            className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-black text-center"
          >
            Voir profil
          </Link>
          <button
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90"
            onClick={handleContact}
          >
            Contacter
          </button>
        </div>
      </div>
    </div>
  );
}