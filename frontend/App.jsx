import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Profile from './pages/Profile';
import StudentDashboard from './pages/StudentDashboard';
import Search from './pages/Search';
import MyCourses from './pages/MyCourses';

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
        <Route path="/dashboard"element={<StudentRoute><StudentDashboard /></StudentRoute>}/>
        <Route path="/profile"element={<PrivateRoute><Profile /></PrivateRoute>}/>
        <Route path="/search"element={<StudentRoute><Search /></StudentRoute>}/>
        <Route path= "/my-courses" element={<StudentRoute><MyCourses /></StudentRoute>}/>
        <Route path= "/reviewform" element={<StudentRoute><ReviewForm /></StudentRoute>}/>
      </Routes>
    </Router>
  );
}

export default App;