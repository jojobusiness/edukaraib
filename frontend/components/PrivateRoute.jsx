import React from 'react';
import { Navigate } from 'react-router-dom';
import { auth } from '../lib/firebase';

export default function PrivateRoute({ children }) {
  const user = auth.currentUser;

  if (!user) {
    return <Navigate to="/login" />;
  }

  return children;
}