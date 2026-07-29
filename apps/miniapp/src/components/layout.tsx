import type { ReactNode } from 'react';
import { FileText, Heart, Home, MessageCircle, Search, Shield, UserRound } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { ru } from '@rolemate/shared';
import { useUserStore } from '../store.js';

const navigation = [
  { to: '/', label: ru.miniApp.navigation.home, icon: Home },
  { to: '/search', label: ru.miniApp.navigation.search, icon: Search },
  { to: '/matches', label: ru.miniApp.navigation.matches, icon: Heart },
  { to: '/posts', label: ru.miniApp.navigation.posts, icon: FileText },
  { to: '/chats', label: ru.miniApp.navigation.chats, icon: MessageCircle },
  { to: '/profile', label: ru.miniApp.navigation.profile, icon: UserRound },
];

export function Layout({ children }: { children: ReactNode }) {
  const isAdmin = useUserStore((state) => state.user?.isAdmin);
  const [location] = useLocation();
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label={ru.brand.name}>
          <img className="brand-mark" src="/assets/telegram-bot-avatar.jpg" alt="" />
          <span>
            <strong>{ru.brand.name}</strong>
            <small>{ru.miniApp.navigation.tagline}</small>
          </span>
        </Link>
        {isAdmin ? (
          <Link href="/admin" className="admin-chip">
            <Shield className="h-4 w-4" />
            {ru.miniApp.navigation.admin}
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
      <nav className="bottom-nav" aria-label={ru.miniApp.navigation.aria}>
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
