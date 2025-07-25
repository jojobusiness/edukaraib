import React from 'react';
import { Link } from 'react-router-dom';

export default function Navbar() {
  return (
    <nav>
      <h1>EduKaraib</h1>
      <ul>
        <li><Link to="/">Accueil</Link></li>
        <li><Link to="/search">Rechercher</Link></li>
        <li><Link to="/login">Connexion</Link></li>
        <li><Link to="/register">Inscription</Link></li>
      </ul>
    </nav>
  );
}
