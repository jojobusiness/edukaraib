import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
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
import TeacherCalendar from './pages/TeacherCalendar';
import TeacherReviews from './pages/TeacherReviews';
import Messages from './pages/Messages';
import MessagesWrapper from './pages/MessagesWrapper';
import BookLessonEleve from './pages/BookLessonEleve';
import ChatList from './pages/ChatList';
import NotFound from './pages/NotFound';
import Unauthorized from './pages/Unauthorized';
import ParentPayments from './pages/ParentPayments';
import Settings from './pages/Settings';
import Contact from './pages/Contact';
import CGU from './pages/CGU';
import Privacy from './pages/Privacy';
import ChildDetails from './pages/ChildDetails';

import TeacherRoute from './components/TeacherRoute';
import ParentRoute from './components/ParentRoute';
import ReviewForm from './components/ReviewForm';
import PrivateRoute from './components/PrivateRoute';
import StudentRoute from './components/StudentRoute';


function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/unauthorized" element={<Unauthorized />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/cgu" element={<CGU />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="*" element={<NotFound />} />

        {/* Routes protégées */}
        <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>}/>
        <Route path="/chat/:receiverId" element={<PrivateRoute><MessagesWrapper /></PrivateRoute>}/>
        <Route path="/chat" element={<PrivateRoute><Messages /></PrivateRoute>}/>
        <Route path="/chat-list" element={<PrivateRoute><ChatList /></PrivateRoute>}/>
        <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />

        <Route path="/search" element={<Search />}/>

        <Route path="/dashboard-eleve" element={<StudentRoute><StudentDashboard /></StudentRoute>}/>
        <Route path= "/my-courses" element={<StudentRoute><MyCourses /></StudentRoute>}/>
        <Route path= "/reviewform" element={<StudentRoute><ReviewForm /></StudentRoute>}/>
        <Route path="/dashboard-eleve/planning" element={<StudentRoute><StudentCalendar /></StudentRoute>}/>
        <Route path="/book-lesson-eleve" element={<StudentRoute><BookLessonEleve teacherId="TEACHER_ID" subjectId="SUBJECT_ID" /></StudentRoute>}/>

        <Route path="/parent/dashboard" element={<ParentRoute><ParentDashboard /></ParentRoute>}/>
        <Route path="/parent/children" element={<ParentRoute><ParentChildren /></ParentRoute>}/>
        <Route path="/parent/courses" element={<ParentRoute><ParentCourses /></ParentRoute>}/>
        <Route path="/parent/children/:childId" element={<ParentRoute><ChildDetails /></ParentRoute>} />
        <Route path="/parent/payments" element={<ParentRoute><ParentPayments /></ParentRoute>} />

        <Route path="/prof/dashboard" element={<TeacherRoute><TeacherDashboard /></TeacherRoute>}/>
        <Route path="/prof/profile" element={<TeacherRoute><Profile /></TeacherRoute>}/>
        <Route path="/prof/lessons" element={<TeacherRoute><TeacherLessons /></TeacherRoute>}/>
        <Route path="/prof/earnings" element={<TeacherRoute><TeacherEarnings /></TeacherRoute>}/>
        <Route path="/prof/planning" element={<TeacherRoute><TeacherCalendar /></TeacherRoute>}/>
        <Route path="/prof/reviews" element={<PrivateRoute role="teacher"><TeacherReviews /></PrivateRoute>
  }
/>
      </Routes>
    </Router>
  );
}

export default App;