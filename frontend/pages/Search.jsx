import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where, addDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Link, useNavigate } from 'react-router-dom';

export default function Search() {
  const [teachers, setTeachers] = useState([]);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchTeachers = async () => {
      // On ne prend que les users avec role teacher !
      const q = query(collection(db, 'users'), where('role', '==', 'teacher'));
      const querySnapshot = await getDocs(q);
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTeachers(data);
    };
    fetchTeachers();
  }, []);

  // Filtrage local (nom, matière, ville, bio)
  const filtered = search.trim()
    ? teachers.filter(teacher => {
        const q = search.toLowerCase();
        return (
          teacher.fullName?.toLowerCase().includes(q) ||
          teacher.subjects?.toLowerCase().includes(q) ||
          teacher.city?.toLowerCase().includes(q) ||
          teacher.bio?.toLowerCase().includes(q)
        );
      })
    : [];

  // Exclut les profs déjà dans les résultats filtrés pour la liste du bas
  const displayedTeachers =
    filtered.length > 0
      ? teachers.filter(t => !filtered.find(f => f.id === t.id))
      : teachers;

  return (
    <div className="min-h-screen flex flex-col items-center bg-gradient-to-br from-white via-gray-100 to-secondary/20 px-4 py-10">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        <h2 className="text-2xl font-bold text-primary mb-6 text-center">Rechercher un professeur</h2>
        <input
          type="text"
          placeholder="Nom, matière, ville, bio..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-4 py-2 mb-8 focus:ring-2 focus:ring-primary outline-none transition"
        />

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
    const raw = teacher?.price_per_hour;
    const n = typeof raw === 'string' ? Number(raw.replace(',', '.')) : Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return n + 10; // +10 € de frais de site, toujours
  })();

  // Fonction pour contacter le prof
  // Fonction pour contacter le prof (comme dans l'admin : /chat/<uid>)
  const handleContact = async () => {
    if (!auth.currentUser) {
      navigate('/login');
      return;
    }
    // on utilise l'UID Firebase stocké en doc.id dans "users"
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
        <h3 className="font-bold text-lg text-primary">{teacher.fullName}</h3>
        <div className="text-gray-700 mb-1">{teacher.subjects || "Matière non précisée"}</div>
        <div className="text-xs text-gray-500 mb-1">{teacher.city}</div>
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