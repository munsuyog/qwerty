'use client';
import { useRouter } from 'next/navigation';
import Dashboard from './components/mainPage';

export default function Home() {
  const router = useRouter();

  return (
    <div>
      <Dashboard/>
    </div>
  );
}