import React from 'react';
import { Link } from 'react-router-dom';

export default function StudentDashboard() {
  return (
    <div>
      <h2>Tableau de bord Élève</h2>
      <ul>
        <li><Link to="/profile">Mon profil</Link></li>
        <li><Link to="/search">Rechercher un professeur</Link></li>
        <li><Link to="/my-courses">Mes cours réservés</Link></li>
      </ul>
    </div>
  );
}