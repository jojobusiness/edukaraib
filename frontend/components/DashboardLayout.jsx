import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';

const menusByRole = {
  student: [
    { label: 'Tableau de bord', path: '/dashboard-eleve', icon: '📊' },
    { label: 'Trouver un prof', path: '/search', icon: '🔎' },
    { label: 'Mes cours', path: '/my-courses', icon: '📚' },
    { label: 'Planning', path: '/dashboard-eleve/planning', icon: '🗓️' },
    { label: 'Messagerie', path: '/chat-list', icon: '💬' },
    { label: 'Mon profil', path: '/profile', icon: '👤' },
  ],
  parent: [
    { label: 'Tableau de bord', path: '/parent/dashboard', icon: '📊' },
    { label: 'Mes enfants', path: '/parent/children', icon: '👧' },
    { label: 'Cours réservés', path: '/parent/courses', icon: '📚' },
    { label: 'Planning', path: '/parent/planning', icon: '🗓️' },
    { label: 'Paiements', path: '/parent/payments', icon: '💳' },
    { label: 'Messagerie', path: '/chat-list', icon: '💬' },
    { label: 'Mon profil', path: '/profile', icon: '👤' },
  ],
  teacher: [
    { label: 'Tableau de bord', path: '/prof/dashboard', icon: '📊' },
    { label: 'Demandes de cours', path: '/prof/lessons', icon: '📚' },
    { label: 'Planning', path: '/prof/planning', icon: '🗓️' },
    { label: 'Revenus', path: '/prof/earnings', icon: '💰' },
    { label: 'Mes avis', path: '/prof/reviews', icon: '🌟' },
    { label: 'Messagerie', path: '/chat-list', icon: '💬' },
    { label: 'Profil', path: '/prof/profile', icon: '👤' },
  ]
};

export default function DashboardLayout({ children, role = 'student' }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const menuItems = menusByRole[role] || menusByRole.student;

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Sidebar */}
      <aside className={`fixed z-20 inset-y-0 left-0 w-64 bg-white border-r shadow-lg transform ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} transition-transform md:relative md:translate-x-0`}>
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-6 py-5 border-b">
            <Link to="/" className="text-2xl font-extrabold text-primary font-sans tracking-tight">EduKaraib</Link>
            <button className="md:hidden" onClick={() => setSidebarOpen(false)}>
              <X className="h-6 w-6 text-gray-600" />
            </button>
          </div>
          <nav className="flex-1 px-2 py-4">
            {menuItems.map(item => (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 mb-1 rounded-xl font-medium transition 
                  ${location.pathname === item.path ? 'bg-primary/10 text-primary font-bold' : 'text-gray-700 hover:bg-gray-100'}`}
                onClick={() => setSidebarOpen(false)}
              >
                <span className="text-lg">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </aside>

      {/* Overlay menu mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-30 z-10 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Topbar (mobile burger menu) */}
        <div className="md:hidden flex items-center justify-between bg-white p-4 shadow">
          <button onClick={() => setSidebarOpen(true)}>
            <Menu className="h-6 w-6 text-primary" />
          </button>
          <span className="font-bold text-primary">EduKaraib</span>
          <div style={{ width: 24 }} /> {/* Placeholder */}
        </div>
        <main className="flex-1 p-4 md:p-10">{children}</main>
      </div>
    </div>
  );
}