export default function CGU() {
  return (
    <main className="min-h-screen bg-white">
      {/* Header / Hero */}
      <section className="border-b bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-gray-900">
                Conditions Générales d’Utilisation — EduKaraib
              </h1>
              <p className="mt-3 text-gray-600">
                Version intégrale. Dernière mise à jour : {new Date().toLocaleDateString("fr-FR")}
              </p>
            </div>
            <div className="rounded-2xl border bg-white shadow-sm p-4 w-full lg:w-auto">
              <p className="text-sm text-gray-500">Contact juridique</p>
              <a
                href="mailto:contact@edukaraib.com"
                className="mt-1 inline-flex text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                contact@edukaraib.com
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Content + TOC */}
      <section className="max-w-6xl mx-auto px-4 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Sidebar / TOC */}
          <aside className="lg:col-span-4 xl:col-span-3">
            <div className="lg:sticky lg:top-6">
              <nav className="rounded-2xl border bg-white shadow-sm p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Table des matières</h2>
                <ol className="space-y-2 text-sm leading-6">
                  <li><a className="anchor-link" href="#cgu-1">1. Présentation du site</a></li>
                  <li><a className="anchor-link" href="#cgu-2">2. Accès et inscription</a></li>
                  <li><a className="anchor-link" href="#cgu-3">3. Rôle & responsabilités</a></li>
                  <li><a className="anchor-link" href="#cgu-4">4. Paiements & remboursements</a></li>
                  <li><a className="anchor-link" href="#cgu-5">5. Obligations des utilisateurs</a></li>
                  <li><a className="anchor-link" href="#cgu-6">6. Propriété intellectuelle</a></li>
                  <li><a className="anchor-link" href="#cgu-7">7. Données perso & confidentialité</a></li>
                  <li><a className="anchor-link" href="#cgu-8">8. Suspension & résiliation</a></li>
                  <li><a className="anchor-link" href="#cgu-9">9. Responsabilité & garanties</a></li>
                  <li><a className="anchor-link" href="#cgu-10">10. Modification des CGU</a></li>
                  <li><a className="anchor-link" href="#cgu-11">11. Disponibilité du service</a></li>
                  <li><a className="anchor-link" href="#cgu-12">12. Utilisation par des mineurs</a></li>
                  <li><a className="anchor-link" href="#cgu-13">13. Loi applicable / Guyane</a></li>
                  <li><a className="anchor-link" href="#cgu-14">14. Contact</a></li>
                </ol>
                <style jsx>{`
                  .anchor-link {
                    display: block;
                    color: #1f2937;
                  }
                  .anchor-link:hover { color: #2563eb; }
                `}</style>
              </nav>
            </div>
          </aside>

          {/* Main content */}
          <article className="prose prose-gray max-w-none lg:col-span-8 xl:col-span-9">
            {/* 1 */}
            <section id="cgu-1">
              <h2>1. Présentation du site et objet des conditions</h2>
              <p>
                Les présentes <strong>Conditions Générales d’Utilisation</strong> (ci-après les « CGU ») ont pour
                objet de définir les modalités et conditions dans lesquelles le site <strong>EduKaraib</strong>,
                accessible à l’adresse <a href="http://www.edukaraib.com">www.edukaraib.com</a> (ci-après le « Site »),
                met à disposition de ses utilisateurs ses services, ainsi que la manière dont ces derniers accèdent et
                utilisent ledit Site.
              </p>
              <p>
                <strong>EduKaraib</strong> est une plateforme SaaS (Software as a Service) de mise en relation entre
                professeurs et étudiants, permettant aux utilisateurs de proposer, rechercher ou bénéficier de cours,
                formations et accompagnements pédagogiques dans divers domaines. Le Site offre un environnement sécurisé
                et simple d’utilisation pour faciliter la communication, la planification et la gestion des échanges
                entre professeurs et étudiants.
              </p>
              <p>
                L’accès et l’utilisation du Site impliquent l’acceptation pleine et entière des présentes CGU par tout
                utilisateur. En cas de désaccord avec tout ou partie des conditions énoncées ci-dessous, l’utilisateur
                est invité à ne pas utiliser le Site.
              </p>
              <p>
                Le Site EduKaraib est édité par <strong>EduKaraib</strong>, plateforme SaaS accessible en ligne,
                joignable à l’adresse e-mail suivante : <a href="mailto:contact@edukaraib.com">contact@edukaraib.com</a>.
              </p>
            </section>

            {/* 2 */}
            <section id="cgu-2">
              <h2>2. Accès au site et inscription des utilisateurs</h2>
              <h3>2.1 Accès au site</h3>
              <p>
                L’accès au site EduKaraib est libre pour toute personne disposant d’un accès à Internet. Toutefois,
                certaines fonctionnalités du Site nécessitent la création d’un compte utilisateur.
              </p>
              <h3>2.2 Création de compte</h3>
              <ul>
                <li>
                  <strong>Professeurs</strong> : création d’un compte pour proposer des services (cours, accompagnements,
                  formations, etc.) et fixer librement les tarifs ;
                </li>
                <li>
                  <strong>Étudiants et parents d’étudiants</strong> : création d’un compte pour rechercher, sélectionner
                  et réserver les prestations proposées par les professeurs.
                </li>
              </ul>
              <p>
                Chaque utilisateur s’engage à fournir des informations exactes, complètes et à jour lors de son
                inscription, ainsi qu’à maintenir la confidentialité de ses identifiants de connexion. Toute utilisation
                frauduleuse ou non conforme pourra entraîner la suspension ou la suppression du compte concerné.
              </p>
              <h3>2.3 Gestion des paiements</h3>
              <p>
                Les paiements effectués sur la plateforme EduKaraib sont entièrement gérés par le prestataire de
                paiement sécurisé <strong>Stripe</strong>. Les utilisateurs reconnaissent que les transactions
                financières (paiements, remboursements, virements aux professeurs, etc.) sont réalisées via les services
                de Stripe, conformément à leurs conditions générales disponibles sur leur site officiel. EduKaraib ne
                conserve aucune donnée bancaire des utilisateurs et n’intervient pas dans le traitement technique des
                paiements, hormis pour permettre la mise en relation entre les parties et le suivi des transactions.
              </p>
              <h3>2.4 Accès aux services</h3>
              <p>
                Une fois inscrits, les utilisateurs peuvent accéder à leur espace personnel pour gérer leur profil,
                leurs cours, leurs paiements et leurs échanges. EduKaraib se réserve le droit de limiter, suspendre ou
                supprimer l’accès à tout compte utilisateur en cas de non-respect des présentes CGU ou de comportement
                contraire à la loi.
              </p>
            </section>

            {/* 3 */}
            <section id="cgu-3">
              <h2>3. Rôle et responsabilités de la plateforme EduKaraib</h2>
              <h3>3.1 Rôle d’intermédiaire technique</h3>
              <p>
                Le site EduKaraib agit exclusivement en tant que plateforme technique de mise en relation entre
                professeurs et étudiants (ou leurs parents). À ce titre, EduKaraib n’intervient pas dans la relation
                contractuelle, pédagogique ou personnelle entre les utilisateurs. Le rôle d’EduKaraib se limite à
                fournir les outils nécessaires à la publication d’offres de cours, à la réservation, au paiement en
                ligne et à la gestion des transactions via son prestataire de paiement Stripe.
              </p>
              <h3>3.2 Absence de responsabilité sur le contenu et le comportement des utilisateurs</h3>
              <ul>
                <li>Contenu, qualité, disponibilité ou déroulement des cours proposés par les professeurs ;</li>
                <li>Comportement, propos ou agissements des utilisateurs, en ligne ou hors plateforme ;</li>
                <li>Dom­mages matériels, corporels ou moraux pouvant résulter d’interactions entre utilisateurs.</li>
              </ul>
              <p>
                Chaque utilisateur est seul responsable de son comportement et de l’usage qu’il fait du Site et des
                services proposés.
              </p>
              <h3>3.3 Gestion des litiges et remboursements</h3>
              <p>
                En cas de problème, de litige ou de demande de remboursement, EduKaraib met en place un service de
                médiation et d’assistance afin d’examiner les demandes des utilisateurs. Les remboursements éventuels
                sont traités via Stripe, conformément à ses procédures internes et aux conditions d’utilisation
                d’EduKaraib. La plateforme se réserve le droit d’intervenir pour suspendre ou clôturer le compte d’un
                utilisateur en cas de signalement avéré d’abus ou de comportement inapproprié.
              </p>
            </section>

            {/* 4 */}
            <section id="cgu-4">
              <h2>4. Paiements, commissions et remboursements</h2>
              <h3>4.1 Modalités de paiement</h3>
              <p>
                Les paiements effectués sur la plateforme EduKaraib sont réalisés en ligne via le prestataire de
                paiement sécurisé Stripe. Les étudiants (ou leurs parents) paient le montant indiqué par le professeur
                au moment de la réservation du cours. Le paiement est conservé par Stripe jusqu’à la validation du cours
                ou selon les modalités prévues par la plateforme. EduKaraib ne détient à aucun moment les fonds versés
                par les utilisateurs et ne conserve aucune donnée bancaire.
              </p>
              <h3>4.2 Commission de la plateforme</h3>
              <p>
                Pour chaque cours réservé et payé via la plateforme, EduKaraib perçoit une commission fixe de
                <strong> 10 €</strong>. Cette commission est prélevée automatiquement avant le versement du solde au
                professeur. Elle couvre les frais techniques, de maintenance et de fonctionnement. La commission reste
                acquise à EduKaraib même en cas d’annulation ou de remboursement partiel, sauf exceptions prévues.
              </p>
              <h3>4.3 Conditions de remboursement</h3>
              <ul>
                <li>
                  <strong>Annulation avant le début du cours</strong> : remboursement du paiement, déduction faite des
                  frais Stripe le cas échéant ;
                </li>
                <li>
                  <strong>Cours non réalisé</strong> pour des raisons imputables au professeur (absence, annulation sans
                  préavis, etc.) : remboursement intégral possible.
                </li>
              </ul>
              <p>
                Les demandes doivent être adressées à{" "}
                <a href="mailto:contact@edukaraib.com">contact@edukaraib.com</a> avec justificatifs.
              </p>
              <h3>4.4 Gestion technique des paiements</h3>
              <p>
                Les paiements, remboursements et transferts aux professeurs sont effectués via Stripe, selon les délais
                et modalités du prestataire. En utilisant la plateforme, les utilisateurs acceptent également les CGU de
                Stripe.
              </p>
            </section>

            {/* 5 */}
            <section id="cgu-5">
              <h2>5. Obligations et responsabilités des utilisateurs</h2>
              <h3>5.1 Règles générales de bonne conduite</h3>
              <p>
                L’utilisation du Site implique le respect des lois et des présentes CGU. Sont notamment interdits : la
                fraude, les contenus discriminatoires/violents/diffamatoires/pornographiques, le contournement des
                paiements hors plateforme, l’usurpation d’identité.
              </p>
              <h3>5.2 Obligations spécifiques des professeurs</h3>
              <ul>
                <li>Fournir des informations exactes sur compétences, diplômes et expériences ;</li>
                <li>Proposer des cours de qualité, adaptés au niveau et aux besoins des étudiants ;</li>
                <li>Respecter les horaires convenus et prévenir en cas d’empêchement ;</li>
                <li>Ne pas solliciter ni recevoir de paiement en dehors de la plateforme ;</li>
                <li>Adopter un comportement respectueux et professionnel.</li>
              </ul>
              <p>
                Les professeurs sont seuls responsables du contenu et du déroulement de leurs cours. EduKaraib ne
                garantit ni qualification, ni compétence, ni moralité.
              </p>
              <h3>5.3 Obligations spécifiques des étudiants et des parents</h3>
              <ul>
                <li>Fournir des informations exactes lors de l’inscription ;</li>
                <li>Respecter horaires et conditions de réservation ;</li>
                <li>Adopter un comportement respectueux envers les professeurs ;</li>
                <li>Effectuer les paiements exclusivement via la plateforme ;</li>
                <li>Signaler tout incident via le support.</li>
              </ul>
              <h3>5.4 Responsabilité des utilisateurs</h3>
              <p>
                Chaque utilisateur est responsable de l’usage qu’il fait du service et des informations qu’il diffuse.
                EduKaraib ne saurait être tenu responsable des litiges résultant d’une utilisation abusive.
              </p>
            </section>

            {/* 6 */}
            <section id="cgu-6">
              <h2>6. Propriété intellectuelle et contenu du site</h2>
              <h3>6.1 Titularité des droits</h3>
              <p>
                L’ensemble des éléments du Site (structure, design, textes, graphiques, logos, icônes, images, vidéos,
                sons, logiciels, bases de données) est la propriété exclusive d’EduKaraib ou de ses partenaires.
                Toute utilisation sans autorisation écrite est interdite et peut engager la responsabilité civile et
                pénale.
              </p>
              <h3>6.2 Licence d’utilisation accordée aux utilisateurs</h3>
              <p>
                L’accès au Site ne confère aucun droit de propriété intellectuelle. Une licence d’usage personnelle,
                non exclusive et non transférable est accordée pour l’utilisation des services selon les présentes CGU.
              </p>
              <h3>6.3 Contenus publiés par les utilisateurs</h3>
              <p>
                En publiant un contenu, l’utilisateur garantit en détenir les droits, autorise EduKaraib à l’héberger et
                en demeure responsable. EduKaraib peut supprimer tout contenu inapproprié.
              </p>
              <h3>6.4 Marque et nom de domaine</h3>
              <p>
                Le nom EduKaraib, son logo et son nom de domaine sont protégés. Toute utilisation non autorisée est
                interdite.
              </p>
            </section>

            {/* 7 */}
            <section id="cgu-7">
              <h2>7. Protection des données personnelles et confidentialité</h2>
              <h3>7.1 Collecte des données</h3>
              <p>
                Données susceptibles d’être collectées : identité (nom, prénom, e-mail, téléphone), informations de
                connexion (identifiants, mots de passe chiffrés), données de paiement (gérées par Stripe), données d’usage
                (cours suivis, messages, avis).
              </p>
              <h3>7.2 Finalités du traitement</h3>
              <ul>
                <li>Création et gestion des comptes ;</li>
                <li>Mise en relation professeurs/étudiants/parents ;</li>
                <li>Paiements/remboursements via Stripe ;</li>
                <li>Sécurité et bon fonctionnement de la plateforme ;</li>
                <li>Amélioration de la qualité de service.</li>
              </ul>
              <h3>7.3 Hébergement et sécurité des données (Firebase)</h3>
              <p>
                Les données sont hébergées et sécurisées via <strong>Firebase (Google Cloud Platform)</strong>, situés
                dans l’Union européenne ou dans des pays disposant d’un niveau de protection adéquat, avec chiffrement et
                conformité RGPD. EduKaraib met en œuvre des mesures techniques et organisationnelles adaptées.
              </p>
              <h3>7.4 Droits des utilisateurs</h3>
              <p>
                Droits d’accès, rectification, suppression, limitation, opposition et portabilité. Exercice à :{" "}
                <a href="mailto:contact@edukaraib.com">contact@edukaraib.com</a>.
              </p>
              <h3>7.5 Conservation des données</h3>
              <p>
                Conservation pour la durée nécessaire aux services ou obligations légales. À la suppression du compte :
                suppression ou anonymisation, sauf obligation légale.
              </p>
              <h3>7.6 Cookies et outils de mesure</h3>
              <p>
                Des cookies peuvent être utilisés pour améliorer la navigation et mesurer l’audience. Gestion possible via
                les paramètres du navigateur.
              </p>
            </section>

            {/* 8 */}
            <section id="cgu-8">
              <h2>8. Suspension et résiliation du compte utilisateur</h2>
              <h3>8.1 Motifs</h3>
              <ul>
                <li>Non-respect des CGU ou de la charte ;</li>
                <li>Fausse déclaration à l’inscription ;</li>
                <li>Utilisation frauduleuse, abusive ou détournée ;</li>
                <li>Atteinte à l’intégrité, sécurité ou réputation d’autrui ou d’EduKaraib ;</li>
                <li>Tentative d’accès non autorisé aux systèmes ou données.</li>
              </ul>
              <p>
                L’utilisateur est informé par e-mail des raisons, sauf fraude manifeste ou urgence.
              </p>
              <h3>8.2 Conséquences</h3>
              <ul>
                <li>Suppression d’accès à l’espace personnel ;</li>
                <li>Interruption des relations contractuelles en cours ;</li>
                <li>Suppression/anonymisation des données selon la politique de confidentialité.</li>
              </ul>
              <h3>8.3 Recours</h3>
              <p>
                L’utilisateur peut demander une réévaluation à{" "}
                <a href="mailto:contact@edukaraib.com">contact@edukaraib.com</a>.
              </p>
            </section>

            {/* 9 */}
            <section id="cgu-9">
              <h2>9. Responsabilité et garanties</h2>
              <h3>9.1 Responsabilité d’EduKaraib</h3>
              <ul>
                <li>Indisponibilité temporaire du Site (maintenance, mises à jour, force majeure, panne réseau) ;</li>
                <li>Perte de données due à un usage non conforme ;</li>
                <li>Dom­mages indirects (perte de revenus, etc.) ;</li>
                <li>Contenus publiés par les utilisateurs.</li>
              </ul>
              <p>
                EduKaraib agit comme intermédiaire technique et n’intervient pas dans le contenu, la qualité ou le
                déroulement des cours.
              </p>
              <h3>9.2 Responsabilité des utilisateurs</h3>
              <p>
                Respect des lois, des droits d’autrui (auteur, vie privée, image, réputation), et confidentialité des
                identifiants. Obligation de signaler tout accès non autorisé au compte.
              </p>
              <h3>9.3 Force majeure</h3>
              <p>
                Aucune partie n’est responsable en cas d’évènement de force majeure (catastrophes naturelles, incendies,
                grèves, pannes électriques, cyberattaques massives, etc.).
              </p>
            </section>

            {/* 10 */}
            <section id="cgu-10">
              <h2>10. Modifications des Conditions Générales d’Utilisation</h2>
              <p>
                EduKaraib peut modifier ou mettre à jour les présentes CGU à tout moment (évolutions légales, techniques
                ou fonctionnelles). Les utilisateurs seront informés par e-mail (adresse du compte) ou via un avis publié
                sur le Site. La version mise à jour entre en vigueur à la date indiquée dans la notification ou, à défaut,
                à compter de sa mise en ligne. L’utilisation continue du Site vaut acceptation.
              </p>
            </section>

            {/* 11 */}
            <section id="cgu-11">
              <h2>11. Disponibilité du service</h2>
              <p>
                EduKaraib s’efforce de maintenir un accès continu au Site 24h/24 et 7j/7, sauf maintenance, mise à jour
                ou incident indépendant de sa volonté. Aucune responsabilité ne peut être engagée pour indisponibilité
                temporaire, ralentissements ou difficultés de connexion.
              </p>
            </section>

            {/* 12 */}
            <section id="cgu-12">
              <h2>12. Utilisation par des mineurs</h2>
              <h3>12.1 Autorisation parentale</h3>
              <p>
                L’inscription d’un utilisateur mineur doit être réalisée ou validée par son représentant légal (parent ou
                tuteur), qui demeure responsable de son activité.
              </p>
              <h3>12.2 Protection et sécurité</h3>
              <p>
                EduKaraib assure une vigilance sur les échanges et contenus afin d’éviter tout harcèlement, abus ou
                contact inapproprié. Tout signalement impliquant un mineur est traité en priorité et peut être transmis
                aux autorités compétentes.
              </p>
              <h3>12.3 Signalement</h3>
              <p>
                Signalements à : <a href="mailto:contact@edukaraib.com">contact@edukaraib.com</a>.
              </p>
            </section>

            {/* 13 */}
            <section id="cgu-13">
              <h2>13. Loi applicable et juridiction compétente (Guyane française)</h2>
              <p>
                Les présentes CGU sont régies par le <strong>droit français</strong>, applicable en{" "}
                <strong>Guyane française</strong>. Tout litige relatif à leur interprétation, exécution ou validité
                relève de la compétence exclusive des <strong>tribunaux du ressort de la Cour d’appel de Cayenne</strong>,
                sauf disposition légale contraire.
              </p>
              <p>
                En cas de litige avec un consommateur, un recours gratuit à un dispositif de <strong>médiation de la
                consommation</strong> est possible, conformément au Code de la consommation.
              </p>
            </section>

            {/* 14 */}
            <section id="cgu-14">
              <h2>14. Contact</h2>
              <p>
                Pour toute question, demande d’information ou signalement relatif aux présentes CGU ou à l’utilisation du
                Site, contactez :{" "}
                <a href="mailto:contact@edukaraib.com" className="font-medium">
                  contact@edukaraib.com
                </a>
              </p>
            </section>

            {/* Footer note */}
            <hr className="my-10" />
            <p className="text-sm text-gray-500">
              Le présent document constitue la version intégrale des CGU d’EduKaraib. Il prévaut sur tout résumé ou
              présentation abrégée.
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}