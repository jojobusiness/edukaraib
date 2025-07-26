import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

export default function Profile() {
  const [profile, setProfile] = useState({ fullName: '', phone: '' });

  useEffect(() => {
    const fetchData = async () => {
      const docRef = doc(db, 'users', auth.currentUser.uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setProfile(docSnap.data());
      }
    };
    fetchData();
  }, []);

  const handleChange = (e) => {
    setProfile({ ...profile, [e.target.name]: e.target.value });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const docRef = doc(db, 'users', auth.currentUser.uid);
    await updateDoc(docRef, {
      fullName: profile.fullName,
      phone: profile.phone,
    });
    alert('Profil mis à jour !');
  };

  return (
    <div>
      <h2>Mon Profil</h2>
      <form onSubmit={handleSave}>
        <input type="text" name="fullName" value={profile.fullName} onChange={handleChange} placeholder="Nom complet" required />
        <input type="text" name="phone" value={profile.phone} onChange={handleChange} placeholder="Téléphone" />
        <button type="submit">Enregistrer</button>
      </form>
    </div>
  );
}