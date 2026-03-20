import React from 'react';
import { Link } from 'react-router-dom';
import { useSEO } from '../hooks/useSEO';

const SECTIONS = [
  {
    id: 'collecte',
    titre: '1. Données collectées',
    contenu: (
      <>
        <p>Lors de votre inscription et utilisation d'EduKaraib, nous collectons :</p>
        <ul>
          <li><strong>Données d'identité</strong> : nom, prénom, adresse email.</li>
          <li><strong>Données de profil</strong> : ville, numéro de téléphone (optionnel), photo de profil (optionnelle).</li>
          <li><strong>Données pédagogiques</strong> : matières, niveau, créneaux de disponibilité (pour les professeurs).</li>
          <li><strong>Données de paiement</strong> : traitées exclusivement par Stripe — EduKaraib ne stocke aucun numéro de carte bancaire.</li>
          <li><strong>Données de navigation</strong> : logs techniques anonymisés (pages visitées, erreurs) à des fins de maintenance.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'finalites',
    titre: '2. Finalités du traitement',
    contenu: (
      <>
        <p>Vos données sont utilisées exclusivement pour :</p>
        <ul>
          <li>Créer et gérer votre compte utilisateur.</li>
          <li>Mettre en relation élèves et professeurs.</li>
          <li>Traiter les réservations et paiements de cours.</li>
          <li>Envoyer des notifications liées à votre activité (confirmation de cours, rappels, virements).</li>
          <li>Améliorer la qualité et la fiabilité de la plateforme.</li>
        </ul>
        <p className="mt-3">Aucune donnée n'est utilisée à des fins publicitaires ou vendue à des tiers.</p>
      </>
    ),
  },
  {
    id: 'conservation',
    titre: '3. Durée de conservation',
    contenu: (
      <p>
        Vos données sont conservées pendant toute la durée d'activité de votre compte, puis supprimées
        dans un délai de <strong>3 mois</strong> après sa fermeture, sauf obligation légale contraire
        (ex : données comptables conservées 10 ans conformément au Code de commerce).
      </p>
    ),
  },
  {
    id: 'partage',
    titre: '4. Partage des données',
    contenu: (
      <>
        <p>Vos données peuvent être partagées avec les sous-traitants suivants, dans le strict cadre de nos services :</p>
        <ul>
          <li><strong>Stripe</strong> — traitement des paiements (certifié PCI-DSS).</li>
          <li><strong>Firebase / Google</strong> — hébergement de la base de données et authentification.</li>
          <li><strong>Resend</strong> — envoi d'emails transactionnels.</li>
          <li><strong>Vercel</strong> — hébergement de l'application.</li>
        </ul>
        <p className="mt-3">
          Ces prestataires sont contractuellement tenus de respecter la confidentialité de vos données
          et ne peuvent les utiliser à d'autres fins.
        </p>
      </>
    ),
  },
  {
    id: 'droits',
    titre: '5. Vos droits',
    contenu: (
      <>
        <p>Conformément au RGPD (Règlement UE 2016/679), vous disposez des droits suivants :</p>
        <ul>
          <li><strong>Accès</strong> : obtenir une copie de vos données personnelles.</li>
          <li><strong>Rectification</strong> : corriger des informations inexactes.</li>
          <li><strong>Effacement</strong> : demander la suppression de votre compte et de vos données.</li>
          <li><strong>Portabilité</strong> : recevoir vos données dans un format structuré.</li>
          <li><strong>Opposition</strong> : vous opposer à certains traitements.</li>
        </ul>
        <p className="mt-3">
          Pour exercer ces droits, contactez-nous à{' '}
          <a href="mailto:contact@edukaraib.com" className="text-sky-600 underline">
            contact@edukaraib.com
          </a>
          . Vous pouvez également supprimer votre compte directement depuis vos paramètres de profil.
        </p>
        <p className="mt-2">
          En cas de réclamation non résolue, vous pouvez saisir la{' '}
          <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" className="text-sky-600 underline">
            CNIL
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: 'cookies',
    titre: '6. Cookies',
    contenu: (
      <p>
        EduKaraib utilise uniquement des cookies strictement nécessaires au fonctionnement de la plateforme
        (session d'authentification). Aucun cookie publicitaire ou traceur tiers n'est déposé sur votre navigateur.
      </p>
    ),
  },
  {
    id: 'securite',
    titre: '7. Sécurité',
    contenu: (
      <p>
        Nous mettons en œuvre des mesures techniques adaptées : communications chiffrées (HTTPS/TLS),
        authentification sécurisée via Firebase Auth, accès aux données restreint au personnel autorisé.
        Les données de paiement ne transitent jamais par nos serveurs — elles sont traitées directement
        par Stripe.
      </p>
    ),
  },
  {
    id: 'contact',
    titre: '8. Contact & responsable du traitement',
    contenu: (
      <p>
        Le responsable du traitement est EduKaraib, joignable à{' '}
        <a href="mailto:contact@edukaraib.com" className="text-sky-600 underline">
          contact@edukaraib.com
        </a>
        . Pour toute question relative à vos données personnelles, n'hésitez pas à nous écrire.
      </p>
    ),
  },
];

export default function Privacy() {
  useSEO({
    title: 'Politique de Confidentialité — EduKaraib',
    description: 'Politique de confidentialité et gestion des données personnelles sur EduKaraib. RGPD, droits des utilisateurs, données collectées.',
    url: '/privacy',
  });

  return (
    <main className="min-h-screen bg-white">

      {/* Hero */}
      <section className="bg-gradient-to-br from-sky-50 to-white border-b">
        <div className="max-w-5xl mx-auto px-4 py-12">
          <p className="text-sm font-semibold text-sky-500 uppercase tracking-widest mb-2">Données & vie privée</p>
          <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 mb-3">
            Politique de Confidentialité
          </h1>
          <p className="text-gray-500">
            Dernière mise à jour : {new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          <div className="mt-4 inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium px-4 py-2 rounded-full">
            <span>🛡️</span>
            <span>Conforme au RGPD — aucune donnée vendue à des tiers</span>
          </div>
        </div>
      </section>

      {/* Content + TOC */}
      <section className="max-w-5xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">

          {/* Sidebar TOC */}
          <aside className="lg:col-span-3">
            <div className="lg:sticky lg:top-6 rounded-2xl border bg-gray-50 p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Sommaire</p>
              <ol className="space-y-2">
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="text-sm text-gray-600 hover:text-sky-600 transition block py-0.5"
                    >
                      {s.titre}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          </aside>

          {/* Article */}
          <article className="lg:col-span-9 prose prose-gray prose-sm max-w-none
            prose-h2:text-xl prose-h2:font-bold prose-h2:text-gray-900 prose-h2:mt-10 prose-h2:mb-3
            prose-p:text-gray-600 prose-p:leading-relaxed
            prose-ul:text-gray-600 prose-li:my-1
            prose-a:text-sky-600 prose-a:no-underline hover:prose-a:underline">
            {SECTIONS.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-20">
                <h2>{s.titre}</h2>
                {s.contenu}
              </section>
            ))}

            <hr className="my-10" />
            <p className="text-sm text-gray-400">
              Cette politique peut être mise à jour ponctuellement. En cas de modification substantielle,
              les utilisateurs en seront informés par email ou notification sur la plateforme.
            </p>
            <p className="text-sm mt-3">
              <Link to="/cgu" className="text-sky-600 hover:underline">
                Consulter nos Conditions Générales d'Utilisation →
              </Link>
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}