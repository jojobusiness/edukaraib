import { Link } from 'react-router-dom';
import { auth } from '../lib/firebase';

export default function Navbar() {
  const user = auth.currentUser;

  return (
    <nav className="bg-white shadow-md py-4 px-6 flex justify-between items-center">
      <Link to="/" className="text-xl font-bold text-primary">EduKaraib</Link>
      <div className="flex gap-4 items-center">
        <Link to="/search" className="text-gray-700 hover:text-primary">Trouver un prof</Link>
        {user ? (
          <Link to="/settings" className="text-gray-700 hover:text-primary">Mon compte</Link>
        ) : (
          <>
            <Link to="/login" className="text-gray-700 hover:text-primary">Connexion</Link>
            <Link to="/register" className="bg-primary text-white px-4 py-2 rounded hover:bg-primary-dark">Inscription</Link>
          </>
        )}
      </div>
    </nav>
  );
}
