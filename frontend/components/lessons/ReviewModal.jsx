import React, { useEffect, useMemo, useState } from "react";
import { auth, db } from "../../lib/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

function Star({ filled }) {
  return (
    <span className={filled ? "text-yellow-500" : "text-gray-300"} style={{ fontSize: 22 }}>
      ★
    </span>
  );
}

export default function ReviewModal({ open, onClose, lesson, onSent }) {
  const [rating, setRating] = useState(5);
  const [hover, setHover] = useState(null);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);

  const [promo, setPromo] = useState({ status: "idle", code: "", emailSent: null }); 
  // status: idle | success | error

  useEffect(() => {
    if (open) {
      setRating(5);
      setHover(null);
      setComment("");
      setSending(false);
      setPromo({ status: "idle", code: "", emailSent: null });
    }
  }, [open]);

  const displayName = useMemo(() => {
    if (lesson?.studentName) return lesson.studentName;
    return "";
  }, [lesson]);

  const callPromoApi = async () => {
    try {
      const token = await auth.currentUser?.getIdToken?.();
      if (!token) return;

      const resp = await fetch("/api/create-promo-first-review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ lessonId: lesson.id }),
      });

      const data = await resp.json().catch(() => ({}));

      if (data?.ok && data?.code) {
        setPromo({ status: "success", code: data.code, emailSent: !!data.emailSent });
      } else {
        setPromo({ status: "error", code: "", emailSent: null });
        console.warn("Promo API:", resp.status, data);
      }
    } catch (e) {
      console.warn("Promo call failed:", e);
      setPromo({ status: "error", code: "", emailSent: null });
    }
  };

  const submit = async () => {
    if (!lesson?.id) return;
    setSending(true);

    try {
      // 1) Créer l’avis
      await addDoc(collection(db, "reviews"), {
        lesson_id: lesson.id,
        student_id: lesson.student_id,
        teacher_id: lesson.teacher_id,
        rating: Number(rating),
        comment: comment.trim(),
        created_at: serverTimestamp(),
        left_by_parent_id: auth.currentUser?.uid || null,
      });

      // 2) Notif prof
      await addDoc(collection(db, "notifications"), {
        user_id: lesson.teacher_id,
        type: "review_left",
        with_id: lesson.student_id,
        lesson_id: lesson.id,
        message: `Un nouvel avis a été laissé pour le cours (${lesson.subject_id || "Cours"}).`,
        created_at: serverTimestamp(),
        read: false,
      });

      // 3) Promo + email (on affiche le résultat dans le modal)
      await callPromoApi();

      // callback
      onSent?.();
    } catch (e) {
      console.error(e);
      setPromo({ status: "error", code: "", emailSent: null });
    } finally {
      setSending(false);
    }
  };

  const copyCode = async () => {
    if (!promo.code) return;
    try {
      await navigator.clipboard.writeText(promo.code);
    } catch {}
  };

  if (!open) return null;

  const effectiveRating = hover ?? rating;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* overlay */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        onClick={sending ? undefined : onClose}
      />

      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden animate-[modalIn_.18s_ease-out]">
        {/* header */}
        <div className="px-6 py-4 border-b bg-gradient-to-r from-emerald-600 to-green-500 text-white">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold">Laisser un avis</h3>
              <p className="text-white/90 text-sm mt-0.5">
                {displayName ? `Au nom de ${displayName}` : "Merci pour ton retour 🙏"}
              </p>
            </div>

            <button
              onClick={sending ? undefined : onClose}
              className="text-white/90 hover:text-white text-xl leading-none"
              aria-label="Fermer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* body */}
        <div className="p-6 space-y-5">
          {/* Rating stars */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">Note</label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setRating(n)}
                  className="p-1"
                  aria-label={`${n} étoiles`}
                >
                  <Star filled={n <= effectiveRating} />
                </button>
              ))}
              <span className="ml-2 text-sm text-gray-600">{effectiveRating}/5</span>
            </div>
          </div>

          {/* Comment */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Commentaire <span className="text-gray-400">(optionnel)</span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              className="w-full border rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="Partagez le ressenti…"
            />
          </div>

          {/* Promo result */}
          {promo.status === "success" && promo.code && (
            <div className="rounded-2xl border bg-emerald-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-emerald-900">🎟️ Code promo débloqué</div>
                  <div className="text-sm text-emerald-800 mt-1">
                    +1h offerte en plus sur le pack 5h
                  </div>
                </div>
                <button
                  type="button"
                  onClick={copyCode}
                  className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 text-white hover:opacity-90"
                >
                  Copier
                </button>
              </div>

              <div className="mt-3 font-mono text-lg tracking-wider bg-white rounded-xl px-4 py-3 border">
                {promo.code}
              </div>
              
            </div>
          )}

          {promo.status === "error" && (
            <div className="rounded-2xl border bg-red-50 p-4 text-sm text-red-700">
              ❌ Avis envoyé, mais la génération du code promo / email a échoué.
            </div>
          )}
        </div>

        {/* footer */}
        <div className="px-6 py-4 border-t flex justify-end gap-2 bg-gray-50">
          <button
            onClick={onClose}
            disabled={sending}
            className="px-4 py-2 rounded-xl bg-white border hover:bg-gray-100"
          >
            Fermer
          </button>

          <button
            onClick={submit}
            disabled={sending}
            className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:opacity-90 disabled:opacity-60"
          >
            {sending ? "Envoi…" : "Envoyer"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: translateY(6px) scale(.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}