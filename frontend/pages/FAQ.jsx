import { useState } from 'react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { useSEO } from '../hooks/useSEO';
import { Link } from 'react-router-dom';

const FAQS = [
  {
    q: "Quels sont les tarifs moyens des cours particuliers ?",
    a: "Les tarifs varient selon la matiere, le niveau et le mode de cours. En Martinique et Guadeloupe, comptez en general entre 20 et 60 EUR par heure. Les packs 5h et 10h offrent une remise de 10 % environ par rapport au tarif horaire.",
  },
  {
    q: "Comment fonctionne l'essai gratuit ?",
    a: "Si le professeur propose un essai gratuit (1h), vous verrez un bouton vert 'Essai gratuit' sur son profil. Vous choisissez un creneau dans son agenda et envoyez la demande. Le professeur accepte ou refuse comme pour toute reservation. Chaque eleve ne peut faire qu'un seul essai par professeur.",
  },
  {
    q: "Puis-je avoir des cours en visio depuis n'importe ou ?",
    a: "Oui. De nombreux professeurs proposent des cours en visioconference, que vous soyez en Martinique, en Guadeloupe, en Guyane, a Saint-Martin ou meme en France metropolitaine. Filtrez par mode 'Visio' dans la recherche.",
  },
  {
    q: "Comment fonctionne le paiement ?",
    a: "Le paiement est securise via Stripe (carte bancaire, Apple Pay, Google Pay). Vous pouvez aussi payer en 3 fois sans frais. La plateforme ne prelevement qu'une commission de service — le professeur recoit directement sa part.",
  },
  {
    q: "Puis-je me faire rembourser ?",
    a: "Oui. Depuis votre historique de paiements, un bouton 'Demander un remboursement' est disponible. Le remboursement est traite sous 5 a 10 jours ouvrés sur la carte d'origine.",
  },
  {
    q: "Comment devenir professeur sur EduKaraib ?",
    a: "Inscrivez-vous avec le role 'Professeur', remplissez votre profil (matieres, tarifs, disponibilites, bio), activez votre compte Stripe pour recevoir des virements, puis attendez vos premieres demandes. Votre profil est visible des que vous activez votre offre.",
  },
  {
    q: "Comment les professeurs recoivent-ils leur paiement ?",
    a: "Les professeurs connectent un compte bancaire via Stripe Connect (verification d'identite KYC). Apres chaque lecon validee, ils declenchent le virement depuis leur tableau de bord. L'argent arrive directement sur leur IBAN.",
  },
  {
    q: "Y a-t-il des cours en groupe ?",
    a: "Oui, certains professeurs proposent des cours en groupe (jusqu'a 4-6 eleves). La capacite est indiquee sur leur profil. Les cours en groupe sont generalement moins chers a l'heure.",
  },
  {
    q: "Qu'est-ce que le programme de parrainage ?",
    a: "Chaque eleve ou parent dispose d'un lien de parrainage unique. Si un ami s'inscrit via ce lien et effectue son premier achat, vous recevez tous les deux un bon de reduction de 10 EUR. Le lien est accessible dans votre tableau de bord.",
  },
  {
    q: "EduKaraib est disponible dans quels territoires ?",
    a: "La plateforme couvre principalement la Martinique, la Guadeloupe, la Guyane, Saint-Martin et les autres DOM-TOM. Les cours en visio sont disponibles partout dans le monde.",
  },
  {
    q: "Comment contacter le support ?",
    a: "Utilisez le formulaire de contact sur la page /contact ou ecrivez directement a edukaraib@gmail.com. Nous repondons generalement sous 24h.",
  },
  {
    q: "Les paiements sont-ils securises ?",
    a: "Oui. Tous les paiements sont traites par Stripe, certifie PCI-DSS niveau 1. Aucune donnee de carte bancaire ne transite ou n'est stockee sur les serveurs EduKaraib.",
  },
];

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left font-semibold text-slate-800 hover:bg-gray-50 transition"
        aria-expanded={open}
      >
        <span>{q}</span>
        <span className="ml-4 shrink-0 text-primary text-xl leading-none">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 text-slate-600 text-sm leading-relaxed">
          {a}
        </div>
      )}
    </div>
  );
}

export default function FAQ() {
  useSEO({
    title: 'FAQ — Questions fréquentes | EduKaraib',
    description: 'Toutes les réponses à vos questions sur EduKaraib : tarifs, paiements, remboursements, essai gratuit, cours en visio, parrainage et plus.',
    url: '/faq',
  });

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-extrabold text-slate-900 mb-2">Questions fréquentes</h1>
        <p className="text-slate-500 mb-8">Tout ce que vous devez savoir sur EduKaraib.</p>

        <div className="space-y-3">
          {FAQS.map((item, i) => (
            <FAQItem key={i} q={item.q} a={item.a} />
          ))}
        </div>

        <div className="mt-10 bg-primary/5 border border-primary/20 rounded-2xl p-6 text-center">
          <p className="text-slate-700 font-semibold mb-3">Vous n'avez pas trouvé votre réponse ?</p>
          <Link
            to="/contact"
            className="inline-block bg-primary text-white font-semibold px-6 py-3 rounded-xl shadow hover:bg-primary/90 transition"
          >
            Contactez-nous
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
