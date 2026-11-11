import React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { useSEO } from '../hooks/useSEO';
import { guideParSlug, jsonLdGuide, lienGuide, dateMajFr, GUIDES } from '../lib/guides';

// Un guide public : une question, la réponse en tête, les sources (11/11/2026).
// Le même contenu est prérendu en HTML pour les robots (scripts/prerendu-guides.mjs).

export default function Guide() {
  const { slug } = useParams();
  const g = guideParSlug(slug);
  useSEO(g ? { title: g.title.replace(/ — EduKaraib$/, ''), description: g.description, url: `/guides/${g.slug}`, jsonLd: jsonLdGuide(g)[1] } : {});
  if (!g) return <Navigate to="/guides" replace />;

  const autres = GUIDES.filter((x) => x.slug !== g.slug
    && (x.territoires.some((t) => g.territoires.includes(t)) || !g.territoires.length)).slice(0, 4);

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Link to="/guides" className="text-sm text-primary hover:underline">← Tous les guides</Link>
        <h1 className="mt-3 text-3xl md:text-4xl font-extrabold text-gray-900 leading-tight">{g.titre}</h1>
        <p className="text-xs text-gray-400 mt-2">Mis à jour le {dateMajFr()}</p>

        <div className="mt-6 p-5 rounded-2xl bg-sky-50 border border-sky-200">
          <p className="text-xs font-bold uppercase tracking-wide text-sky-700 mb-2">La réponse</p>
          <p className="text-gray-800 leading-relaxed">{g.reponse}</p>
        </div>

        {g.sections.map((s) => (
          <section key={s.titre} className="mt-8">
            <h2 className="text-xl font-bold text-gray-900 mb-3">{s.titre}</h2>
            {(s.paragraphes || []).map((p) => <p key={p} className="text-gray-700 leading-relaxed mb-3">{p}</p>)}
            {s.liste && (
              <ul className="space-y-2">
                {s.liste.map((l) => (
                  <li key={l} className="flex gap-2 text-gray-700">
                    <CheckCircle2 className="text-sky-500 w-4 h-4 mt-1 flex-shrink-0" /> <span>{l}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        {g.faqs.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-bold text-gray-900 mb-3">Questions fréquentes</h2>
            <dl className="space-y-4">
              {g.faqs.map((f) => (
                <div key={f.q}>
                  <dt className="font-semibold text-gray-900">{f.q}</dt>
                  <dd className="text-gray-700 mt-1 leading-relaxed">{f.a}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {g.sources.length > 0 && (
          <section className="mt-10">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-2">Sources</h2>
            <ul className="text-sm text-gray-600 space-y-1 list-disc pl-5">
              {g.sources.map((s) => (
                <li key={s.label}>
                  {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">{s.label}</a> : s.label}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-10 p-6 rounded-2xl bg-primary text-white text-center">
          <p className="font-bold text-lg text-white">{g.cta === 'methode' ? 'La méthode complète, gratuite' : 'Trouver un professeur particulier'}</p>
          <p className="text-white/80 text-sm mt-1">{g.cta === 'methode' ? 'Les techniques et un guide PDF à télécharger.' : 'Tarif affiché avant de réserver, paiement en ligne, visio intégrée.'}</p>
          <Link to={lienGuide(g)} className="inline-flex items-center gap-2 mt-4 bg-white text-primary font-bold px-6 py-3 rounded-xl hover:bg-sky-50">
            {g.cta === 'methode' ? 'Voir la méthode' : 'Voir les professeurs'} <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {autres.length > 0 && (
          <section className="mt-10">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">À lire aussi</h2>
            <ul className="space-y-2">
              {autres.map((a) => (
                <li key={a.slug}><Link to={`/guides/${a.slug}`} className="text-primary hover:underline">{a.titre}</Link></li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
