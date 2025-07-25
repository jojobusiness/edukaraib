import React from 'react';

export default function Register() {
  return (
    <div>
      <h2>Inscription</h2>
      <form>
        <input type="text" placeholder="Nom complet" /><br />
        <input type="email" placeholder="Email" /><br />
        <input type="password" placeholder="Mot de passe" /><br />
        <select>
          <option value="student">Élève</option>
          <option value="parent">Parent</option>
          <option value="teacher">Professeur</option>
        </select><br />
        <button type="submit">S'inscrire</button>
      </form>
    </div>
  );
}
