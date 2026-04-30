import React from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useSEO } from '../hooks/useSEO';
import { blogPosts } from '../data/blogPosts';
import Footer from '../components/Footer';

export default function BlogPost() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const post = blogPosts.find(p => p.slug === slug);

  useSEO(post ? {
    title: post.title,
    description: post.description,
    url: `/blog/${post.slug}`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      author: { '@type': 'Organization', name: 'EduKaraib' },
      publisher: {
        '@type': 'Organization',
        name: 'EduKaraib',
        logo: { '@type': 'ImageObject', url: 'https://edukaraib.com/edukaraib_logo.png' },
      },
      mainEntityOfPage: `https://edukaraib.com/blog/${post.slug}`,
    },
  } : { title: 'Article introuvable' });

  if (!post) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-gray-600">Article introuvable.</p>
        <Link to="/blog" className="text-primary font-semibold hover:underline">← Retour au blog</Link>
      </div>
    );
  }

  const otherPosts = blogPosts.filter(p => p.slug !== slug).slice(0, 3);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link to="/blog" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-primary mb-8">
          ← Retour au blog
        </Link>

        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
            {post.subject}
          </span>
          <span className="text-xs text-gray-400">{post.island}</span>
          <span className="text-xs text-gray-400">·</span>
          <span className="text-xs text-gray-400">{post.readingTime} min de lecture</span>
          <span className="text-xs text-gray-400">·</span>
          <span className="text-xs text-gray-400">
            {new Date(post.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
        </div>

        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4 leading-tight">
          {post.title}
        </h1>
        <p className="text-lg text-gray-600 mb-10 border-l-4 border-primary pl-4">
          {post.description}
        </p>

        <article className="prose prose-gray max-w-none">
          {post.sections.map((section, i) => (
            <section key={i} className="mb-8">
              <h2 className="text-xl font-bold text-gray-900 mb-3">{section.heading}</h2>
              <p className="text-gray-700 leading-relaxed">{section.content}</p>
            </section>
          ))}
        </article>

        <div className="mt-12 bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 rounded-2xl p-6 text-center">
          <p className="text-lg font-bold text-gray-900 mb-2">Prêt à trouver votre professeur ?</p>
          <p className="text-gray-600 text-sm mb-4">
            Plus de 50 professeurs disponibles en Martinique, Guadeloupe et Guyane.
          </p>
          <Link
            to="/search"
            className="inline-block bg-primary text-white font-semibold px-6 py-3 rounded-xl hover:bg-primary/90 transition"
          >
            Trouver un professeur
          </Link>
        </div>

        {otherPosts.length > 0 && (
          <div className="mt-12">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Articles similaires</h3>
            <div className="grid gap-4">
              {otherPosts.map(p => (
                <Link
                  key={p.slug}
                  to={`/blog/${p.slug}`}
                  className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition group"
                >
                  <p className="font-semibold text-gray-900 group-hover:text-primary transition text-sm">{p.title}</p>
                  <p className="text-xs text-gray-500 mt-1">{p.readingTime} min · {p.island}</p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
