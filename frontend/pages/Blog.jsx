import React from 'react';
import { Link } from 'react-router-dom';
import { useSEO } from '../hooks/useSEO';
import { blogPosts } from '../data/blogPosts';
import Footer from '../components/Footer';

export default function Blog() {
  useSEO({
    title: 'Blog — Conseils cours particuliers aux Caraïbes',
    description: 'Guides et conseils pour trouver le meilleur professeur particulier en Martinique, Guadeloupe et Guyane. Tarifs, méthodes, matières : tout ce qu'il faut savoir.',
    url: '/blog',
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-primary mb-8">
          ← Retour à l'accueil
        </Link>
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
          Blog EduKaraib
        </h1>
        <p className="text-gray-600 mb-10 text-lg">
          Conseils, tarifs et guides pour trouver le meilleur soutien scolaire aux Caraïbes.
        </p>

        <div className="grid gap-6">
          {blogPosts.map(post => (
            <Link
              key={post.slug}
              to={`/blog/${post.slug}`}
              className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm hover:shadow-md transition group"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  {post.subject}
                </span>
                <span className="text-xs text-gray-400">{post.island}</span>
                <span className="text-xs text-gray-400">·</span>
                <span className="text-xs text-gray-400">{post.readingTime} min de lecture</span>
              </div>
              <h2 className="text-xl font-bold text-gray-900 group-hover:text-primary transition mb-2">
                {post.title}
              </h2>
              <p className="text-gray-600 text-sm line-clamp-2">{post.description}</p>
              <span className="inline-block mt-3 text-sm font-semibold text-primary">
                Lire l'article →
              </span>
            </Link>
          ))}
        </div>
      </div>
      <Footer />
    </div>
  );
}
