import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState, lazy, Suspense } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './lib/firebase';

// Pages d'atterrissage : chargement immediat (LCP — accueil + landing campagne)
import Home from './pages/Home';
import Bac from './pages/Bac';
import NotFound from './pages/NotFound';
import CookieConsent from './components/CookieConsent';

// Gardes de routes : legers, restent statiques
import TeacherRoute from './components/TeacherRoute';
import ParentRoute from './components/ParentRoute';
import PrivateRoute from './components/PrivateRoute';
import StudentRoute from './components/StudentRoute';
import RequireRole from './routes/RequireRole';

// Tout le reste en lazy : chaque page n'est telechargee qu'a la navigation.
// Avant : 1 bundle monolithique de 2,48 Mo charge par tous les visiteurs.
// Le listener vite:preloadError (main.jsx) gere les chunks perimes post-deploy.
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Profile = lazy(() => import('./pages/Profile'));
const StudentDashboard = lazy(() => import('./pages/StudentDashboard'));
const Search = lazy(() => import('./pages/Search'));
const MyCourses = lazy(() => import('./pages/MyCourses'));
const ParentDashboard = lazy(() => import('./pages/ParentDashboard'));
const ParentChildren = lazy(() => import('./pages/ParentChildren'));
const ParentCourses = lazy(() => import('./pages/ParentCourses'));
const TeacherDashboard = lazy(() => import('./pages/TeacherDashboard'));
const TeacherLessons = lazy(() => import('./pages/TeacherLessons'));
const TeacherEarnings = lazy(() => import('./pages/TeacherEarnings'));
const StudentCalendar = lazy(() => import('./pages/StudentCalendar'));
const StudentPayments = lazy(() => import('./pages/StudentPayments'));
const TeacherCalendar = lazy(() => import('./pages/TeacherCalendar'));
const TeacherReviews = lazy(() => import('./pages/TeacherReviews'));
const MessagesWrapper = lazy(() => import('./pages/MessagesWrapper'));
const ChatList = lazy(() => import('./pages/ChatList'));
const Messages = lazy(() => import('./pages/Messages'));
const SmartDashboard = lazy(() => import('./pages/SmartDashboard'));
const Unauthorized = lazy(() => import('./pages/Unauthorized'));
const ParentPayments = lazy(() => import('./pages/ParentPayments'));
const ParentCalendar = lazy(() => import('./pages/ParentCalendar'));
const Contact = lazy(() => import('./pages/Contact'));
const CGU = lazy(() => import('./pages/CGU'));
const Privacy = lazy(() => import('./pages/Privacy'));
const ChildDetails = lazy(() => import('./pages/ChildDetails'));
const TeacherProfile = lazy(() => import('./pages/TeacherProfile'));
const PaySuccess = lazy(() => import('./pages/pay/Success.jsx'));
const PayCancel = lazy(() => import('./pages/pay/Cancel.jsx'));
const Invoice = lazy(() => import('./pages/Invoice'));
const VisioRoom = lazy(() => import('./pages/VisioRoom.jsx'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AuthAction = lazy(() => import('./pages/AuthAction'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const InfluencerHome = lazy(() => import('./pages/InfluencerHome.jsx'));
const InfluencerDashboard = lazy(() => import('./pages/InfluencerDashboard.jsx'));
const InfluencerProfile = lazy(() => import('./pages/InfluencerProfile'));
const InfluencerCommissions = lazy(() => import('./pages/InfluencerCommissions'));
const CoursMathsMartinique = lazy(() => import('./pages/seo/CoursMathsMartinique'));
const CoursAnglaisGuadeloupe = lazy(() => import('./pages/seo/CoursAnglaisGuadeloupe'));
const CoursFrancaisGuyane = lazy(() => import('./pages/seo/CoursFrancaisGuyane'));
const CoursParticuliersMartinique = lazy(() => import('./pages/seo/CoursParticuliersMartinique'));
const CoursParticuliersGuadeloupe = lazy(() => import('./pages/seo/CoursParticuliersGuadeloupe'));
const CoursMathsGuadeloupe = lazy(() => import('./pages/seo/CoursMathsGuadeloupe'));
const CoursAnglaisMartinique = lazy(() => import('./pages/seo/CoursAnglaisMartinique'));
const CoursParticuliersGuyane = lazy(() => import('./pages/seo/CoursParticuliersGuyane'));
const CoursMaths = lazy(() => import('./pages/seo/CoursMaths'));
const CoursAnglais = lazy(() => import('./pages/seo/CoursAnglais'));
const CoursFrancais = lazy(() => import('./pages/seo/CoursFrancais'));
const FAQ = lazy(() => import('./pages/FAQ'));
const About = lazy(() => import('./pages/About'));
const Blog = lazy(() => import('./pages/Blog'));
const BlogPost = lazy(() => import('./pages/BlogPost'));

/** Fallback pendant le chargement d'une page lazy */
function PageLoader() {
  return <div className="min-h-screen grid place-items-center text-gray-500">Chargement…</div>;
}

/* === PageView Tracker (Google Analytics + Meta Pixel) === */
function PageViewTracker() {
  const location = useLocation();
  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
      window.gtag('config', 'G-32EG21Z538', {
        page_path: location.pathname + location.search,
      });
    }
    // Meta Pixel : PageView à chaque navigation SPA (le 1er part depuis index.html)
    if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
      window.fbq('track', 'PageView');
    }
  }, [location]);
  return null;
}

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
      if (last && !['/login', '/register', '/unauthorized'].includes(last)) {
        navigate(last, { replace: true });
      }
    });
    return unsub;
  }, [navigate]);
  return null;
}

function App() {
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, () => {
      setAuthReady(true);
    });
    return unsub;
  }, []);

  return (
    <Router>
      <PageViewTracker /> {/* ✅ Tracker INSIDE the Router */}
      <CookieConsent /> {/* Bandeau RGPD — gère le consentement GA + Meta Pixel */}
      {!authReady ? (
        <div className="min-h-screen grid place-items-center text-gray-500">Chargement…</div>
      ) : (
        <>
          <RestoreLastRoute />
          <RouteMemory />
          <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public */}
            <Route path="/" element={<Home />} />
            <Route path="/smart-dashboard" element={<SmartDashboard />} />
            <Route path="/login" element={<Login />} />
            <Route path="/mot-de-passe-oublie" element={<ForgotPassword />} />
            <Route path="/register" element={<Register />} />
            <Route path="/profils/:teacherId" element={<TeacherProfile />} />
            <Route path="/unauthorized" element={<Unauthorized />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/faq" element={<FAQ />} />
            <Route path="/cgu" element={<CGU />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/pay/success" element={<PaySuccess />} />
            <Route path="/pay/cancel" element={<PayCancel />} />
            <Route path="/facture/:paymentId" element={<PrivateRoute><Invoice /></PrivateRoute>} />
            <Route path="/visio/:lessonId" element={<VisioRoom />} />

            {/* Protégées génériques */}
            <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>} />

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
            <Route path="/dashboard-eleve/planning" element={<StudentRoute><StudentCalendar /></StudentRoute>} />
            <Route path="/student/payments" element={<RequireRole roles={['student']}><StudentPayments /></RequireRole>} />

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
            
            {/* Influenceur */}
            <Route path="/influencer" element={<InfluencerHome />} />
            <Route path="/influencer/dashboard" element={<InfluencerDashboard />} />
            <Route path="/influencer/profile" element={<InfluencerProfile />} />
            <Route path="/influencer/commissions" element={<InfluencerCommissions />} />

            {/* 🛠️ Administrateur */}
            <Route path="/admin/dashboard" element={<RequireRole roles={['admin']}><AdminDashboard /></RequireRole>} />

            <Route path="/auth/action" element={<AuthAction />} />
            <Route path="/__/auth/action" element={<AuthAction />} />
            <Route path="/__auth/action" element={<AuthAction />} />   {/* ✅ ton lien actuel */}

            {/* SEO local */}
            <Route path="/cours-maths-martinique" element={<CoursMathsMartinique />} />
            <Route path="/cours-anglais-guadeloupe" element={<CoursAnglaisGuadeloupe />} />
            <Route path="/cours-francais-guyane" element={<CoursFrancaisGuyane />} />
            <Route path="/cours-particuliers-martinique" element={<CoursParticuliersMartinique />} />
            <Route path="/cours-particuliers-guadeloupe" element={<CoursParticuliersGuadeloupe />} />
            <Route path="/cours-maths-guadeloupe" element={<CoursMathsGuadeloupe />} />
            <Route path="/cours-anglais-martinique" element={<CoursAnglaisMartinique />} />
            <Route path="/cours-particuliers-guyane" element={<CoursParticuliersGuyane />} />
            <Route path="/cours-maths" element={<CoursMaths />} />
            <Route path="/cours-anglais" element={<CoursAnglais />} />
            <Route path="/cours-francais" element={<CoursFrancais />} />

            {/* 🎯 Landing campagne bac (influenceurs : /bac?code=XXX) */}
            <Route path="/bac" element={<Bac />} />
            <Route path="/rattrapage" element={<Bac />} />
            <Route path="/about" element={<About />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/blog/:slug" element={<BlogPost />} />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </>
      )}
    </Router>
  );
}

export default App;