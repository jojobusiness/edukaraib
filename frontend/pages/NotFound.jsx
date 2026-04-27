import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 text-center">
      <p className="text-8xl font-extrabold text-primary">404</p>
      <h1 className="mt-4 text-2xl font-bold text-gray-900">Page introuvable</h1>
      <p className="mt-2 text-gray-500 max-w-sm">
        Cette page n'existe pas ou a été déplacée.
      </p>
      <Link
        to="/"
        className="mt-6 inline-block bg-primary text-white font-semibold px-6 py-3 rounded-xl hover:bg-primary-dark transition"
      >
        Retour à l'accueil
      </Link>
    </div>
  );
}
