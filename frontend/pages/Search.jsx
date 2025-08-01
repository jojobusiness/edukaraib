import React, { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';

export default function Search() {
  const [teachers, setTeachers] = useState([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const fetchTeachers = async () => {
      const querySnapshot = await getDocs(collection(db, 'teachers'));
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTeachers(data);
    };
    fetchTeachers();
  }, []);

  // Filtrage local (nom, matière, ville, bio)
  const filtered = teachers.filter(teacher => {
    const q = query.toLowerCase();
    return (
      teacher.fullName?.toLowerCase().includes(q) ||
      teacher.subjects?.toLowerCase().includes(q) ||
      teacher.location?.toLowerCase().includes(q) ||
      teacher.bio?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen flex flex-col items-center bg-gradient-to-br from-white via-gray-100 to-secondary/20 px-4 py-10">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        <h2 className="text-2xl font-bold text-primary mb-6 text-center">Rechercher un professeur</h2>
        <input
          type="text"
          placeholder="Nom, matière, ville, bio..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-4 py-2 mb-8 focus:ring-2 focus:ring-primary outline-none transition"
        />

        <div className="grid grid-cols-1 gap-6">
          {filtered.length === 0 && (
            <p className="text-center text-gray-400">Aucun professeur trouvé pour cette recherche.</p>
          )}
          {filtered.map((teacher) => (
            <div key={teacher.id} className="bg-white rounded-xl shadow-md border p-5 flex flex-col md:flex-row items-center gap-4">
              <img
                src={teacher.avatarUrl || "/avatar-default.png"}
                alt={teacher.fullName || "Prof"}
                className="w-20 h-20 rounded-full object-cover border-2 border-primary"
              />
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-lg text-primary">{teacher.fullName}</h3>
                <div className="text-gray-700 mb-1">{teacher.subjects || "Matière non précisée"}</div>
                <div className="text-xs text-gray-500 mb-1">{teacher.location}</div>
                <div className="text-sm text-gray-600 mb-2 line-clamp-2">{teacher.bio}</div>
                <span className="inline-block text-yellow-700 font-semibold">
                  {teacher.price_per_hour ? `${teacher.price_per_hour} € /h` : "Prix non précisé"}
                </span>
              </div>
              <button className="bg-primary text-white px-4 py-2 rounded-lg font-semibold shadow hover:bg-primary-dark transition">
                Contacter
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}