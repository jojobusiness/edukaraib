import React from 'react';
import { Link } from 'react-router-dom';

export default function StudentDashboard() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-white via-gray-50 to-primary/5 px-4 py-10">
      <div className="w-full max-w-3xl">
        <h2 className="text-3xl font-bold text-primary mb-8 text-center font-sans tracking-tight">
          👋 Bienvenue sur ton espace élève
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <Link
            to="/profile"
            className="flex flex-col items-center bg-white border border-primary/20 rounded-2xl shadow-lg p-8 hover:scale-105 transition group"
          >
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition">
              <span className="text-3xl text-primary">👤</span>
            </div>
            <span className="font-bold text-primary text-lg">Mon profil</span>
            <span className="text-xs text-gray-500 mt-1 text-center">Gérer mes infos et photo</span>
          </Link>
          <Link
            to="/search"
            className="flex flex-col items-center bg-white border border-secondary/20 rounded-2xl shadow-lg p-8 hover:scale-105 transition group"
          >
            <div className="w-16 h-16 rounded-full bg-secondary/10 flex items-center justify-center mb-4 group-hover:bg-secondary/20 transition">
              <span className="text-3xl text-secondary">🔎</span>
            </div>
            <span className="font-bold text-primary text-lg">Trouver un prof</span>
            <span className="text-xs text-gray-500 mt-1 text-center">Chercher et contacter un enseignant</span>
          </Link>
          <Link
            to="/my-courses"
            className="flex flex-col items-center bg-white border border-yellow-400/20 rounded-2xl shadow-lg p-8 hover:scale-105 transition group"
          >
            <div className="w-16 h-16 rounded-full bg-yellow-400/10 flex items-center justify-center mb-4 group-hover:bg-yellow-400/20 transition">
              <span className="text-3xl text-yellow-500">📚</span>
            </div>
            <span className="font-bold text-primary text-lg">Mes cours</span>
            <span className="text-xs text-gray-500 mt-1 text-center">Voir mes réservations et planning</span>
          </Link>
        </div>
      </div>
    </div>
  );
}