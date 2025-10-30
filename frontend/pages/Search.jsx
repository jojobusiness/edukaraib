import React, { useEffect, useState, useMemo } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Link, useNavigate } from 'react-router-dom';

export default function Search() {
  const [teachers, setTeachers] = useState([]);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  // ── Filtres ajoutés ─────────────────────────────────────────
  const [level, setLevel] = useState('');              // Primaire/Collège/Lycée/Supérieur/Adulte
  const [city, setCity] = useState('');                // Cayenne, etc.
  const [priceMin, setPriceMin] = useState('');        // numérique texte
  const [priceMax, setPriceMax] = useState('');
  const [sortBy, setSortBy] = useState('');            // '', 'priceAsc','priceDesc','ratingDesc'

  // Bouton Retour : dashboard si connecté, sinon accueil
  const handleBack = () => {
    if (auth.currentUser) {
      navigate('/smart-dashboard');
    } else {
      navigate('/');
    }
  };

  useEffect(() => {
    const fetchTeachers = async () => {
      // On ne prend que les users avec role teacher
      const qy = query(collection(db, 'users'), where('role', '==', 'teacher'));
      const querySnapshot = await getDocs(qy);
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTeachers(data);
    };
    fetchTeachers();
  }, []);

  // Helpers parsing
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
    const online = !!(teacher.mode_online ?? teacher.online ?? teacher.visio);
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

  // Cities disponibles (à partir des données)
  const cityOptions = useMemo(() => {
    const set = new Set();
    for (const t of teachers) {
      const c = (t.city || t.location || '').trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort();
  }, [teachers]);

  // Filtrage local (nom, matière, ville, bio) + filtres avancés
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = priceMin ? Number(priceMin) : null;
    const max = priceMax ? Number(priceMax) : null;

    let list = teachers.filter((teacher) => {
      // texte libre
      const name  = (teacher.fullName || '').toLowerCase();
      const subs  = getSubjectsText(teacher.subjects).toLowerCase();
      const tCity = (teacher.city || teacher.location || '').toLowerCase();
      const bio   = (teacher.bio || '').toLowerCase();
      const matchText = q
        ? (name.includes(q) || subs.includes(q) || tCity.includes(q) || bio.includes(q))
        : false; // si pas de recherche, on renvoie [] (même logique que code d'origine)

      if (q && !matchText) return false;

      // filtres
      if (!hasLevel(teacher, level)) return false;
      if (!matchesCity(teacher, city)) return false;

      const p = parsePrice(teacher.price_per_hour || teacher.price);
      if (min != null && (p == null || p < min)) return false;
      if (max != null && (p == null || p > max)) return false;

      return true;
    });

    // tri
    if (sortBy) {
      if (sortBy === 'priceAsc') {
        list = list.slice().sort((a, b) => (parsePrice(a.price_per_hour || a.price) ?? 1e9) - (parsePrice(b.price_per_hour || b.price) ?? 1e9));
      } else if (sortBy === 'priceDesc') {
        list = list.slice().sort((a, b) => (parsePrice(b.price_per_hour || b.price) ?? -1e9) - (parsePrice(a.price_per_hour || a.price) ?? -1e9));
      } else if (sortBy === 'ratingDesc') {
        const ra = t => Number(t.avgRating ?? t.rating ?? 0);
        list = list.slice().sort((a, b) => ra(b) - ra(a));
      }
    }

    return q ? list : []; // si pas de recherche, garder le comportement initial (section Résultats vide)
  }, [teachers, search, level, city, priceMin, priceMax, sortBy]);

  // Exclut les profs déjà dans les résultats filtrés pour la liste du bas
  const displayedTeachers =
    filtered.length > 0
      ? teachers.filter(t => !filtered.find(f => f.id === t.id))
      : teachers;

  return (
    <div className="min-h-screen flex flex-col items-center bg-gradient-to-br from-white via-gray-100 to-secondary/20 px-4 py-10">
      {/* Bouton Retour */}
      <div className="w-full max-w-2xl mb-4">
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white shadow-sm hover:bg-gray-50 transition text-sm font-medium"
        >
          <span aria-hidden>←</span> Retour
        </button>
      </div>

      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        <h2 className="text-2xl font-bold text-primary mb-6 text-center">Rechercher un professeur</h2>

        {/* Barre de recherche */}
        <input
          type="text"
          placeholder="Nom, matière, ville, bio..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-4 py-2 mb-4 focus:ring-2 focus:ring-primary outline-none transition"
        />

        {/* Filtres avancés */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
          <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="">Niveau</option>
            <option value="Primaire">Primaire</option>
            <option value="Collège">Collège</option>
            <option value="Lycée">Lycée</option>
            <option value="Supérieur">Supérieur</option>
            <option value="Adulte">Adulte</option>
          </select>

          <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          >
            <option value="">Ville</option>
            {cityOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <input
            type="number"
            min="0"
            inputMode="numeric"
            placeholder="Prix min €/h"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={priceMin}
            onChange={(e) => setPriceMin(e.target.value)}
          />
          <input
            type="number"
            min="0"
            inputMode="numeric"
            placeholder="Prix max €/h"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
          />
          <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="">Tri</option>
            <option value="ratingDesc">Meilleure note</option>
            <option value="priceAsc">Prix croissant</option>
            <option value="priceDesc">Prix décroissant</option>
          </select>
        </div>

        {/* Résultats de recherche */}
        {search.trim() && (
          <div className="mb-10">
            <h3 className="text-lg font-semibold text-secondary mb-2">Résultats</h3>
            <div className="grid grid-cols-1 gap-6">
              {filtered.length === 0 ? (
                <p className="text-center text-gray-400">Aucun professeur trouvé pour cette recherche.</p>
              ) : (
                filtered.map((teacher) => (
                  <TeacherCard key={teacher.id} teacher={teacher} navigate={navigate} />
                ))
              )}
            </div>
          </div>
        )}

        {/* Tous les profs */}
        <div>
          <h3 className="text-lg font-semibold text-primary mb-2">Tous les professeurs</h3>
          <div className="grid grid-cols-1 gap-6">
            {displayedTeachers.length === 0 ? (
              <p className="text-center text-gray-400">Aucun professeur disponible.</p>
            ) : (
              displayedTeachers.map((teacher) => (
                <TeacherCard key={teacher.id} teacher={teacher} navigate={navigate} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Carte stylée pour un prof
function TeacherCard({ teacher, navigate }) {
  // helper: prix final = prix prof + 10 €
  const finalHourlyPrice = (() => {
    const raw = teacher?.price_per_hour || teacher?.price;
    const n = typeof raw === 'string' ? Number(raw.replace(',', '.')) : Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return n + 10; // +10 € de frais de site, toujours
  })();

  const subjectsText = Array.isArray(teacher.subjects)
    ? teacher.subjects.join(', ')
    : (teacher.subjects || 'Matière non précisée');

  // Fonction pour contacter le prof (comme dans l'admin : /chat/<uid>)
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
    <div className="bg-white rounded-xl shadow-md border p-5 flex flex-col md:flex-row items-center gap-4">
      <img
        src={teacher.avatarUrl || "/avatar-default.png"}
        alt={teacher.fullName || "Prof"}
        className="w-20 h-20 rounded-full object-cover border-2 border-primary"
      />
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-lg text-primary">{teacher.fullName || 'Professeur'}</h3>
        <div className="text-gray-700 mb-1">{subjectsText}</div>
        <div className="text-xs text-gray-500 mb-1">{teacher.city || teacher.location || 'Guyane'}</div>
        <div className="text-sm text-gray-600 mb-2 line-clamp-2">{teacher.bio}</div>

        {finalHourlyPrice == null ? (
          <span className="inline-block text-yellow-700 font-semibold">
            Prix non précisé
          </span>
        ) : (
          <div className="flex flex-col">
            <span className="inline-block text-yellow-700 font-semibold">
              {finalHourlyPrice.toFixed(2)} € /h
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Link
          to={`/profils/${teacher.id}`}
          className="bg-primary text-white px-4 py-2 rounded-lg font-semibold shadow hover:bg-primary-dark transition text-center"
        >
          Voir profil
        </Link>
        <button
          className="bg-secondary text-white px-4 py-2 rounded-lg font-semibold shadow hover:bg-yellow-500 transition"
          onClick={handleContact}
        >
          Contacter
        </button>
      </div>
    </div>
  );
}