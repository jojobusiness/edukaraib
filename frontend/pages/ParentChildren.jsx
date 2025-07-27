import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';

export default function ParentChildren() {
  const [children, setChildren] = useState([]);
  const [child, setChild] = useState({ full_name: '', birth_date: '', school_level: '' });

  const fetchChildren = async () => {
    const q = query(collection(db, 'students'), where('parent_id', '==', auth.currentUser.uid));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    setChildren(data);
  };

  useEffect(() => {
    fetchChildren();
  }, []);

  const handleChange = (e) => {
    setChild({ ...child, [e.target.name]: e.target.value });
  };

  const handleAddChild = async (e) => {
    e.preventDefault();
    await addDoc(collection(db, 'students'), {
      ...child,
      parent_id: auth.currentUser.uid,
      created_at: new Date()
    });
    setChild({ full_name: '', birth_date: '', school_level: '' });
    fetchChildren();
  };

  return (
    <div>
      <h2>Mes enfants</h2>
      <ul>
        {children.map(c => (
          <li key={c.id}>{c.full_name} — {c.school_level}</li>
        ))}
      </ul>

      <h3>Ajouter un enfant</h3>
      <form onSubmit={handleAddChild}>
        <input type="text" name="full_name" value={child.full_name} onChange={handleChange} placeholder="Nom complet" required />
        <input type="date" name="birth_date" value={child.birth_date} onChange={handleChange} required />
        <input type="text" name="school_level" value={child.school_level} onChange={handleChange} placeholder="Niveau scolaire" required />
        <button type="submit">Ajouter</button>
      </form>
    </div>
  );
}