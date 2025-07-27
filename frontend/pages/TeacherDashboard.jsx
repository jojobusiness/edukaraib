import React from 'react';
import { Link } from 'react-router-dom';

export default function TeacherDashboard() {
  return (
    <div>
      <h2>Tableau de bord Professeur 👩‍🏫</h2>
      <ul>
        <li><Link to="/prof/profile">📝 Compléter / Modifier mon profil</Link></li>
        <li><Link to="/prof/lessons">📚 Gérer mes demandes de cours</Link></li>
        <li><Link to="/prof/earnings">💰 Voir mes revenus</Link></li>
      </ul>
    </div>
  );
}