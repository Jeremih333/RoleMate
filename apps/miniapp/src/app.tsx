import { type ReactNode, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { menuLaunchRouteSchema, parseMenuLaunchPath, ru } from '@rolemate/shared';
import { Redirect, Route, Switch } from 'wouter';
import { api, ApiError } from './api.js';
import { Layout } from './components/layout.js';
import { Button } from './components/ui.js';
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
import { waitForTelegramInitData } from './telegram.js';

function AuthGate({ children }: { children: ReactNode }) {
  const setUser = useUserStore((state) => state.setUser);
  const storedUser = useUserStore((state) => state.user);
  const auth = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const launchUrl = new URL(window.location.href);
      const pathLaunch = parseMenuLaunchPath(launchUrl.pathname);
      const legacyRoute = menuLaunchRouteSchema.safeParse(launchUrl.pathname);
      const legacyToken = launchUrl.searchParams.get('rm_launch');
      const launch =
        pathLaunch ??
        (legacyToken && legacyRoute.success
          ? { route: legacyRoute.data, token: legacyToken }
          : undefined);
      if (launch) {
        launchUrl.pathname = launch.route;
        launchUrl.searchParams.delete('rm_launch');
        window.history.replaceState(
          window.history.state,
          '',
          `${launchUrl.pathname}${launchUrl.search}${launchUrl.hash}`,
        );
      }
      const currentUser = async () => {
        const me = await api.me();
        return {
          id: me.userId,
          telegramUserId: me.telegramUserId,
          role: me.role,
          isAdmin: me.isAdmin,
          isOwner: me.isOwner,
        };
      };
      try {
        return await currentUser();
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      }
      let launchError: unknown;
      if (launch) {
        try {
          await api.authenticateMenu(launch.token, launch.route);
          return await currentUser();
        } catch (error) {
          launchError = error;
        }
      }
      const initData = await waitForTelegramInitData();
      if (!initData) {
        if (launchError instanceof Error) throw launchError;
        throw new Error(ru.miniApp.auth.telegramOnly);
      }
      const user = await api.authenticate(initData);
      const me = await api.me();
      return { ...user, isAdmin: me.isAdmin, isOwner: me.isOwner };
    },
    retry: false,
  });
  useEffect(() => {
    if (auth.data) setUser(auth.data);
  }, [auth.data, setUser]);
  if (auth.isLoading)
    return (
      <div className="splash">
        <img className="brand-mark large" src="/assets/telegram-bot-avatar.jpg" alt="" />
        <p>{ru.miniApp.auth.opening}</p>
      </div>
    );
  if (auth.isError)
    return (
      <div className="splash error">
        <img className="brand-mark large" src="/assets/telegram-bot-avatar.jpg" alt="" />
        <h1>{ru.miniApp.auth.title}</h1>
        <p>{auth.error.message}</p>
        {auth.error instanceof ApiError ? (
          <small className="error-code">
            {ru.miniApp.auth.errorCode}: {auth.error.code}
          </small>
        ) : null}
        <Button type="button" loading={auth.isFetching} onClick={() => void auth.refetch()}>
          {ru.miniApp.auth.retry}
        </Button>
      </div>
    );
  if (!storedUser) {
    return (
      <div className="splash">
        <img className="brand-mark large" src="/assets/telegram-bot-avatar.jpg" alt="" />
        <p>{ru.miniApp.auth.preparing}</p>
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
