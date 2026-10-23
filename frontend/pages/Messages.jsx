import React, { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Trash2 } from "lucide-react";
import { auth, db, storage } from "../lib/firebase";
import { consumeChatDraft } from "../lib/bacCampaign";
import AttachmentGrid from "../components/chat/AttachmentGrid";
import MediaLightbox from "../components/chat/MediaLightbox";
import Composer from "../components/chat/Composer";
import {
  kindDepuisMime,
  messageErreurUpload,
  nomSur,
  resumeAttachments,
} from "../lib/chatAttachments";
import {
  ref as sRef,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  getDocs,
  updateDoc,
  limit,
} from "firebase/firestore";
import { envoyerMail, lireProfil } from "../lib/profils";
import { toast } from 'sonner';
import { confirmer, demanderTexte } from '../components/ui/Dialogues';
import { etatLecture, libelleVu } from "../lib/etatLecture";

// --- EMAIL HELPERS (Messages.jsx) ---
// 🔒 23/10/2026 : on écrit à un identifiant ; le serveur trouve l'adresse.
async function notifyEmailUser(uid, { title, message, ctaUrl, ctaText = "Ouvrir" }) {
  await envoyerMail([uid], {
    title: title || "Nouveau message sur EduKaraib",
    message,
    ctaUrl: ctaUrl || `${window.location.origin}/smart-dashboard`,
    ctaText: ctaText || "Ouvrir la conversation",
  });
}
// --- /EMAIL HELPERS ---

// -------- Helpers communs --------

function pairKey(a, b) {
  return [a, b].sort().join("_");
}

// ── Helpers affichage style WhatsApp ──────────────────────────────────────────
function formatTime(ts) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function dateSeparatorLabel(date) {
  if (!date) return null;
  const d = date?.toDate ? date.toDate() : new Date(date);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(d, today)) return "Aujourd'hui";
  if (sameDay(d, yesterday)) return "Hier";
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

function getDayKey(ts) {
  if (!ts?.toDate) return null;
  const d = ts.toDate();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function buildName(p, uidFallback) {
  if (!p) return uidFallback ? `Utilisateur-${String(uidFallback).slice(0, 6)}` : "Utilisateur";
  const byFL = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  return (
    p.fullName ||
    p.full_name ||
    byFL ||
    p.name ||
    p.displayName ||
    (typeof p.email === "string" ? p.email.split("@")[0] : "") ||
    (uidFallback ? `Utilisateur-${String(uidFallback).slice(0, 6)}` : "Utilisateur")
  );
}
function buildAvatar(p) {
  if (!p) return "/avatar-default.png";
  return (
    p.avatarUrl ||
    p.avatar_url ||
    p.photoURL ||
    p.photo_url ||
    "/avatar-default.png"
  );
}

// 🔒 23/10/2026 : la fiche de l'autre vient de `profils` (copie publique)
async function fetchUserProfile(uid) {
  return lireProfil(uid);
}

/** Trouve / crée une conversation unique entre myUid et otherUid (fallback client) */
async function ensureConversationClient(myUid, otherUid) {
  const key = pairKey(myUid, otherUid);
  // array-contains obligatoire : sans lui, les règles refusent la requête
  // (elles ne peuvent pas prouver que `key` ne vise que mes conversations).
  const qConv = query(
    collection(db, "conversations"),
    where("participants", "array-contains", myUid),
    where("key", "==", key),
    limit(1)
  );
  const snap = await getDocs(qConv);
  if (!snap.empty) return snap.docs[0].id;

  const ref = await addDoc(collection(db, "conversations"), {
    participants: [myUid, otherUid],
    key,
    lastMessage: "",
    lastSentAt: serverTimestamp(),
    lastSender: "",
    created_at: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Envoie un fichier vers Firebase Storage et retourne la fiche d'attachement
 * stockée dans le document message.
 * @param {File} file
 * @param {string} conversationId
 * @param {string} uid
 * @param {(pct:number)=>void} onProgress
 */
async function uploadAttachment(file, conversationId, uid, onProgress) {
  const path = `chat/${conversationId}/${uid}/${Date.now()}_${nomSur(file.name)}`;
  const fileRef = sRef(storage, path);
  const task = uploadBytesResumable(fileRef, file, { contentType: file.type || undefined });

  await new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        if (snap.totalBytes) onProgress?.((snap.bytesTransferred / snap.totalBytes) * 100);
      },
      reject,
      resolve
    );
  });

  const url = await getDownloadURL(fileRef);
  return {
    url,
    storage_path: path,
    kind: kindDepuisMime(file.type),
    name: file.name || "fichier",
    size: file.size || 0,
    mime: file.type || "",
  };
}

/** Trouve une conversation EXISTANTE entre myUid et otherUid via participants */
async function findExistingConversationByParticipants(myUid, otherUid) {
  const qMine = query(
    collection(db, "conversations"),
    where("participants", "array-contains", myUid),
    orderBy("lastSentAt", "desc"),
    limit(20)
  );
  const snap = await getDocs(qMine);
  let found = null;
  snap.forEach((d) => {
    const c = d.data();
    if (Array.isArray(c.participants) && c.participants.includes(otherUid)) {
      if (!found) found = { id: d.id, ...c };
    }
  });
  return found?.id || null;
}

export default function Messages(props) {
  const routeParams = useParams();
  const routeReceiverId = routeParams?.id || null;
  const receiverId = props.receiverId || routeReceiverId;

  const [cid, setCid] = useState(null);
  const [messages, setMessages] = useState([]);
  const [convMeta, setConvMeta] = useState(null); // doc conversation (pour les accusés de lecture)
  const [newMessage, setNewMessage] = useState("");

  // Tunnel /bac : brouillon pré-rempli (pack + matière) déposé par TeacherProfile
  useEffect(() => {
    const draft = consumeChatDraft();
    if (draft) setNewMessage((cur) => cur || draft);
  }, []);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  // Visionneuse plein écran : { items, index } ou null
  const [lightbox, setLightbox] = useState(null);
  const [receiverName, setReceiverName] = useState("");
  const [receiverAvatar, setReceiverAvatar] = useState("/avatar-default.png");
  const messagesEndRef = useRef(null);
  const navigate = useNavigate();

  const unsubRefs = useRef({ msgs: null });

  // 1) Résoudre/choisir la conversation (existante > création client)
  useEffect(() => {
    (async () => {
      const myUid = auth.currentUser?.uid;
      if (!myUid || !receiverId) return;

      if (myUid === receiverId) {
        toast.error("Impossible de discuter avec soi-même.");
        return;
      }

      // (A) Conversation existante ?
      const existing = await findExistingConversationByParticipants(
        myUid,
        receiverId
      );
      if (existing) {
        setCid(existing);
        return; // ✅ on réutilise l'existante
      }

      // (B) Sinon on la crée côté client
      const convId = await ensureConversationClient(myUid, receiverId);
      setCid(convId);
    })();
  }, [receiverId]);

  // 2) Profil interlocuteur
  useEffect(() => {
    (async () => {
      if (!receiverId) return;
      const p = await fetchUserProfile(receiverId);
      setReceiverName(buildName(p, receiverId));
      setReceiverAvatar(buildAvatar(p));
    })();
  }, [receiverId]);

  // 3) Flux messages Firestore (source de vérité)
  useEffect(() => {
    const myUid = auth.currentUser?.uid;
    if (!cid || !myUid) return;
    const qMsg = query(
      collection(db, "messages"),
      where("participants_uids", "array-contains", myUid),
      where("conversationId", "==", cid),
      orderBy("sent_at", "asc")
    );
    const unsub = onSnapshot(
      qMsg,
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMessages(data);
      },
      (err) => {
        console.warn(
          "onSnapshot messages error:",
          err?.code || err?.message || err
        );
      }
    );
    unsubRefs.current.msgs = unsub;
    return () => unsub();
  }, [cid]);

  // 3bis) Abonnement au doc conversation (carte des lectures `reads`)
  useEffect(() => {
    if (!cid) return;
    const unsub = onSnapshot(
      doc(db, "conversations", cid),
      (s) => setConvMeta(s.exists() ? { id: s.id, ...s.data() } : null),
      () => {}
    );
    return () => unsub();
  }, [cid]);

  // 3ter) Marquer comme lu : dès qu'on voit la conversation, on note l'heure
  // de lecture pour mon uid (sert aux accusés "Vu" et aux compteurs non-lus).
  useEffect(() => {
    const myUid = auth.currentUser?.uid;
    if (!cid || !myUid || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last?.sender_uid === myUid) return; // rien à marquer si j'ai écrit en dernier
    updateDoc(doc(db, "conversations", cid), {
      [`reads.${myUid}`]: serverTimestamp(),
    }).catch(() => {});
  }, [cid, messages]);

  // 4) Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 5) Envoi du message (source de vérité : Firestore)
  // ⚖️ Signalement (15/10/2026) — EduKaraib ne lit pas les conversations
  //    (secret des correspondances, CPCE art. L32-3). Le seul cas où un
  //    contenu arrive légalement à l'équipe est celui-ci : l'utilisateur le
  //    transmet LUI-MÊME (DSA art. 16). Le doc créé déclenche l'email admin
  //    (functions/index.js, onSignalementCreated).
  const handleSignaler = async (m) => {
    const myUid = auth.currentUser?.uid;
    if (!myUid) return;
    const motif = await demanderTexte({
      titre: "Signaler ce message à l'équipe EduKaraib",
      message: "En confirmant, vous transmettez ce message à l'équipe.",
      placeholder: "Pourquoi le signalez-vous ?",
      libelleConfirmer: "Signaler",
      multiligne: true,
    });
    if (motif === null) return;
    try {
      await addDoc(collection(db, "signalements"), {
        auteur_uid: myUid,
        message_id: m.id,
        conversation_id: cid || null,
        expediteur_uid: m.sender_uid || null,
        contenu_signale: (m.message || "").slice(0, 2000),
        pieces_jointes: Array.isArray(m.attachments) ? m.attachments.map((a) => a?.url).filter(Boolean) : [],
        motif: String(motif || "").slice(0, 500),
        traite: false,
        created_at: serverTimestamp(),
      });
      toast.success("Merci. L'équipe EduKaraib a reçu votre signalement et va l'examiner.");
    } catch (e) {
      toast.error("Le signalement n'a pas pu être envoyé : " + (e?.message || ""));
    }
  };

  //    `pieces` = brouillons du Composer : [{ file, kind, durationSec }]
  const handleSend = async (text, pieces = []) => {
    if (sending) return false;
    const myUid = auth.currentUser?.uid;
    if (!text && pieces.length === 0) return false;

    try {
      setSending(true);
      setProgress(0);

      // s’assurer d’un conversationId
      let conversationId = cid;
      if (!myUid || !receiverId) throw new Error("Destinataire introuvable.");
      if (!conversationId) {
        conversationId =
          (await findExistingConversationByParticipants(myUid, receiverId)) ||
          (await ensureConversationClient(myUid, receiverId));
        setCid(conversationId);
      }

      // Upload des pièces jointes (séquentiel : progression lisible + moins de
      // pression réseau sur mobile). Un échec annule tout l'envoi.
      const attachments = [];
      for (let i = 0; i < pieces.length; i += 1) {
        const p = pieces[i];
        try {
          // eslint-disable-next-line no-await-in-loop
          const fiche = await uploadAttachment(p.file, conversationId, myUid, (pct) => {
            setProgress(Math.round(((i + pct / 100) / pieces.length) * 100));
          });
          if (p.durationSec) fiche.durationSec = p.durationSec;
          attachments.push(fiche);
        } catch (err) {
          toast.error(messageErreurUpload(err));
          return false;
        }
      }

      const apercu = resumeAttachments(attachments, text);

      // Écriture Firestore. La Cloud Function onMessageCreated se charge de
      // prévenir l'admin par email si le destinataire est l'admin.
      await addDoc(collection(db, "messages"), {
        conversationId,
        sender_uid: myUid,
        receiver_uid: receiverId,
        participants_uids: [myUid, receiverId],
        message: text,
        attachments,
        sent_at: serverTimestamp(),
      });

      await updateDoc(doc(db, "conversations", conversationId), {
        lastMessage: apercu,
        lastSentAt: serverTimestamp(),
        lastSender: myUid,
      });

      // --- ENVOI EMAIL AU DESTINATAIRE ---
      notifyEmailUser(receiverId, {
        title: "Nouveau message sur EduKaraib",
        message: apercu,
        ctaUrl: `${window.location.origin}/messages`,
        ctaText: "Ouvrir la conversation",
      });
      // --- /ENVOI EMAIL ---

      setNewMessage("");
      return true;
    } catch (err) {
      console.warn("send failed:", err?.message || err);
      toast.error("Échec de l’envoi du message. Réessayez.");
      return false;
    } finally {
      setSending(false);
      setProgress(0);
    }
  };

  // ⛔ La suppression définitive a été retirée le 15/10/2026 : seul le serveur
  //    purge, au bout de 12 mois (api/purge-conversations-cron.mjs). Les règles
  //    Firestore refusent désormais toute suppression depuis le site.

  async function softDeleteForUser(conversationId, myUid) {
    await updateDoc(doc(db, "conversations", conversationId), {
      hiddenFor:
        (window.firebase?.firestore?.FieldValue ||
          (await import("firebase/firestore"))).arrayUnion(myUid),
    }).catch(() => {});
  }

  const handleDeleteConversation = async () => {
    const myUid = auth.currentUser?.uid;
    if (!myUid || !cid) return;

    // 15/10/2026 : on MASQUE, on ne détruit plus. Un participant ne peut plus
    // effacer la copie de l'autre — ni les preuves d'un harcèlement ou d'une
    // arnaque. Conservation 12 mois, puis purge par le serveur.
    const ok = await confirmer({
      titre: "Masquer cette discussion ?",
      message: "Elle disparaîtra de votre liste. Les messages sont conservés 12 mois, puis supprimés automatiquement. Votre correspondant garde sa copie.",
      libelleConfirmer: "Masquer",
    });
    if (!ok) return;

    try {
      unsubRefs.current.msgs?.();
    } catch {}

    await softDeleteForUser(cid, myUid);

    if (typeof props.onBack === "function") props.onBack();
    else navigate("/chat-list");
  };

  if (!receiverId) return <div className="p-4">Chargement…</div>;

  return (
    <div className="flex flex-col h-screen bg-[#f4f1ea]">
      {/* Header */}
      <div className="bg-white/95 backdrop-blur px-3 sm:px-4 py-2.5 shadow-sm border-b border-gray-100 flex items-center gap-2 sm:gap-3 z-10">
        <button
          onClick={props.onBack || (() => navigate("/dashboard"))}
          aria-label="Retour"
          className="shrink-0 w-9 h-9 rounded-full grid place-items-center text-gray-600 hover:bg-gray-100 transition"
        >
          <ArrowLeft size={20} />
        </button>

        <img
          src={receiverAvatar || "/avatar-default.png"}
          alt="Avatar"
          className="w-10 h-10 rounded-full object-cover ring-2 ring-primary/20"
        />
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-semibold text-gray-900 truncate leading-tight">
            {receiverName || "Utilisateur"}
          </h2>
          <span className="text-[11px] text-gray-400">EduKaraib</span>
        </div>

        <button
          onClick={handleDeleteConversation}
          className="shrink-0 w-9 h-9 rounded-full grid place-items-center text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
          title="Masquer la discussion"
          aria-label="Masquer la discussion"
          disabled={sending}
        >
          <Trash2 size={18} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-1">
        {(() => {
          const myUid = auth.currentUser?.uid;
          let lastDayKey = null;
          // Index du dernier message que J'AI envoyé (pour l'accusé Vu/Envoyé)
          let lastMineIdx = -1;
          messages.forEach((m, i) => {
            if (m.sender_uid === myUid) lastMineIdx = i;
          });
          // « Vu à 18 h 40 » / « Envoyé » : lib/etatLecture.js (jamais de statistique)
          const lecture = etatLecture(messages[lastMineIdx], convMeta?.reads, myUid, receiverId);
          return messages.map((m, idx) => {
            const isMine = m.sender_uid === myUid;
            const dayKey = getDayKey(m.sent_at);
            const showSeparator = dayKey && dayKey !== lastDayKey;
            if (showSeparator) lastDayKey = dayKey;
            const label = showSeparator ? dateSeparatorLabel(m.sent_at) : null;
            const showStatus = isMine && idx === lastMineIdx;
            const seen = lecture?.etat === 'vu';
            const attachments = Array.isArray(m.attachments) ? m.attachments : [];
            const medias = attachments.filter(
              (a) => a?.kind === "image" || a?.kind === "video"
            );
            const texte = (m.message || "").trim();
            // Média seul = bulle sans marge intérieure (rendu « photo pleine »).
            const bulleNue = attachments.length > 0 && !texte;
            return (
              <React.Fragment key={m.id}>
                {/* ── Séparateur de date style WhatsApp ── */}
                {label && (
                  <div className="flex justify-center my-3">
                    <span className="bg-gray-200 text-gray-500 text-xs font-medium px-3 py-1 rounded-full shadow-sm">
                      {label}
                    </span>
                  </div>
                )}
                <div
                  className={`flex flex-col max-w-[85%] sm:max-w-md mb-1.5 ${
                    isMine ? "ml-auto items-end" : "mr-auto items-start"
                  }`}
                >
                  <div
                    className={`${bulleNue ? "p-1" : "px-3.5 py-2"} rounded-2xl shadow-sm ${
                      isMine
                        ? "bg-primary text-white rounded-br-md"
                        : "bg-white text-gray-900 rounded-bl-md border border-gray-100"
                    }`}
                  >
                    {attachments.length > 0 && (
                      <AttachmentGrid
                        attachments={attachments}
                        isMine={isMine}
                        onOpenMedia={(i) => setLightbox({ items: medias, index: i })}
                      />
                    )}
                    {texte && (
                      <div
                        className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed ${
                          attachments.length > 0 ? "mt-1.5" : ""
                        }`}
                      >
                        {texte}
                      </div>
                    )}
                  </div>
                  {!isMine && (
                    <button
                      type="button"
                      onClick={() => handleSignaler(m)}
                      className="text-[11px] text-gray-400 hover:text-red-600 underline mt-0.5 px-1"
                      title="Signaler ce message à l'équipe"
                    >
                      Signaler
                    </button>
                  )}
                  {/* Heure + accusé de lecture sur mon dernier message */}
                  <span className="text-[11px] text-gray-400 mt-0.5 px-1">
                    {formatTime(m.sent_at)}
                    {showStatus && (
                      <span className={seen ? "text-primary font-medium ml-1" : "ml-1"}>
                        {" · "}{seen ? `✓✓ ${libelleVu(lecture.le)}` : "✓ Envoyé"}
                      </span>
                    )}
                  </span>
                </div>
              </React.Fragment>
            );
          });
        })()}
        <div ref={messagesEndRef} />
      </div>

      {/* Barre de saisie : texte + photos/vidéos + message vocal */}
      <Composer
        value={newMessage}
        onChange={setNewMessage}
        onSend={handleSend}
        sending={sending}
        progress={progress}
      />

      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onIndex={(i) => setLightbox((l) => ({ ...l, index: i }))}
        />
      )}
    </div>
  );
}