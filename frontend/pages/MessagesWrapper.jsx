import { useParams } from 'react-router-dom';
import Messages from './Messages';

export default function MessagesWrapper() {
  const { receiverId } = useParams();
  return <Messages receiverId={receiverId} />;
}