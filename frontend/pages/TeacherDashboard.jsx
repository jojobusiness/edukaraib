import React from 'react';
import { Link } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';

export default function TeacherDashboard() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-white via-gray-50 to-primary/5 px-4 py-10">
      <div className="w-full max-w-3xl">
        <DashboardLayout role="teacher">
        <h2 className="text-3xl font-bold text-primary mb-8 text-center font-sans tracking-tight">
          🎓 Espace Professeur
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <Link
            to="/prof/profile"
            className="flex flex-col items-center bg-white border border-primary/20 rounded-2xl shadow-lg p-8 hover:scale-105 transition group"
          >
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition">
              <span className="text-3xl text-primary">📝</span>
            </div>
            <span className="font-bold text-primary text-lg">Profil</span>
            <span className="text-xs text-gray-500 mt-1 text-center">Compléter/modifier mon profil</span>
          </Link>
          <Link
            to="/prof/lessons"
            className="flex flex-col items-center bg-white border border-secondary/20 rounded-2xl shadow-lg p-8 hover:scale-105 transition group"
          >
            <div className="w-16 h-16 rounded-full bg-secondary/10 flex items-center justify-center mb-4 group-hover:bg-secondary/20 transition">
              <span className="text-3xl text-secondary">📚</span>
            </div>
            <span className="font-bold text-primary text-lg">Cours</span>
            <span className="text-xs text-gray-500 mt-1 text-center">Gérer mes demandes de cours</span>
          </Link>
          <Link
            to="/prof/earnings"
            className="flex flex-col items-center bg-white border border-yellow-400/20 rounded-2xl shadow-lg p-8 hover:scale-105 transition group"
          >
            <div className="w-16 h-16 rounded-full bg-yellow-400/10 flex items-center justify-center mb-4 group-hover:bg-yellow-400/20 transition">
              <span className="text-3xl text-yellow-500">💰</span>
            </div>
            <span className="font-bold text-primary text-lg">Revenus</span>
            <span className="text-xs text-gray-500 mt-1 text-center">Voir mes revenus</span>
          </Link>
        </div>
        </DashboardLayout>
      </div>
    </div>
  );
}