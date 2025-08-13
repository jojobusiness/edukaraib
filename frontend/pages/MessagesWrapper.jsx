import { useParams } from 'react-router-dom';
import Messages from './Messages';

export default function MessagesWrapper() {
  const { id } = useParams();
  return <Messages receiverId={id} />;
}