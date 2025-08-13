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
  // Fonction pour contacter le prof
  const handleContact = async () => {
    if (!auth.currentUser) {
      navigate('/login');
      return;
    }

    const userId = auth.currentUser.uid;
    const teacherUid = teacher.uid;

    // Vérifie s'il existe déjà une conversation (participants = [userId, teacherId] OU [teacherId, userId])
    const convRef = collection(db, 'conversations');
    // Recherche toutes les convos où les participants incluent l'utilisateur connecté
    const q = query(convRef, where('participants', 'array-contains', userId));
    const snap = await getDocs(q);
    // On cherche si une des conversations a aussi le prof comme participant
    let existing = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .find(conv =>
        conv.participants.includes(teacherUid)
      );
    let convId = null;
    if (existing) {
      convId = existing.id;
    } else {
      // Sinon on crée une nouvelle conversation
      const convDoc = await addDoc(convRef, {
        participants: [userId, teacherUid],
        created_at: new Date()
      });
      convId = convDoc.id;
    }
    // Redirige vers la conversation
    navigate(`/chat/${teacherUid}`);
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
        <span className="inline-block text-yellow-700 font-semibold">
          {teacher.price_per_hour ? `${teacher.price_per_hour} € /h` : "Prix non précisé"}
        </span>
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