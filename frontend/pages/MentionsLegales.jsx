import React from 'react';
import { Link } from 'react-router-dom';
import { useSEO } from '../hooks/useSEO';

const SECTIONS = [
  {
    id: 'editeur',
    titre: '1. Éditeur du site',
    contenu: (
      <ul>
        <li><strong>Exploitant</strong> : Joseph Twizeyimana, entrepreneur individuel (EI), nom commercial <strong>Jojo Empire</strong>.</li>
        <li><strong>Marque exploitée</strong> : EduKaraib.</li>
        <li><strong>SIREN</strong> : 105 341 036 — <strong>SIRET</strong> : 105 341 036 00017 — <strong>APE</strong> : 6202A.</li>
        <li><strong>Siège</strong> : Paris, France.</li>
        <li><strong>TVA</strong> : non applicable, art. 293B du CGI.</li>
        <li>
          <strong>Contact</strong> :{' '}
          <a href="mailto:contact@edukaraib.com" className="text-sky-600 underline">contact@edukaraib.com</a>
        </li>
        <li><strong>Directeur de la publication</strong> : Joseph Twizeyimana.</li>
      </ul>
    ),
  },
  {
    id: 'hebergement',
    titre: '2. Hébergement',
    contenu: (
      <ul>
        <li>
          <strong>Site et serveurs applicatifs</strong> : Vercel Inc., 440 N Barranca Ave #4133, Covina,
          CA 91723, États-Unis — vercel.com.
        </li>
        <li>
          <strong>Base de données et authentification</strong> : Google Cloud / Firebase, Google Ireland Limited,
          Gordon House, Barrow Street, Dublin 4, Irlande.
        </li>
      </ul>
    ),
  },
  {
    id: 'paiements',
    titre: '3. Paiements',
    contenu: (
      <p>
        Les paiements sont traités par <strong>Stripe Payments Europe, Ltd.</strong> (Dublin, Irlande). Les
        versements aux professeurs et aux partenaires passent par Stripe Connect. EduKaraib ne stocke aucune
        donnée de carte bancaire.
      </p>
    ),
  },
  {
    id: 'propriete',
    titre: '4. Propriété intellectuelle',
    contenu: (
      <p>
        La marque EduKaraib, le logo, les textes, la charte graphique et le code du site sont la propriété de
        l'éditeur. Toute reproduction sans autorisation écrite est interdite. Les contenus publiés par les
        professeurs (présentation, photo, vidéo) restent la propriété de leurs auteurs.
      </p>
    ),
  },
  {
    id: 'donnees',
    titre: '5. Données personnelles',
    contenu: (
      <p>
        Le traitement de vos données est décrit dans notre{' '}
        <Link to="/privacy" className="text-sky-600 underline">politique de confidentialité</Link>.
        Vous pouvez exercer vos droits à{' '}
        <a href="mailto:contact@edukaraib.com" className="text-sky-600 underline">contact@edukaraib.com</a>.
      </p>
    ),
  },
  {
    id: 'litiges',
    titre: '6. Conditions et litiges',
    contenu: (
      <p>
        L'utilisation du site est régie par nos{' '}
        <Link to="/cgu" className="text-sky-600 underline">conditions générales d'utilisation</Link>,
        qui précisent le droit applicable et les voies de recours.
      </p>
    ),
  },
];

export default function MentionsLegales() {
  useSEO({
    title: 'Mentions légales — EduKaraib',
    description: 'Mentions légales d’EduKaraib : éditeur, SIRET, hébergeurs, paiements, propriété intellectuelle.',
    url: '/mentions-legales',
  });

  return (
    <main className="min-h-screen bg-white">
      <section className="bg-gradient-to-br from-sky-50 to-white border-b">
        <div className="max-w-3xl mx-auto px-4 py-12">
          <p className="text-sm font-semibold text-sky-500 uppercase tracking-widest mb-2">Informations légales</p>
          <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900">Mentions légales</h1>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <article className="prose prose-gray prose-sm max-w-none
          prose-h2:text-xl prose-h2:font-bold prose-h2:text-gray-900 prose-h2:mt-10 prose-h2:mb-3
          prose-p:text-gray-600 prose-p:leading-relaxed
          prose-ul:text-gray-600 prose-li:my-1">
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-20">
              <h2>{s.titre}</h2>
              {s.contenu}
            </section>
          ))}
        </article>
      </section>
    </main>
  );
}
