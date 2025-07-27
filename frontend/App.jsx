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
      </Routes>
    </Router>
  );
}

export default App;