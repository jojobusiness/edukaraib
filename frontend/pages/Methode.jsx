// Page /methode — le guide de révision, avec un appel à l'action fort.
// Plan : docs/plans/PLAN_PAGE_METHODE_15-10-2026.md (15/10/2026).
//
// Pourquoi elle existe : les commentaires « MÉTHODE » arrivent sous les Shorts
// YouTube, où AUCUN lien n'est cliquable. L'adresse doit donc se taper de
// mémoire : edukaraib.com/methode. Le contenu vient du guide déjà écrit
// (EduKarib/01_MARKETING/fiche-revision-02-10-2026/) : on le découpe, on ne le
// réécrit pas.
//
// Arbitrage de Joseph (15/10) : la méthode se lit EN ENTIER sans inscription
// (la promesse de la vidéo est tenue), seul le PDF à garder coûte une
// inscription express. `GATE_PDF` permet de changer d'avis sans toucher au reste.
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { useSEO } from '../hooks/useSEO';
import { auth } from '../lib/firebase';
import { pixelTrack } from '../lib/metaPixel';
import { BAC_CAMPAIGN } from '../config/campaigns';
import { setChatDraft } from '../lib/bacCampaign';

// 'A' = PDF libre · 'B' = PDF après inscription express · 'C' = tout fermé
export const GATE_PDF = 'B';
const PDF_URL = '/guide/reviser-pour-de-vrai.pdf';

// Les matières du sélecteur suivent la campagne bac : elle est déjà tenue à
// jour sur l'offre réelle (diag-offre-profs retire les matières sans prof).
const MATIERES = BAC_CAMPAIGN.subjects;

/* ───────────────────────── contenu, repris du guide ───────────────────────── */

const NIVEAUX = [
  {
    n: 1,
    titre: 'Tu relis',
    quoi: 'Tu relis le cours, tu surlignes, tu recopies au propre. Le support est ouvert devant toi tout le temps.',
    effet: 'Tu reconnais, tu ne te souviens pas. Note plafond : la moyenne, si le contrôle est facile.',
  },
  {
    n: 2,
    titre: 'Tu te testes',
    quoi: 'Tu fermes le cours et tu essaies de le restituer. Tu refais des exercices sans la correction sous les yeux.',
    effet: "C'est inconfortable, et c'est le signe que ça rentre. C'est le saut le plus rentable du guide.",
  },
  {
    n: 3,
    titre: 'On te corrige',
    quoi: "Quelqu'un regarde ce que tu as produit et te dit où ça coince — pas « c'est faux », mais « tu as appliqué la bonne formule au mauvais cas ».",
    effet: "Tu corriges la cause, pas le symptôme. C'est ce qui débloque une matière entière.",
  },
];

const METHODES = [
  {
    titre: 'Le blurting — la page blanche',
    quand: 'Après chaque cours, et avant chaque séance de révision.',
    comment: "Lis une notion une fois. Ferme tout. Sur une feuille blanche, écris tout ce dont tu te souviens, en vrac, pendant 5 minutes. Puis rouvre le cours et complète dans une autre couleur ce que tu avais oublié.",
    pourquoi: "Ce qui apparaît dans l'autre couleur est exactement — et uniquement — ce qu'il te reste à apprendre. Ton programme de révision s'écrit tout seul.",
    piege: "S'arrêter quand c'est dur. Les 30 dernières secondes, quand tu ne trouves plus rien, sont les plus utiles de la séance.",
  },
  {
    titre: 'La répétition espacée — le calendrier',
    quand: "Pour tout ce qui s'apprend par cœur : définitions, dates, formules, vocabulaire, théorèmes.",
    comment: 'Tu ne révises pas une notion une fois longtemps. Tu la revois plusieurs fois, de plus en plus espacé : le jour du cours, puis J+1, J+3, J+7, J+15, J+30. Cinq minutes à chaque fois, trois sur la fin.',
    pourquoi: '21 minutes étalées sur un mois pour un chapitre retenu jusqu\'au bac. Contre 3 heures la veille pour un chapitre oublié en dix jours.',
    piege: "« Je le ferai quand j'aurai le temps. » Écris les 5 dates dans ton agenda le jour du cours, sinon ça n'existe pas.",
  },
  {
    titre: 'Cornell — la prise de notes qui sert deux fois',
    quand: 'Pendant le cours, pour ne pas avoir à tout retravailler après.',
    comment: "Divise ta feuille en trois. À droite (2/3) : tes notes normales. À gauche (1/3) : les questions et les mots-clés, écrits après le cours. En bas : 3 lignes de résumé avec tes mots.",
    pourquoi: 'Pour réviser, tu caches la colonne de droite et tu réponds aux questions de gauche. Ta prise de notes devient le contrôle blanc.',
    piege: 'Remplir la colonne de gauche pendant le cours. Elle se remplit après, à froid, sinon ce ne sont que des titres.',
  },
  {
    titre: 'Feynman — explique-le à un enfant de 10 ans',
    quand: "Pour tout ce qui se comprend plutôt que s'apprend : une démonstration, un mécanisme, une cause historique.",
    comment: "Explique la notion à voix haute, comme à quelqu'un qui n'y connaît rien, sans aucun mot de vocabulaire du cours. À voix haute vraiment : dans ta tête, ton cerveau saute les trous sans te prévenir.",
    pourquoi: "Si tu es obligé de replacer le mot technique pour que ça tienne debout, c'est que tu récites au lieu de comprendre.",
    piege: "Le faire une fois et considérer que c'est acquis. Refais-le trois jours plus tard : c'est là que tu vois ce qui a tenu.",
  },
  {
    titre: 'Les exercices du niveau du contrôle',
    quand: 'Maths, physique, SVT, SES, NSI — toutes les matières où on te demande de faire, pas de réciter.',
    comment: "Laisse les exercices d'application du début de chapitre. Prends ceux de la fin, ou mieux : les anciens contrôles. Si tu bloques, regarde la correction, referme-la, et refais l'exercice seul depuis le début.",
    pourquoi: 'Trois fois le même type d\'exercice vaut mieux qu\'une fois trois exercices différents : la méthode finit par sortir sans réfléchir.',
    piege: "Le plus coûteux du guide : lire une correction et comprendre, ce n'est pas savoir refaire. Tant que tu ne l'as pas refait seul, tu ne sais pas le faire.",
  },
];

const SEANCE = [
  ['5 min', 'Blurting de la séance précédente, feuille blanche', "C'est ta répétition espacée. Ça ne coûte rien et ça sauve tout."],
  ['20 min', 'La notion du jour : lecture une fois, puis blurting, puis complément en couleur', 'Tu produis au lieu de consommer.'],
  ['15 min', 'Exercices de niveau contrôle, ou Feynman à voix haute selon la matière', "Tu entraînes le geste qu'on te demandera."],
  ['5 min', 'Tu écris les 3 choses que tu as ratées aujourd\'hui', 'Ce sont elles que tu rouvriras demain.'],
];

/* ───────────────────────────── petits composants ──────────────────────────── */

function Methode({ m, ouvert, onToggle }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={ouvert}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="font-bold text-slate-900">{m.titre}</span>
        <span className="text-primary text-xl leading-none" aria-hidden="true">{ouvert ? '−' : '+'}</span>
      </button>
      {ouvert && (
        <div className="space-y-3 border-t border-slate-100 px-5 py-4 text-sm text-slate-700">
          <p><span className="font-semibold text-slate-900">Quand :</span> {m.quand}</p>
          <p><span className="font-semibold text-slate-900">Comment :</span> {m.comment}</p>
          <p><span className="font-semibold text-slate-900">Pourquoi ça marche :</span> {m.pourquoi}</p>
          <p className="rounded-xl bg-amber-50 p-3 text-amber-900">
            <span className="font-semibold">⚠️ Le piège :</span> {m.piege}
          </p>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── la page ──────────────────────────────────── */

export default function MethodePage() {
  useSEO({
    title: 'Réviser pour de vrai : la méthode gratuite | EduKaraib',
    description:
      "Pourquoi on oublie tout le lendemain, et les 5 méthodes qui font tenir une leçon. Guide gratuit pour élèves et parents des Antilles, de Guyane, de La Réunion et de Mayotte.",
    url: 'https://edukaraib.com/methode',
  });

  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [matiere, setMatiere] = useState('');
  const [ouverte, setOuverte] = useState(0);
  const pdfDemande = useRef(false);

  const telecharger = () => {
    pixelTrack('Lead', { content_name: 'guide_methode' });
    window.location.assign(PDF_URL); // window.open est bloqué sur mobile après un await
  };

  // Retour d'inscription avec ?pdf=1 : on tient la promesse tout de suite.
  useEffect(() => {
    if (params.get('pdf') !== '1' || pdfDemande.current) return;
    pdfDemande.current = true;
    toast.success('Ton guide se télécharge. Prochaine étape : un prof pour te tester.');
    telecharger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const demanderPdf = () => {
    if (GATE_PDF === 'A' || auth.currentUser) return telecharger();
    navigate(`/register?express=1&next=${encodeURIComponent('/methode?pdf=1')}`);
  };

  // CTA principal : ÉCRIRE à un prof. Moins engageant que « réserver », et ça
  // marche même avec un prof qui n'a pas encore ouvert de créneau.
  const ecrireAUnProf = () => {
    setChatDraft(
      `Bonjour, j'ai lu la méthode de révision d'EduKaraib et j'ai besoin d'aide`
      + `${matiere ? ` en ${matiere}` : ''}. Quelles sont vos disponibilités cette semaine ?`,
    );
    const recherche = `/search${matiere ? `?subject=${encodeURIComponent(matiere)}` : ''}`;
    navigate(recherche);
  };

  const reserver = () => navigate(`/search${matiere ? `?subject=${encodeURIComponent(matiere)}` : ''}`);

  const SelecteurMatiere = ({ id }) => (
    <div className="mt-4">
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-slate-700">
        Ta matière qui coince
      </label>
      <select
        id={id}
        value={matiere}
        onChange={(e) => setMatiere(e.target.value)}
        className="w-full rounded-xl border border-slate-300 px-3 py-3 text-base sm:w-64"
      >
        <option value="">Toutes les matières</option>
        {MATIERES.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </div>
  );

  const BoutonProf = ({ children = 'Écrire à un prof' }) => (
    <button
      type="button"
      onClick={ecrireAUnProf}
      className="w-full rounded-xl bg-primary px-6 py-4 text-base font-bold text-white shadow-lg transition hover:bg-primary-dark sm:w-auto"
    >
      {children}
    </button>
  );

  return (
    <>
      <Navbar />

      <main className="bg-white pb-28 sm:pb-12">
        {/* 1. Hero */}
        <section className="bg-gradient-to-b from-emerald-50 to-white">
          <div className="mx-auto max-w-3xl px-4 py-12">
            <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-primary">Guide gratuit</p>
            <h1 className="text-3xl font-extrabold leading-tight text-slate-900 sm:text-4xl">
              Tu révises des heures et tu oublies tout le lendemain ?
              <span className="block text-primary">Ce n'est pas toi, c'est la méthode.</span>
            </h1>
            <p className="mt-4 text-lg text-slate-600">
              Ce que personne ne t'apprend à faire entre la fin du cours et le jour du contrôle.
              Applicable ce soir, sans rien acheter.
            </p>
            <SelecteurMatiere id="matiere-hero" />
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <BoutonProf>Trouver un prof cette semaine</BoutonProf>
              <button type="button" onClick={demanderPdf} className="text-sm font-semibold text-primary underline">
                Ou télécharge le guide complet (11 pages)
              </button>
            </div>
          </div>
        </section>

        {/* 2. La seule idée du guide */}
        <section className="mx-auto max-w-3xl px-4 py-10">
          <h2 className="text-2xl font-bold text-slate-900">Reconnaître, ce n'est pas se souvenir</h2>
          <p className="mt-3 text-slate-700">
            Quand tu relis ton cours, ton cerveau fait une seule chose : il <strong>reconnaît</strong>. Il voit la
            phrase, elle lui est familière, et il t'envoie un signal agréable qui veut dire « ça, je le sais ».
            Ce signal est un mensonge. Le jour du contrôle, la feuille est blanche : on ne te demande pas de
            reconnaître, on te demande de <strong>ressortir l'information sans le support</strong>.
          </p>
          <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/5 p-5">
            <p className="font-bold text-slate-900">Le test, maintenant, en 3 minutes</p>
            <p className="mt-2 text-slate-700">
              Prends le dernier cours que tu as « révisé ». Ferme-le. Sur une feuille blanche, écris tout ce que
              tu en sais. L'écart entre ce que tu croyais savoir et ce qui est réellement sur la feuille, c'est
              ton vrai niveau. C'est aussi, exactement, ta note.
            </p>
          </div>
          <p className="mt-5 text-slate-700">
            Une séance de révision où tu n'as pas eu l'impression de galérer n'est pas une séance de révision :
            c'est une lecture, et ça compte pour zéro. <strong>Se tester n'est pas une façon de vérifier qu'on a
            appris : c'est la façon d'apprendre.</strong>
          </p>
        </section>

        {/* 3. Diagnostic */}
        <section className="bg-slate-50 py-10">
          <div className="mx-auto max-w-3xl px-4">
            <h2 className="text-2xl font-bold text-slate-900">Tu révises à quel niveau ?</h2>
            <p className="mt-2 text-slate-600">
              La plupart des élèves sont au niveau 1 et croient être au niveau 2.
            </p>
            <div className="mt-5 space-y-4">
              {NIVEAUX.map((n) => (
                <div key={n.n} className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="font-bold text-slate-900">
                    <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm text-white">
                      {n.n}
                    </span>
                    {n.titre}
                  </p>
                  <p className="mt-2 text-sm text-slate-700">{n.quoi}</p>
                  <p className="mt-2 text-sm font-semibold text-primary">{n.effet}</p>
                </div>
              ))}
            </div>
            <p className="mt-5 text-slate-700">
              <strong>Le niveau 3 ne s'atteint pas tout seul.</strong> Un angle mort, par définition, ne se voit
              pas de l'intérieur : si tu avais compris que tu n'avais pas compris, tu l'aurais déjà corrigé.
              C'est la seule chose de ce guide que tu ne peux pas faire seul.
            </p>
          </div>
        </section>

        {/* 4. Les 5 méthodes */}
        <section className="mx-auto max-w-3xl px-4 py-10">
          <h2 className="text-2xl font-bold text-slate-900">Les 5 méthodes qui marchent</h2>
          <p className="mt-2 text-slate-600">
            Toutes te forcent à produire quelque chose. Aucune ne consiste à lire. Tu n'as pas besoin des cinq :
            le blurting seul, fait sérieusement tous les soirs, suffit à passer du niveau 1 au niveau 2.
          </p>
          <div className="mt-5 space-y-3">
            {METHODES.map((m, i) => (
              <Methode key={m.titre} m={m} ouvert={ouverte === i} onToggle={() => setOuverte(ouverte === i ? -1 : i)} />
            ))}
          </div>
        </section>

        {/* 5. CTA du milieu */}
        <section className="bg-primary/5 py-10">
          <div className="mx-auto max-w-3xl px-4 text-center">
            <h2 className="text-2xl font-bold text-slate-900">
              Tu as compris la méthode. Ce qui manque, c'est quelqu'un qui te teste.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-slate-600">
              Écris à un prof de Guyane ou des Antilles, dis-lui où ça coince, il te répond avec ses
              disponibilités. Le premier message est gratuit et ne t'engage à rien.
            </p>
            <div className="mt-5 flex flex-col items-center gap-3">
              <BoutonProf />
              <button type="button" onClick={reserver} className="text-sm font-semibold text-primary underline">
                Ou voir directement les profs disponibles
              </button>
            </div>
          </div>
        </section>

        {/* 6. La séance type */}
        <section className="mx-auto max-w-3xl px-4 py-10">
          <h2 className="text-2xl font-bold text-slate-900">45 minutes par jour suffisent</h2>
          <p className="mt-2 text-slate-600">
            Tu n'as pas besoin de six heures le dimanche. Tu as besoin de régularité et d'une séance découpée.
          </p>
          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
            {SEANCE.map(([duree, quoi, pourquoi]) => (
              <div key={duree + quoi} className="flex flex-col gap-1 border-b border-slate-100 p-4 last:border-0 sm:flex-row sm:gap-4">
                <span className="w-16 shrink-0 font-bold text-primary">{duree}</span>
                <span className="flex-1 text-slate-800">{quoi}</span>
                <span className="flex-1 text-sm text-slate-500">{pourquoi}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 7. Le PDF */}
        <section className="mx-auto max-w-3xl px-4 pb-10">
          <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-white p-6 text-center">
            <p className="text-xl font-bold text-slate-900">Le guide complet, 11 pages, à garder</p>
            <p className="mx-auto mt-2 max-w-lg text-slate-600">
              La check-list de J-7 au jour J, la semaine type, les 8 erreurs qui coûtent le plus, et ce qu'il
              faut faire matière par matière.
              {GATE_PDF !== 'A' && " Il te faut un compte — c'est gratuit et ça prend un clic avec Google."}
            </p>
            <button
              type="button"
              onClick={demanderPdf}
              className="mt-4 w-full rounded-xl bg-slate-900 px-6 py-4 font-bold text-white shadow-lg transition hover:bg-slate-800 sm:w-auto"
            >
              Télécharger le guide complet (PDF)
            </button>
          </div>
        </section>

        {/* 8. Bloc parent */}
        <section className="bg-slate-50 py-10">
          <div className="mx-auto max-w-3xl px-4">
            <h2 className="text-2xl font-bold text-slate-900">Votre enfant révise, mais les notes ne suivent pas ?</h2>
            <p className="mt-3 text-slate-700">
              Ce n'est presque jamais un problème de travail : c'est qu'il relit au lieu de se tester, et que
              personne ne lui dit <em>où</em> ça coince. Un professeur règle ce point en quelques séances.
              Nos professeurs sont en Guyane et aux Antilles, en présentiel ou en visio, et vous écrivez au
              professeur avant de réserver quoi que ce soit.
            </p>
            <div className="mt-5">
              <BoutonProf>Écrire à un professeur</BoutonProf>
            </div>
          </div>
        </section>

        {/* 9. CTA final */}
        <section className="mx-auto max-w-3xl px-4 py-12 text-center">
          <h2 className="text-2xl font-bold text-slate-900">Commence ce soir</h2>
          <p className="mt-3 text-slate-600">
            Fais ton premier blurting aujourd'hui. Et pour la partie que tu ne peux pas faire seul, écris à un
            prof : il te répond avec ses disponibilités.
          </p>
          <div className="mt-5 flex flex-col items-center gap-3">
            <BoutonProf />
            <Link to="/contact" className="text-sm font-semibold text-primary underline">
              Une question ? Écris-nous directement
            </Link>
          </div>
        </section>
      </main>

      {/* Barre collante mobile : le trafic vient des Shorts, le pouce est en bas */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:hidden">
        <button
          type="button"
          onClick={ecrireAUnProf}
          className="w-full rounded-xl bg-primary px-6 py-3 font-bold text-white shadow"
        >
          Un prof près de chez toi ou en visio →
        </button>
      </div>

      <Footer />
    </>
  );
}
