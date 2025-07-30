import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="bg-gray-100 border-t py-6 mt-12 text-center text-sm text-gray-600">
      <p>© {new Date().getFullYear()} EduKaraib — Tous droits réservés</p>
      <div className="mt-2 flex justify-center gap-4 text-sm">
        <Link to="/contact" className="hover:underline">Contact</Link>
        <Link to="/cgu" className="hover:underline">Conditions</Link>
        <Link to="/privacy" className="hover:underline">Confidentialité</Link>
      </div>
    </footer>
  );
}