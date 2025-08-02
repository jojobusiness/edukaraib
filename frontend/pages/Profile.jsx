import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { signOut, sendPasswordResetEmail, deleteUser } from 'firebase/auth';
import TeacherAvailabilityEditor from '../components/TeacherAvailabilityEditor'; // à créer à côté

export default function Profile() {
  const [profile, setProfile] = useState({
    fullName: '', phone: '', city: '', bio: '', avatarUrl: '', level: '', birth: '', subjects: '', diploma: '', role: '', price_per_hour: '', availability: {}
  });
  const [avatarFile, setAvatarFile] = useState(null);
  const [loading, setLoading] = useState(false);

  // Charger le profil à l'ouverture
  useEffect(() => {
    const fetchData = async () => {
      const docRef = doc(db, 'users', auth.currentUser.uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setProfile({ ...profile, ...docSnap.data() });
      }
    };
    fetchData();
    // eslint-disable-next-line
  }, []);

  // Champs dynamiques selon le rôle
  const fields = [
    { name: 'fullName', label: 'Nom complet', required: true, type: 'text' },
    { name: 'phone', label: 'Téléphone', type: 'tel' },
    { name: 'city', label: 'Ville', type: 'text' },
  ];
  if (profile.role === 'student') {
    fields.push({ name: 'level', label: 'Niveau scolaire', type: 'text' });
    fields.push({ name: 'birth', label: 'Date de naissance', type: 'date' });
  }
  if (profile.role === 'teacher') {
    fields.push({ name: 'subjects', label: 'Matières enseignées', type: 'text' });
    fields.push({ name: 'diploma', label: 'Diplômes', type: 'text' });
    fields.push({ name: 'bio', label: 'Bio', type: 'textarea' });
    fields.push({ name: 'price_per_hour', label: "Prix à l'heure (€)", type: 'number', step: 1, min: 0 }); // Ajout du prix
  }

  // Gestion upload avatar
  const handlePhoto = (e) => {
    if (e.target.files[0]) setAvatarFile(e.target.files[0]);
  };

  const handleChange = (e) => {
    setProfile({ ...profile, [e.target.name]: e.target.value });
  };

  // Sauvegarde Firestore (et upload photo si besoin)
  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    let avatarUrl = profile.avatarUrl || '';
    if (avatarFile) {
      const storage = getStorage();
      const storageRef = ref(storage, `avatars/${auth.currentUser.uid}`);
      await uploadBytes(storageRef, avatarFile);
      avatarUrl = await getDownloadURL(storageRef);
    }

    const docRef = doc(db, 'users', auth.currentUser.uid);
    const toSave = { ...profile, avatarUrl };
    delete toSave.uid;

    await updateDoc(docRef, toSave);
    setProfile({ ...profile, avatarUrl });
    setLoading(false);
    alert('Profil mis à jour !');
  };

  // Déconnexion
  const handleLogout = async () => {
    await signOut(auth);
    window.location.href = "/";
  };

  // Mot de passe oublié
  const handleResetPassword = async () => {
    if (!profile.email) {
      alert("Pas d'adresse email trouvée.");
      return;
    }
    await sendPasswordResetEmail(auth, profile.email);
    alert("Un email de réinitialisation a été envoyé.");
  };

  // Suppression du compte
  const handleDeleteAccount = async () => {
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer votre compte ? Cette action est irréversible.")) return;
    setLoading(true);
    try {
      // Suppression photo de profil dans Storage
      if (profile.avatarUrl) {
        try {
          const storage = getStorage();
          const avatarRef = ref(storage, `avatars/${auth.currentUser.uid}`);
          await deleteObject(avatarRef);
        } catch { /* ignore si l'image n'existe pas */ }
      }
      // Suppression du doc Firestore
      await deleteDoc(doc(db, "users", auth.currentUser.uid));
      // Suppression de l'utilisateur Auth
      await deleteUser(auth.currentUser);
      alert("Compte supprimé. À bientôt !");
      window.location.href = "/";
    } catch (error) {
      alert("Erreur lors de la suppression : " + error.message);
    }
    setLoading(false);
  };

  return (
    <DashboardLayout role={profile.role || 'student'}>
      <div className="w-full max-w-xl mx-auto bg-white rounded-2xl shadow-lg p-8 border border-gray-100 mt-6">
        <div className="flex flex-col items-center mb-6">
          <div className="w-24 h-24 rounded-full bg-gray-100 overflow-hidden mb-3 shadow border-2 border-primary">
            <img
              src={profile.avatarUrl || "/avatar-default.png"}
              alt="Photo de profil"
              className="w-full h-full object-cover"
            />
          </div>
          <input
            type="file"
            accept="image/*"
            onChange={handlePhoto}
            className="block text-xs mb-1"
          />
        </div>
        <h2 className="text-2xl font-bold text-primary mb-4 text-center">Mon Profil</h2>
        <form className="space-y-4" onSubmit={handleSave}>
          {fields.map(f => (
            <div key={f.name}>
              <label className="block mb-1 text-sm font-medium text-gray-700">{f.label}</label>
              {f.type === 'textarea' ? (
                <textarea
                  name={f.name}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={profile[f.name] || ''}
                  onChange={handleChange}
                  rows={2}
                />
              ) : (
                <input
                  type={f.type}
                  name={f.name}
                  step={f.step}
                  min={f.min}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={profile[f.name] || ''}
                  onChange={handleChange}
                  required={f.required}
                />
              )}
            </div>
          ))}
          {/* Ajout du sélecteur de disponibilité uniquement pour les profs */}
          {profile.role === 'teacher' && (
            <TeacherAvailabilityEditor
              value={profile.availability || {}}
              onChange={avail => setProfile({ ...profile, availability: avail })}
            />
          )}
          <button
            type="submit"
            className="w-full bg-primary text-white font-semibold py-2 rounded-lg shadow hover:bg-primary-dark transition disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Enregistrement..." : "Enregistrer"}
          </button>
        </form>

        <div className="mt-8 flex flex-col gap-2">
          <button
            onClick={handleLogout}
            className="w-full bg-gray-200 text-gray-700 font-semibold py-2 rounded-lg hover:bg-gray-300 transition"
          >
            Se déconnecter
          </button>
          <button
            onClick={handleResetPassword}
            className="w-full bg-yellow-100 text-yellow-800 font-semibold py-2 rounded-lg hover:bg-yellow-200 transition"
          >
            Changer de mot de passe
          </button>
          <button
            onClick={handleDeleteAccount}
            className="w-full bg-red-100 text-red-800 font-semibold py-2 rounded-lg hover:bg-red-200 transition"
            disabled={loading}
          >
            Supprimer mon compte
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}