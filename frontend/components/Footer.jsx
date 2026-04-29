import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="bg-gray-100 border-t py-8 mt-12 text-sm text-gray-600">
      <div className="max-w-5xl mx-auto px-4">
        {/* Liens SEO locaux */}
        <div className="mb-4">
          <p className="font-semibold text-gray-700 mb-3 text-center">Cours particuliers par région</p>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2">
            <Link to="/cours-particuliers-martinique" className="hover:text-primary hover:underline">Cours particuliers Martinique</Link>
            <Link to="/cours-particuliers-guadeloupe" className="hover:text-primary hover:underline">Cours particuliers Guadeloupe</Link>
            <Link to="/cours-particuliers-guyane" className="hover:text-primary hover:underline">Cours particuliers Guyane</Link>
            <Link to="/cours-maths-martinique" className="hover:text-primary hover:underline">Cours de Maths Martinique</Link>
            <Link to="/cours-maths-guadeloupe" className="hover:text-primary hover:underline">Cours de Maths Guadeloupe</Link>
            <Link to="/cours-anglais-martinique" className="hover:text-primary hover:underline">Cours d'Anglais Martinique</Link>
            <Link to="/cours-anglais-guadeloupe" className="hover:text-primary hover:underline">Cours d'Anglais Guadeloupe</Link>
            <Link to="/cours-francais-guyane" className="hover:text-primary hover:underline">Cours de Français Guyane</Link>
          </div>
        </div>
        <div className="mb-6">
          <p className="font-semibold text-gray-700 mb-3 text-center">Cours par matière</p>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2">
            <Link to="/cours-maths" className="hover:text-primary hover:underline">Cours de Maths</Link>
            <Link to="/cours-anglais" className="hover:text-primary hover:underline">Cours d'Anglais</Link>
            <Link to="/cours-francais" className="hover:text-primary hover:underline">Cours de Français</Link>
          </div>
        </div>

        <div className="border-t pt-4 text-center">
          <p>© {new Date().getFullYear()} EduKaraib — Tous droits réservés</p>
          <div className="mt-2 flex justify-center gap-4">
            <Link to="/contact" className="hover:underline">Contact</Link>
            <Link to="/faq" className="hover:underline">FAQ</Link>
            <Link to="/cgu" className="hover:underline">Conditions</Link>
            <Link to="/privacy" className="hover:underline">Confidentialité</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
