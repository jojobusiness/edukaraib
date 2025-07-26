import React from 'react';
import { Link } from 'react-router-dom';
import { auth } from '../lib/firebase';
import { signOut } from 'firebase/auth';

export default function Home() {
  const user = auth.currentUser;

  const handleLogout = async () => {
    try {
      await signOut(auth);
      window.location.reload();
    } catch (error) {
      alert('Erreur de déconnexion : ' + error.message);
    }
  };

  return (
    <div>
      <h1>Bienvenue sur EduKaraib</h1>
      {user ? (
        <div>
          <p>Connecté en tant que : {user.email}</p>
          <button onClick={handleLogout}>Se déconnecter</button>
        </div>
      ) : (
        <div>
          <Link to="/login">Se connecter</Link> |{' '}
          <Link to="/register">S'inscrire</Link>
        </div>
      )}
    </div>
  );
}