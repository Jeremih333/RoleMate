import { type ReactNode, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Redirect, Route, Switch } from 'wouter';
import { api } from './api.js';
import { Layout } from './components/layout.js';
import { AdminPage } from './pages/admin.js';
import {
  ChatsPage,
  MatchesPage,
  PremiumPage,
  ReferralsPage,
  SettingsPage,
} from './pages/community.js';
import { HomePage } from './pages/home.js';
import { ProfileEditorPage, ProfilePage } from './pages/profile.js';
import { SearchPage } from './pages/search.js';
import { useUserStore } from './store.js';
import { getTelegram } from './telegram.js';

function AuthGate({ children }: { children: ReactNode }) {
  const setUser = useUserStore((state) => state.setUser);
  const storedUser = useUserStore((state) => state.user);
  const auth = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const telegram = getTelegram();
      if (!telegram?.initData) {
        if (window.location.hostname === 'localhost') {
          const me = await api.me();
          return {
            id: me.userId,
            telegramUserId: me.telegramUserId,
            role: me.role,
            isAdmin: me.isAdmin,
          };
        }
        throw new Error('Открой RoleMate внутри Telegram');
      }
      const user = await api.authenticate(telegram.initData);
      const me = await api.me();
      return { ...user, isAdmin: me.isAdmin };
    },
    retry: false,
  });
  useEffect(() => {
    if (auth.data) setUser(auth.data);
  }, [auth.data, setUser]);
  if (auth.isLoading)
    return (
      <div className="splash">
        <span className="brand-mark large">R</span>
        <p>Открываем следующую историю…</p>
      </div>
    );
  if (auth.isError)
    return (
      <div className="splash error">
        <span className="brand-mark large">R</span>
        <h1>RoleMate открывается в Telegram</h1>
        <p>{auth.error.message}</p>
      </div>
    );
  if (!storedUser) {
    return (
      <div className="splash">
        <span className="brand-mark large">R</span>
        <p>Готовим пространство…</p>
      </div>
    );
  }
  return <Layout>{children}</Layout>;
}

export function App() {
  return (
    <AuthGate>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/search" component={SearchPage} />
        <Route path="/matches" component={MatchesPage} />
        <Route path="/chats" component={ChatsPage} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/profile/edit" component={ProfileEditorPage} />
        <Route path="/premium" component={PremiumPage} />
        <Route path="/referrals" component={ReferralsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/admin" component={AdminPage} />
        <Route>
          <Redirect to="/" replace />
        </Route>
      </Switch>
    </AuthGate>
  );
}
