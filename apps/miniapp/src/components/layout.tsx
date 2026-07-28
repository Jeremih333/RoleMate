import type { ReactNode } from 'react';
import { Heart, Home, MessageCircle, Search, Shield, UserRound } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { useUserStore } from '../store.js';

const navigation = [
  { to: '/', label: 'Главная', icon: Home },
  { to: '/search', label: 'Поиск', icon: Search },
  { to: '/matches', label: 'Симпатии', icon: Heart },
  { to: '/chats', label: 'Чаты', icon: MessageCircle },
  { to: '/profile', label: 'Профиль', icon: UserRound },
];

export function Layout({ children }: { children: ReactNode }) {
  const isAdmin = useUserStore((state) => state.user?.isAdmin);
  const [location] = useLocation();
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="RoleMate">
          <span className="brand-mark">R</span>
          <span>
            <strong>RoleMate</strong>
            <small>твоя следующая история</small>
          </span>
        </Link>
        {isAdmin ? (
          <Link href="/admin" className="admin-chip">
            <Shield className="h-4 w-4" />
            Управление
          </Link>
        ) : null}
      </header>
      <motion.main
        className="page"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        {children}
      </motion.main>
      <nav className="bottom-nav" aria-label="Основная навигация">
        {navigation.map(({ to, label, icon: Icon }) => (
          <Link key={to} href={to}>
            <span
              className={
                location === to || (to !== '/' && location.startsWith(`${to}/`))
                  ? 'nav-icon active'
                  : 'nav-icon'
              }
            >
              <Icon className="h-5 w-5" />
            </span>
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
