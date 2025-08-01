import React, { useEffect, useState } from 'react';
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
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">👧 Mes enfants</h2>
        <div className="mb-8">
          {children.length === 0 && (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
              Aucun enfant enregistré pour le moment.
            </div>
          )}
          <div className="grid grid-cols-1 gap-4">
            {children.map(c => (
              <div key={c.id} className="bg-white p-5 rounded-xl shadow border flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-2xl text-primary">
                  👦
                </div>
                <div className="flex-1">
                  {editingId === c.id ? (
                    <form className="flex flex-col gap-2" onSubmit={handleSaveEdit}>
                      <input
                        type="text"
                        name="full_name"
                        value={editChild.full_name}
                        onChange={handleEditChange}
                        className="border border-gray-300 rounded-lg px-3 py-1 text-sm"
                        required
                      />
                      <input
                        type="date"
                        name="birth_date"
                        value={editChild.birth_date}
                        onChange={handleEditChange}
                        className="border border-gray-300 rounded-lg px-3 py-1 text-sm"
                        required
                      />
                      <input
                        type="text"
                        name="school_level"
                        value={editChild.school_level}
                        onChange={handleEditChange}
                        className="border border-gray-300 rounded-lg px-3 py-1 text-sm"
                        required
                      />
                      <div className="flex gap-2 mt-2">
                        <button type="submit" className="bg-primary text-white px-3 py-1 rounded font-semibold shadow">Enregistrer</button>
                        <button type="button" className="bg-gray-200 px-3 py-1 rounded" onClick={() => setEditingId(null)}>Annuler</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="flex flex-col">
                        <div className="font-bold text-primary flex items-center gap-2">
                          {c.full_name}
                          <Link
                            to={`/parent/children/${c.id}`}
                            className="text-primary underline text-xs ml-2"
                          >
                            Voir détails
                          </Link>
                        </div>
                        <div className="text-xs text-gray-500">
                          Niveau : {c.school_level || "?"} &nbsp; | &nbsp;
                          Né(e) le {c.birth_date || "?"}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                {editingId !== c.id && (
                  <div className="flex flex-col gap-2">
                    <button className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded font-semibold text-xs hover:bg-yellow-200" onClick={() => startEdit(c)}>Modifier</button>
                    <button className="bg-red-100 text-red-700 px-3 py-1 rounded font-semibold text-xs hover:bg-red-200" onClick={() => handleDelete(c.id)}>Supprimer</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow border mt-8">
          <h3 className="text-lg font-bold text-secondary mb-3">Ajouter un enfant</h3>
          <form className="space-y-3" onSubmit={handleAddChild}>
            <div>
              <label className="block mb-1 text-sm font-medium text-gray-700">Nom complet</label>
              <input
                type="text"
                name="full_name"
                value={child.full_name}
                onChange={handleChange}
                placeholder="Nom complet"
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
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
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
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
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                required
              />
            </div>
            <button
              type="submit"
              className="bg-primary text-white px-5 py-2 rounded font-semibold shadow hover:bg-primary-dark transition"
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