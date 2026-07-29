import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  FileText,
  Heart,
  Home,
  MessageCircle,
  Search,
  Shield,
  UserRound,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { ru } from '@rolemate/shared';
import { useUserStore } from '../store.js';
import { api } from '../api.js';

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
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: api.notifications,
    refetchInterval: 30_000,
  });
  const markRead = useMutation({
    mutationFn: api.readNotification,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = notifications.data?.filter((item) => !item.read_at).length ?? 0;
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
        <div className="topbar-actions">
          <button
            className="notification-bell"
            type="button"
            aria-label={ru.miniApp.home.notifications}
            aria-expanded={notificationsOpen}
            onClick={() => setNotificationsOpen((value) => !value)}
          >
            <Bell className="h-5 w-5" />
            {unread ? <span>{unread > 99 ? '99+' : unread}</span> : null}
          </button>
          {isAdmin ? (
            <Link href="/admin" className="admin-chip">
              <Shield className="h-4 w-4" />
              {ru.miniApp.navigation.admin}
            </Link>
          ) : null}
        </div>
        {notificationsOpen ? (
          <div className="notification-popover">
            <div className="notification-popover-title">
              <strong>{ru.miniApp.home.notifications}</strong>
              <small>{ru.miniApp.home.unreadNotifications(unread)}</small>
            </div>
            <div className="notification-list">
              {notifications.data?.map((item) => (
                <Link
                  className={item.read_at ? 'notification-item' : 'notification-item unread'}
                  href={item.open_path}
                  key={item.id}
                  onClick={() => {
                    if (!item.read_at) markRead.mutate(item.id);
                    setNotificationsOpen(false);
                  }}
                >
                  <span>{item.message}</span>
                  <small>{new Date(item.created_at).toLocaleString('ru-RU')}</small>
                </Link>
              ))}
              {!notifications.isLoading && !notifications.data?.length ? (
                <p className="notification-empty">{ru.miniApp.home.notificationsEmpty}</p>
              ) : null}
            </div>
          </div>
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
