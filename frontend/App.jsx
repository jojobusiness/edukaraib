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
import TeacherProfile from './pages/TeacherProfile';
import TeacherLessons from './pages/TeacherLessons';
import TeacherEarnings from './pages/TeacherEarnings';

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

        {/* Routes protégées */}
        <Route path="/dashboard-eleve"element={<StudentRoute><StudentDashboard /></StudentRoute>}/>
        <Route path="/profile"element={<PrivateRoute><Profile /></PrivateRoute>}/>
        <Route path="/search"element={<StudentRoute><Search /></StudentRoute>}/>
        <Route path= "/my-courses" element={<StudentRoute><MyCourses /></StudentRoute>}/>
        <Route path= "/reviewform" element={<StudentRoute><ReviewForm /></StudentRoute>}/>

        <Route path="/parent/dashboard" element={<ParentRoute><ParentDashboard /></ParentRoute>}/>
        <Route path="/parent/children" element={<ParentRoute><ParentChildren /></ParentRoute>}/>
        <Route path="/parent/courses" element={<ParentRoute><ParentCourses /></ParentRoute>}/>
        
        <Route path="/prof/dashboard" element={<TeacherRoute><TeacherDashboard /></TeacherRoute>}/>
        <Route path="/prof/profile"element={<TeacherRoute><TeacherProfile /></TeacherRoute>}/>
        <Route path="/prof/lessons" element={<TeacherRoute><TeacherLessons /></TeacherRoute>}/>
        <Route path="/prof/earnings"element={<TeacherRoute><TeacherEarnings /></TeacherRoute>}/>
      </Routes>
    </Router>
  );
}

export default App;