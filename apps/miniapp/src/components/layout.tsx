import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp,
  Bell,
  FileText,
  Heart,
  Home,
  MessageCircle,
  Search,
  Settings,
  Shield,
  UserRound,
  Trash2,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { ru } from '@rolemate/shared';
import { useUserStore } from '../store.js';
import { api, type UserNotification } from '../api.js';
import { applyThemePreference, getTelegram, trackTopbarHeight } from '../telegram.js';
import { CUSTOM_EMOJI_PACK_EVENT } from './custom-emoji-token.js';
import { CustomEmojiPickerDialog } from './custom-emoji-picker.js';
import { useViewerTime } from './viewer-time.js';

const navigation = [
  { to: '/', label: ru.miniApp.navigation.home, icon: Home },
  { to: '/matches', label: ru.miniApp.navigation.matches, icon: Heart },
  { to: '/posts', label: ru.miniApp.navigation.posts, icon: FileText },
  { to: '/search', label: ru.miniApp.navigation.search, icon: Search, featured: true },
  { to: '/chats', label: ru.miniApp.navigation.chats, icon: MessageCircle },
  { to: '/profile', label: ru.miniApp.navigation.profile, icon: UserRound },
  { to: '/settings', label: ru.miniApp.navigation.settings, icon: Settings },
];

export function Layout({ children }: { children: ReactNode }) {
  const isAdmin = useUserStore((state) => state.user?.isAdmin);
  const [location, navigate] = useLocation();
  const reduceMotion = useReducedMotion();
  const sectionSwipe = useRef<{ x: number; y: number; enabled: boolean } | null>(null);
  const topbarRef = useRef<HTMLElement>(null);
  useEffect(() => trackTopbarHeight(topbarRef.current), []);
  // Tapping a custom emoji anywhere — a message, a comment, a questionnaire —
  // shows the pack it came from. The sheet lives here so any screen can raise it.
  const [emojiPackFor, setEmojiPackFor] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail) setEmojiPackFor(detail);
    };
    window.addEventListener(CUSTOM_EMOJI_PACK_EVENT, open);
    return () => window.removeEventListener(CUSTOM_EMOJI_PACK_EVENT, open);
  }, []);
  // Sections are ordered in the tab bar, so a move to a later tab slides in from
  // the right and a move back slides in from the left, the way Telegram does it.
  const navigationIndex = navigation.findIndex(({ to }) =>
    to === '/' ? location === '/' : location.startsWith(to),
  );
  const previousNavigationIndex = useRef(navigationIndex);
  const slideDirection =
    navigationIndex < 0 || previousNavigationIndex.current < 0
      ? 0
      : Math.sign(navigationIndex - previousNavigationIndex.current);
  useEffect(() => {
    previousNavigationIndex.current = navigationIndex;
  }, [navigationIndex]);
  const [feedTopActionVisible, setFeedTopActionVisible] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: api.notifications,
    // Mounted on every screen, so this poll runs for the whole session — and the
    // bot already delivers anything urgent to the private chat.
    refetchInterval: 180_000,
    refetchIntervalInBackground: false,
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings,
  });
  useEffect(() => {
    if (settings.data) applyThemePreference(settings.data.theme);
  }, [settings.data]);
  useEffect(() => {
    const feedRoute = location.startsWith('/search') || location.startsWith('/posts');
    if (!feedRoute) {
      setFeedTopActionVisible(false);
      return undefined;
    }
    const synchronize = () => setFeedTopActionVisible(window.scrollY > 520);
    synchronize();
    window.addEventListener('scroll', synchronize, { passive: true });
    return () => window.removeEventListener('scroll', synchronize);
  }, [location]);
  useEffect(() => {
    if (settings.data?.theme !== 'telegram') return undefined;
    const telegram = getTelegram();
    if (!telegram) return undefined;
    const synchronizeTelegramTheme = () => applyThemePreference('telegram');
    telegram.onEvent('themeChanged', synchronizeTelegramTheme);
    return () => telegram.offEvent('themeChanged', synchronizeTelegramTheme);
  }, [settings.data?.theme]);
  const dismissNotification = useMutation({
    mutationFn: api.dismissNotification,
    onMutate: async (notificationId) => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      const previous = queryClient.getQueryData<UserNotification[]>(['notifications']);
      queryClient.setQueryData<UserNotification[]>(['notifications'], (current = []) =>
        current.filter((item) => item.id !== notificationId),
      );
      return { previous };
    },
    onError: (_error, _notificationId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['notifications'], context.previous);
      }
    },
  });
  const dismissAllNotifications = useMutation({
    mutationFn: api.dismissAllNotifications,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      const previous = queryClient.getQueryData<UserNotification[]>(['notifications']);
      queryClient.setQueryData<UserNotification[]>(['notifications'], []);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['notifications'], context.previous);
      }
    },
  });
  const unread = notifications.data?.filter((item) => !item.read_at).length ?? 0;
  return (
    <div className="app-shell">
      <header className="topbar" ref={topbarRef}>
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
        {notificationsOpen
          ? createPortal(
              <div
                className="notification-popover-backdrop"
                data-testid="notification-backdrop"
                onMouseDown={() => setNotificationsOpen(false)}
              >
                <div
                  className="notification-popover"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="notification-popover-title">
                    <span>
                      <strong>{ru.miniApp.home.notifications}</strong>
                      <small>{ru.miniApp.home.unreadNotifications(unread)}</small>
                    </span>
                  </div>
                  <div className="notification-list">
                    {notifications.data?.map((item) => (
                      <NotificationItem
                        key={item.id}
                        item={item}
                        onOpen={() => {
                          dismissNotification.mutate(item.id);
                          setNotificationsOpen(false);
                        }}
                      />
                    ))}
                    {!notifications.isLoading && !notifications.data?.length ? (
                      <p className="notification-empty">{ru.miniApp.home.notificationsEmpty}</p>
                    ) : null}
                  </div>
                  {notifications.data?.length ? (
                    <footer className="notification-popover-footer">
                      <button
                        type="button"
                        className="notification-clear-all"
                        disabled={dismissAllNotifications.isPending}
                        onClick={() => dismissAllNotifications.mutate()}
                      >
                        <Trash2 aria-hidden /> {ru.miniApp.home.clearNotifications}
                      </button>
                    </footer>
                  ) : null}
                </div>
              </div>,
              document.body,
            )
          : null}
      </header>
      {/* Keyed by route: Layout survives navigation, so without a key the element
          was never recreated and the entrance played once per session. Honours
          the system reduced-motion setting, which framer-motion ignores. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.main
          key={location}
          className="page"
          initial={
            reduceMotion ? false : { opacity: 0, x: slideDirection * 24, y: slideDirection ? 0 : 8 }
          }
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={
            reduceMotion
              ? { opacity: 1 }
              : { opacity: 0, x: slideDirection * -16, transition: { duration: 0.12 } }
          }
          transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 0.9, 0.28, 1] }}
          onTouchStart={(event) => {
            const target = event.target as HTMLElement;
            sectionSwipe.current = {
              x: event.touches[0]?.clientX ?? 0,
              y: event.touches[0]?.clientY ?? 0,
              enabled:
                !target.closest('.telegram-conversation') &&
                !target.closest(
                  'input,textarea,select,button,a,audio,video,[role="dialog"],.profile-cover,.post-media-carousel,.media-lightbox,.chat-media-carousel,.chat-media-lightbox,.profile-avatar-lightbox,[data-no-section-swipe]',
                ),
            };
          }}
          onTouchEnd={(event) => {
            const start = sectionSwipe.current;
            sectionSwipe.current = null;
            const touch = event.changedTouches[0];
            if (!start?.enabled || !touch) return;
            const deltaX = touch.clientX - start.x;
            const deltaY = touch.clientY - start.y;
            if (Math.abs(deltaX) < 90 || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) return;
            const currentIndex = navigation.findIndex(({ to }) =>
              to === '/' ? location === '/' : location.startsWith(to),
            );
            if (currentIndex < 0) return;
            const nextIndex = currentIndex + (deltaX < 0 ? 1 : -1);
            const next = navigation[nextIndex];
            if (next) navigate(next.to);
          }}
        >
          {children}
        </motion.main>
      </AnimatePresence>
      {emojiPackFor ? (
        <CustomEmojiPickerDialog
          focusPackOfEmojiId={emojiPackFor}
          onClose={() => setEmojiPackFor(null)}
        />
      ) : null}
      {feedTopActionVisible ? (
        <button
          className="feed-top-action"
          type="button"
          aria-label={ru.miniApp.navigation.backToTopAndRefresh}
          onClick={() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            if (location.startsWith('/search')) {
              void Promise.all([
                queryClient.invalidateQueries({ queryKey: ['search'] }),
                queryClient.invalidateQueries({ queryKey: ['public-profile-search'] }),
                queryClient.invalidateQueries({ queryKey: ['search-availability'] }),
              ]);
            } else {
              void queryClient.invalidateQueries({ queryKey: ['posts'] });
            }
          }}
        >
          <ArrowUp aria-hidden />
        </button>
      ) : null}
      <nav className="bottom-nav" aria-label={ru.miniApp.navigation.aria}>
        {navigation.map(({ to, label, icon: Icon, featured }) => (
          <Link
            key={to}
            href={to}
            aria-label={label}
            title={label}
            className={featured ? 'featured' : ''}
          >
            <span
              className={
                location === to || (to !== '/' && location.startsWith(`${to}/`))
                  ? 'nav-icon active'
                  : 'nav-icon'
              }
            >
              <Icon className="h-5 w-5" />
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

function NotificationItem({
  item,
  onOpen,
}: {
  item: {
    id: string;
    read_at?: string | null;
    open_path: string;
    message: string;
    created_at: string;
  };
  onOpen: () => void;
}) {
  const viewerTime = useViewerTime();
  return (
    <Link
      className={item.read_at ? 'notification-item' : 'notification-item unread'}
      href={item.open_path}
      onClick={onOpen}
    >
      <span>{item.message}</span>
      <small title={viewerTime.absolute(item.created_at)}>
        {viewerTime.relative(item.created_at)}
      </small>
    </Link>
  );
}
