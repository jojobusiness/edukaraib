import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      // Récupération du rôle depuis Firestore
      const userDoc = await getDoc(doc(db, 'users', uid));
      if (!userDoc.exists()) {
        alert("Aucun profil trouvé. Contactez l'administrateur.");
        return;
      }

      const role = userDoc.data().role;

      // Redirection en fonction du rôle
      switch (role) {
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
  };

  return (
    <div>
      <h2>Connexion</h2>
      <form onSubmit={handleLogin}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required /><br />
        <input type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} required /><br />
        <button type="submit">Se connecter</button>
      </form>
    </div>
  );
}