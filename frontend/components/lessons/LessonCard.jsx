import React from 'react';
import { whenString } from '../../utils/datetime';

const statusColors = {
  booked: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  completed: 'bg-gray-200 text-gray-700',
};

function StatusPill({ status }) {
  const label =
    status === 'booked' ? 'En attente' :
    status === 'confirmed' ? 'Confirmé' :
    status === 'rejected' ? 'Refusé' :
    status === 'completed' ? 'Terminé' : status;

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold ml-2 ${statusColors[status] || 'bg-gray-200'}`}>
      {label}
    </span>
  );
}

export default function LessonCard({
  lesson,
  variant, // 'booked' | 'confirmed' | 'completed'
  onAccept,
  onReject,
  onCompleted,
  onOpenDocs,
}) {
  return (
    <div className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between">
      <div className="flex-1">
        <div className="flex gap-2 items-center mb-1">
          <span className="font-bold text-primary">{lesson.subject_id || 'Matière'}</span>
          <StatusPill status={lesson.status} />
        </div>
        <div className="text-gray-700">
          Élève : <span className="font-semibold">{lesson.studentName || 'Élève'}</span>
        </div>
        <div className="text-gray-500 text-sm">{whenString(lesson)}</div>
      </div>

      {variant === 'booked' && (
        <div className="flex gap-2">
          <button
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded shadow font-semibold"
            onClick={() => onAccept?.(lesson)}
          >
            ✅ Accepter
          </button>
          <button
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded shadow font-semibold"
            onClick={() => onReject?.(lesson)}
          >
            ❌ Refuser
          </button>
        </div>
      )}

      {variant === 'confirmed' && (
        <div className="flex gap-2">
          <button
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow font-semibold"
            onClick={() => onOpenDocs?.(lesson)}
          >
            📄 Documents
          </button>
          <button
            className="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded shadow font-semibold"
            onClick={() => onCompleted?.(lesson)}
            disabled={lesson.status === 'completed'}
            title={lesson.status === 'completed' ? 'Déjà terminé' : 'Marquer comme terminé'}
          >
            ✅ Terminé
          </button>
        </div>
      )}

      {variant === 'completed' && (
        <div className="flex gap-2">
          <button
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow font-semibold"
            onClick={() => onOpenDocs?.(lesson)}
          >
            📄 Documents
          </button>
        </div>
      )}
    </div>
  );
}