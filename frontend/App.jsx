import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './lib/firebase';

import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Profile from './pages/Profile';
import StudentDashboard from './pages/StudentDashboard';
import Search from './pages/Search';
import MyCourses from './pages/MyCourses';
import ParentDashboard from './pages/ParentDashboard';
import ParentChildren from './pages/ParentChildren';
import ParentCourses from './pages/ParentCourses';
import TeacherDashboard from './pages/TeacherDashboard';
import TeacherLessons from './pages/TeacherLessons';
import TeacherEarnings from './pages/TeacherEarnings';
import StudentCalendar from './pages/StudentCalendar';
import StudentPayments from './pages/StudentPayments';
import TeacherCalendar from './pages/TeacherCalendar';
import TeacherReviews from './pages/TeacherReviews';

import MessagesWrapper from './pages/MessagesWrapper';
import Messages from './pages/Messages';
import ChatList from './pages/ChatList';
import NotFound from './pages/NotFound';

import SmartDashboard from './pages/SmartDashboard';
import Unauthorized from './pages/Unauthorized';
import ParentPayments from './pages/ParentPayments';
import ParentCalendar from './pages/ParentCalendar';
import Settings from './pages/Settings';
import Contact from './pages/Contact';
import CGU from './pages/CGU';
import Privacy from './pages/Privacy';
import ChildDetails from './pages/ChildDetails';
import TeacherProfile from './pages/TeacherProfile';
import PaySuccess from './pages/pay/Success.jsx';
import PayCancel from './pages/pay/Cancel.jsx';
import BookLessonEleve from './pages/BookLessonEleve';

import TeacherRoute from './components/TeacherRoute';
import ParentRoute from './components/ParentRoute';
import ReviewForm from './components/ReviewForm';
import PrivateRoute from './components/PrivateRoute';
import StudentRoute from './components/StudentRoute';
import RequireRole from './routes/RequireRole';

import AdminDashboard from './pages/AdminDashboard';

/** Mémorise la dernière route visitée (pour revenir exactement au même endroit) */
function RouteMemory() {
  const location = useLocation();
  useEffect(() => {
    try {
      localStorage.setItem('lastRoute', location.pathname + location.search + location.hash);
    } catch {}
  }, [location]);
  return null;
}

/** Restaure la dernière route après un refresh / reconnexion (si l'user est connecté) */
function RestoreLastRoute() {
  const navigate = useNavigate();
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) return;
      const last = localStorage.getItem('lastRoute');
      // Évite de renvoyer vers login/register/unauthorized
      if (last && !['/login', '/register', '/unauthorized'].includes(last)) {
        navigate(last, { replace: true });
      }
    });
    return unsub;
  }, [navigate]);
  return null;
}

function App() {
  // ⏳ Très important : attendre la restauration Firebase AVANT d'afficher les routes
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, () => {
      setAuthReady(true);
    });
    return unsub;
  }, []);

  return (
    <Router>
      {/* On n’affiche les routes qu’après restauration de la session Firebase */}
      {!authReady ? (
        <div className="min-h-screen grid place-items-center text-gray-500">Chargement…</div>
      ) : (
        <>
          <RestoreLastRoute />
          <RouteMemory />
          <Routes>
            {/* Public */}
            <Route path="/" element={<Home />} />
            <Route path="/smart-dashboard" element={<SmartDashboard />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/profils/:teacherId" element={<TeacherProfile />} />
            <Route path="/unauthorized" element={<Unauthorized />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/cgu" element={<CGU />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/pay/success" element={<PaySuccess />} />
            <Route path="/pay/cancel" element={<PayCancel />} />

            {/* Protégées génériques */}
            <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>} />
            <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />

            {/* 💬 Messagerie */}
            <Route
              path="/chat"
              element={
                <RequireRole roles={['student','teacher','parent','admin']}>
                  <MessagesWrapper />
                </RequireRole>
              }
            />
            <Route
              path="/chat/:id"
              element={
                <RequireRole roles={['student','teacher','parent','admin']}>
                  <MessagesWrapper />
                </RequireRole>
              }
            />
            <Route
              path="/messages"
              element={
                <RequireRole roles={['student','teacher','parent','admin']}>
                  <Messages />
                </RequireRole>
              }
            />
            <Route
              path="/messages/:id"
              element={
                <RequireRole roles={['student','teacher','parent','admin']}>
                  <Messages />
                </RequireRole>
              }
            />
            <Route path="/chat-list" element={<PrivateRoute><ChatList /></PrivateRoute>} />

            {/* 🔍 Recherche */}
            <Route path="/search" element={<Search />} />

            {/* 🎓 Élève */}
            <Route path="/dashboard-eleve" element={<StudentRoute><StudentDashboard /></StudentRoute>} />
            <Route path="/my-courses" element={<StudentRoute><MyCourses /></StudentRoute>} />
            <Route path="/reviewform" element={<StudentRoute><ReviewForm /></StudentRoute>} />
            <Route path="/dashboard-eleve/planning" element={<StudentRoute><StudentCalendar /></StudentRoute>} />
            <Route
              path="/student/payments"
              element={<RequireRole roles={['student']}><StudentPayments /></RequireRole>}
            />
            <Route
              path="/book-lesson-eleve"
              element={
                <StudentRoute>
                  <BookLessonEleve teacherId="TEACHER_ID" subjectId="SUBJECT_ID" />
                </StudentRoute>
              }
            />

            {/* 👨‍👩‍👧 Parent */}
            <Route path="/parent/dashboard" element={<ParentRoute><ParentDashboard /></ParentRoute>} />
            <Route path="/parent/children" element={<ParentRoute><ParentChildren /></ParentRoute>} />
            <Route path="/parent/courses" element={<ParentRoute><ParentCourses /></ParentRoute>} />
            <Route path="/parent/children/:childId" element={<ParentRoute><ChildDetails /></ParentRoute>} />
            <Route path="/parent/payments" element={<ParentRoute><ParentPayments /></ParentRoute>} />
            <Route path="/parent/planning" element={<ParentRoute><ParentCalendar /></ParentRoute>} />

            {/* 👨‍🏫 Professeur */}
            <Route path="/prof/dashboard" element={<TeacherRoute><TeacherDashboard /></TeacherRoute>} />
            <Route path="/prof/profile" element={<TeacherRoute><Profile /></TeacherRoute>} />
            <Route path="/prof/lessons" element={<TeacherRoute><TeacherLessons /></TeacherRoute>} />
            <Route path="/prof/earnings" element={<TeacherRoute><TeacherEarnings /></TeacherRoute>} />
            <Route path="/prof/planning" element={<TeacherRoute><TeacherCalendar /></TeacherRoute>} />
            <Route path="/prof/reviews" element={<PrivateRoute role="teacher"><TeacherReviews /></PrivateRoute>} />

            {/* 🛠️ Administrateur */}
            <Route
              path="/admin/dashboard"
              element={
                <RequireRole roles={['admin']}>
                  <AdminDashboard />
                </RequireRole>
              }
            />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </>
      )}
    </Router>
  );
}

export default App;