import React, { useState } from 'react';
import { auth, db } from '../lib/firebase';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { useNavigate, Link } from 'react-router-dom';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export default function Register() {
  const [form, setForm] = useState({
    email: '', password: '', fullName: '', role: 'student',
    phone: '', city: '', level: '', birth: '', subjects: '', diploma: '', bio: ''
  });
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = e => setForm({ ...form, [e.target.name]: e.target.value });
  const handlePhoto = e => setPhoto(e.target.files[0]);

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, form.email, form.password);
      const user = userCredential.user;

      // Upload photo si présente
      let avatarUrl = '';
      if (photo) {
        const storage = getStorage();
        const storageRef = ref(storage, `avatars/${user.uid}`);
        await uploadBytes(storageRef, photo);
        avatarUrl = await getDownloadURL(storageRef);
      }

      // Création doc Firestore
      const userData = {
        uid: user.uid,
        email: form.email,
        fullName: form.fullName,
        role: form.role,
        avatarUrl,
        createdAt: new Date(),
        phone: form.phone,
        city: form.city,
      };

      if (form.role === 'student') {
        userData.level = form.level;
        userData.birth = form.birth;
      } else if (form.role === 'teacher') {
        userData.subjects = form.subjects;
        userData.diploma = form.diploma;
        userData.bio = form.bio;
      }

      await setDoc(doc(db, 'users', user.uid), userData);

      // Redirection selon le rôle choisi
      switch (form.role) {
        case 'student':
          navigate('/dashboard-eleve');
          break;
        case 'parent':
          navigate('/parent/dashboard');
          break;
        case 'teacher':
          navigate('/prof/dashboard');
          break;
        default:
          alert("Rôle inconnu !");
      }
    } catch (error) {
      alert('Erreur: ' + error.message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-gradient-to-br from-white via-gray-100 to-secondary/30 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        <div className="flex flex-col items-center mb-6">
          <img src="/edukaraib_logo.png" alt="Logo EduKaraib" className="h-14 mb-3" />
          <h2 className="text-2xl font-bold text-primary mb-1">Inscription</h2>
          <p className="text-gray-600 text-center text-sm">
            Crée ton compte gratuitement et trouve le prof qu’il te faut en Guyane !
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleRegister}>
          {/* Photo */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Photo de profil</label>
            <input
              type="file"
              accept="image/*"
              onChange={handlePhoto}
              className="w-full text-sm"
            />
          </div>
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Nom complet</label>
            <input
              type="text"
              name="fullName"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
              value={form.fullName}
              onChange={handleChange}
              required
            />
          </div>
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              name="email"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
              value={form.email}
              onChange={handleChange}
              required
            />
          </div>
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Mot de passe</label>
            <input
              type="password"
              name="password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
              value={form.password}
              onChange={handleChange}
              required
            />
          </div>
          {/* Rôle */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Je suis :</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
              name="role"
              value={form.role}
              onChange={handleChange}
            >
              <option value="student">Élève</option>
              <option value="parent">Parent</option>
              <option value="teacher">Professeur</option>
            </select>
          </div>
          {/* Infos spécifiques */}
          {form.role === 'student' && (
            <>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Niveau scolaire</label>
                <input
                  type="text"
                  name="level"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="ex : Seconde"
                  value={form.level}
                  onChange={handleChange}
                />
              </div>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Date de naissance</label>
                <input
                  type="date"
                  name="birth"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={form.birth}
                  onChange={handleChange}
                />
              </div>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Ville</label>
                <input
                  type="text"
                  name="city"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="ex : Cayenne"
                  value={form.city}
                  onChange={handleChange}
                />
              </div>
            </>
          )}
          {form.role === 'parent' && (
            <>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Téléphone</label>
                <input
                  type="tel"
                  name="phone"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="ex : 0694..."
                  value={form.phone}
                  onChange={handleChange}
                />
              </div>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Ville</label>
                <input
                  type="text"
                  name="city"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="ex : Kourou"
                  value={form.city}
                  onChange={handleChange}
                />
              </div>
            </>
          )}
          {form.role === 'teacher' && (
            <>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Téléphone</label>
                <input
                  type="tel"
                  name="phone"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="ex : 0694..."
                  value={form.phone}
                  onChange={handleChange}
                />
              </div>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Ville</label>
                <input
                  type="text"
                  name="city"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="ex : Matoury"
                  value={form.city}
                  onChange={handleChange}
                />
              </div>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Matières enseignées</label>
                <input
                  type="text"
                  name="subjects"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="ex : Maths, Physique"
                  value={form.subjects}
                  onChange={handleChange}
                />
              </div>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Diplômes</label>
                <input
                  type="text"
                  name="diploma"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="ex : Master Maths"
                  value={form.diploma}
                  onChange={handleChange}
                />
              </div>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Courte bio</label>
                <textarea
                  name="bio"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="Présentez-vous en quelques mots..."
                  value={form.bio}
                  onChange={handleChange}
                  rows={2}
                />
              </div>
            </>
          )}
          <button
            type="submit"
            className="w-full bg-primary text-white font-semibold py-2 rounded-lg shadow hover:bg-primary-dark transition disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Inscription..." : "S'inscrire"}
          </button>
        </form>
        <div className="mt-4 text-center text-sm text-gray-700">
          Déjà un compte ?{" "}
          <Link to="/login" className="text-primary font-semibold hover:underline">Se connecter</Link>
        </div>
      </div>
    </div>
  );
}