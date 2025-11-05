import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { collection, addDoc, query, where, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';

export default function ParentChildren() {
  const [children, setChildren] = useState([]);
  const [child, setChild] = useState({ full_name: '', birth_date: '', school_level: '' });
  const [editingId, setEditingId] = useState(null);
  const [editChild, setEditChild] = useState({ full_name: '', birth_date: '', school_level: '' });
  const [loading, setLoading] = useState(false);

  const fetchChildren = async () => {
    const q = query(collection(db, 'students'), where('parent_id', '==', auth.currentUser.uid));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    setChildren(data);
  };

  useEffect(() => {
    fetchChildren();
    // eslint-disable-next-line
  }, []);

  const handleChange = (e) => {
    setChild({ ...child, [e.target.name]: e.target.value });
  };

  const handleAddChild = async (e) => {
    e.preventDefault();
    setLoading(true);
    await addDoc(collection(db, 'students'), {
      ...child,
      parent_id: auth.currentUser.uid,
      created_at: new Date()
    });
    setChild({ full_name: '', birth_date: '', school_level: '' });
    await fetchChildren();
    setLoading(false);
  };

  // ---- MODIFICATION ----
  const startEdit = (c) => {
    setEditingId(c.id);
    setEditChild({ full_name: c.full_name, birth_date: c.birth_date, school_level: c.school_level });
  };

  const handleEditChange = (e) => {
    setEditChild({ ...editChild, [e.target.name]: e.target.value });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    setLoading(true);
    await updateDoc(doc(db, 'students', editingId), { ...editChild });
    setEditingId(null);
    setEditChild({ full_name: '', birth_date: '', school_level: '' });
    await fetchChildren();
    setLoading(false);
  };

  // ---- SUPPRESSION ----
  const handleDelete = async (id) => {
    if (window.confirm("Supprimer cet enfant ?")) {
      await deleteDoc(doc(db, 'students', id));
      await fetchChildren();
    }
  };

  return (
    <DashboardLayout role="parent">
      <div className="max-w-3xl mx-auto container-fluid py-4">
        <header className="mb-6">
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-emerald-500 bg-clip-text text-transparent">
            👧 Mes enfants
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Gérez les informations de vos enfants et accédez aux détails de leurs cours.
          </p>
        </header>

        {/* Liste */}
        <div className="mb-8">
          {children.length === 0 && (
            <div className="bg-white/80 backdrop-blur border rounded-2xl shadow-sm p-8 text-center">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center text-2xl mb-3">🧒</div>
              <div className="font-semibold text-gray-800">Aucun enfant enregistré</div>
              <p className="text-sm text-gray-500 mt-1">Ajoutez votre premier enfant via le formulaire ci-dessous.</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4">
            {children.map(c => (
              <div
                key={c.id}
                className="group bg-white border rounded-2xl shadow-sm p-5 hover:shadow-md transition-shadow flex items-center gap-4"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center text-2xl text-primary">
                  👦
                </div>

                <div className="flex-1">
                  {editingId === c.id ? (
                    <form className="flex flex-col gap-3" onSubmit={handleSaveEdit}>
                      <input
                        type="text"
                        name="full_name"
                        value={editChild.full_name}
                        onChange={handleEditChange}
                        className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        placeholder="Nom complet"
                        required
                      />
                      <input
                        type="date"
                        name="birth_date"
                        value={editChild.birth_date}
                        onChange={handleEditChange}
                        className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        required
                      />
                      <input
                        type="text"
                        name="school_level"
                        value={editChild.school_level}
                        onChange={handleEditChange}
                        className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        placeholder="ex : CM1"
                        required
                      />
                      <div className="flex gap-2 mt-2">
                        <button type="submit" className="inline-flex items-center gap-2 bg-primary text-white px-3 py-2 rounded-xl font-semibold shadow hover:bg-primary-dark active:scale-[.99] transition">
                          <span>💾</span> Enregistrer
                        </button>
                        <button type="button" className="inline-flex items-center gap-2 bg-gray-100 px-3 py-2 rounded-xl hover:bg-gray-200" onClick={() => setEditingId(null)}>
                          ❌ Annuler
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="flex flex-col">
                        <div className="font-bold text-gray-900 flex items-center gap-3">
                          <span className="truncate">{c.full_name}</span>
                          <Link
                            to={`/parent/children/${c.id}`}
                            className="inline-flex items-center text-xs font-semibold text-primary hover:text-primary-dark transition"
                          >
                            Voir détails →
                          </Link>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          <span className="inline-flex items-center gap-1">
                            🎓 <span>Niveau : {c.school_level || "?"}</span>
                          </span>
                          <span className="mx-2 text-gray-300">•</span>
                          <span className="inline-flex items-center gap-1">
                            🎂 <span>Né(e) le {c.birth_date || "?"}</span>
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {editingId !== c.id && (
                  <div className="flex flex-col gap-2">
                    <button
                      className="inline-flex items-center gap-2 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-xl font-semibold text-xs ring-1 ring-amber-200 hover:bg-amber-100"
                      onClick={() => startEdit(c)}
                    >
                      ✏️ Modifier
                    </button>
                    <button
                      className="inline-flex items-center gap-2 bg-rose-50 text-rose-700 px-3 py-1.5 rounded-xl font-semibold text-xs ring-1 ring-rose-200 hover:bg-rose-100"
                      onClick={() => handleDelete(c.id)}
                    >
                      🗑️ Supprimer
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Formulaire d'ajout */}
        <div className="bg-white/90 backdrop-blur border rounded-2xl shadow-sm p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="inline-flex w-8 h-8 items-center justify-center rounded-lg bg-secondary/20">➕</span>
            Ajouter un enfant
          </h3>

          <form className="space-y-4" onSubmit={handleAddChild}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block mb-1 text-sm font-medium text-gray-700">Nom complet</label>
                <input
                  type="text"
                  name="full_name"
                  value={child.full_name}
                  onChange={handleChange}
                  placeholder="Nom complet"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  required
                />
              </div>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Date de naissance</label>
                <input
                  type="date"
                  name="birth_date"
                  value={child.birth_date}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  required
                />
              </div>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Niveau scolaire</label>
                <input
                  type="text"
                  name="school_level"
                  value={child.school_level}
                  onChange={handleChange}
                  placeholder="ex : CM1"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="inline-flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-semibold shadow hover:bg-primary-dark active:scale-[.99] transition disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Ajout..." : "Ajouter"}
            </button>
          </form>
        </div>
      </div>
    </DashboardLayout>
  );
}