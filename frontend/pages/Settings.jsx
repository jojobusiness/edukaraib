import React, { useEffect, useState } from 'react';
import { auth } from '../lib/firebase';

export default function Settings() {
  const user = auth.currentUser;

  return (
    <div>
      <h2>Paramètres du compte</h2>
      {user && (
        <ul>
          <li>Email : {user.email}</li>
          <li>UID : {user.uid}</li>
          <li>Changer de mot de passe : <a href="#" onClick={() => auth.sendPasswordResetEmail(user.email)}>Réinitialiser</a></li>
        </ul>
      )}
    </div>
  );
}