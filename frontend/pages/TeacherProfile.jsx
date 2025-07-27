import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export default function TeacherProfile() {
  const [profile, setProfile] = useState({
    bio: '',
    diploma: '',
    price_per_hour: '',
    location: '',
    available_days: '',
    subjects: ''
  });

  useEffect(() => {
    const loadProfile = async () => {
      const ref = doc(db, 'teachers', auth.currentUser.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) setProfile(snap.data());
    };
    loadProfile();
  }, []);

  const handleChange = (e) => {
    setProfile({ ...profile, [e.target.name]: e.target.value });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    await setDoc(doc(db, 'teachers', auth.currentUser.uid), {
      ...profile,
      user_id: auth.currentUser.uid,
    });
    alert('Profil enseignant mis à jour.');
  };

  return (
    <div>
      <h2>Profil Professeur</h2>
      <form onSubmit={handleSave}>
        <textarea name="bio" value={profile.bio} onChange={handleChange} placeholder="Bio" required />
        <input name="diploma" value={profile.diploma} onChange={handleChange} placeholder="Diplôme" required />
        <input name="price_per_hour" type="number" value={profile.price_per_hour} onChange={handleChange} placeholder="Prix / heure" required />
        <input name="location" value={profile.location} onChange={handleChange} placeholder="Ville" required />
        <input name="available_days" value={profile.available_days} onChange={handleChange} placeholder="Disponibilités" />
        <input name="subjects" value={profile.subjects} onChange={handleChange} placeholder="Matières (séparées par virgule)" />
        <button type="submit">Enregistrer</button>
      </form>
    </div>
  );
}