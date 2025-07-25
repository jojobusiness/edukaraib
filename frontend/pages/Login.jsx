import React from 'react';

export default function Login() {
  return (
    <div>
      <h2>Connexion</h2>
      <form>
        <input type="email" placeholder="Email" /><br />
        <input type="password" placeholder="Mot de passe" /><br />
        <button type="submit">Se connecter</button>
      </form>
    </div>
  );
}
