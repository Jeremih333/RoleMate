import { type ReactNode, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { menuLaunchRouteSchema, parseMenuLaunchPath, ru } from '@rolemate/shared';
import { Redirect, Route, Switch } from 'wouter';
import { api, ApiError } from './api.js';
import { Layout } from './components/layout.js';
import { MusicPlayerProvider } from './components/music-player.js';
import { Button } from './components/ui.js';
import { ViewerTimeProvider } from './components/viewer-time.js';
import { AdminPage } from './pages/admin.js';
import { QuickStartPage } from './pages/quick-start.js';
import {
  ChatsPage,
  MatchesPage,
  PremiumPage,
  ReferralsPage,
  SettingsPage,
} from './pages/community.js';
import { HomePage } from './pages/home.js';
import { GiftsPage } from './pages/gifts.js';
import { ProfileEditorPage, ProfilePage } from './pages/profile.js';
import {
  PostsPage,
  PublicProfilePage,
  PublicProfileViewerPage,
  QuestionnairesPage,
} from './pages/social.js';
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
      const currentUser = () => api.refreshSession();
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
      if (initData) {
        try {
          const user = await api.authenticate(initData);
          const me = await api.me();
          return { ...user, isAdmin: me.isAdmin, isOwner: me.isOwner };
        } catch (error) {
          if (!(error instanceof ApiError) || error.code !== 'INVALID_INIT_DATA') throw error;
          const refreshed = await currentUser().catch(() => null);
          if (refreshed) return refreshed;
          throw error;
        }
      }
      try {
        return await currentUser();
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      }
      if (launchError instanceof Error) throw launchError;
      throw new Error(ru.miniApp.auth.telegramOnly);
    },
    retry: false,
  });
  useEffect(() => {
    if (!auth.data) return;
    setUser(auth.data);
    const refreshTimer = window.setInterval(() => {
      void api
        .refreshSession()
        .then(setUser)
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 401) void auth.refetch();
        });
    }, 8 * 60_000);
    return () => window.clearInterval(refreshTimer);
  }, [auth.data, auth.refetch, setUser]);
  if (auth.isLoading)
    return (
      <div className="splash splash-loading" aria-live="polite" aria-busy="true">
        <div className="splash-brand-stage" aria-hidden>
          <span className="splash-orbit splash-orbit-primary" />
          <span className="splash-orbit splash-orbit-secondary" />
          <img className="brand-mark large" src="/assets/telegram-bot-avatar.jpg" alt="" />
        </div>
        <div className="splash-copy">
          <span className="eyebrow">{ru.brand.name}</span>
          <h1>{ru.miniApp.auth.opening}</h1>
          <span className="splash-progress" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    );
  if (auth.isError)
    return (
      <div className="splash error">
        <div className="splash-brand-stage is-error" aria-hidden>
          <span className="splash-orbit splash-orbit-primary" />
          <img className="brand-mark large" src="/assets/telegram-bot-avatar.jpg" alt="" />
        </div>
        <div className="splash-error-card">
          <span className="eyebrow">{ru.brand.name}</span>
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
      </div>
    );
  if (!storedUser) {
    return (
      <div className="splash splash-loading" aria-live="polite" aria-busy="true">
        <div className="splash-brand-stage" aria-hidden>
          <span className="splash-orbit splash-orbit-primary" />
          <span className="splash-orbit splash-orbit-secondary" />
          <img className="brand-mark large" src="/assets/telegram-bot-avatar.jpg" alt="" />
        </div>
        <div className="splash-copy">
          <span className="eyebrow">{ru.brand.name}</span>
          <h1>{ru.miniApp.auth.preparing}</h1>
          <span className="splash-progress" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    );
  }
  return (
    <ViewerTimeProvider>
      <Layout>{children}</Layout>
    </ViewerTimeProvider>
  );
}

export function App() {
  return (
    <MusicPlayerProvider>
      <AuthGate>
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/quick-start" component={QuickStartPage} />
          <Route path="/search" component={SearchPage} />
          <Route path="/matches" component={MatchesPage} />
          <Route path="/chats" component={ChatsPage} />
          <Route path="/profile" component={PublicProfilePage} />
          <Route path="/profiles/:userId" component={PublicProfileViewerPage} />
          <Route path="/u/:username" component={PublicProfileViewerPage} />
          <Route path="/questionnaires" component={QuestionnairesPage} />
          <Route path="/questionnaires/edit" component={ProfileEditorPage} />
          <Route path="/questionnaire-editor">
            <Redirect to="/questionnaires/edit" replace />
          </Route>
          <Route path="/questionnaires/:questionnaireId/edit" component={ProfileEditorPage} />
          <Route path="/profile/edit">
            <Redirect to="/questionnaires/edit" replace />
          </Route>
          <Route path="/profile/legacy" component={ProfilePage} />
          <Route path="/posts/:postId" component={PostsPage} />
          <Route path="/posts" component={PostsPage} />
          <Route path="/gifts" component={GiftsPage} />
          <Route path="/premium" component={PremiumPage} />
          <Route path="/referrals" component={ReferralsPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/admin" component={AdminPage} />
          <Route>
            <Redirect to="/" replace />
          </Route>
        </Switch>
      </AuthGate>
    </MusicPlayerProvider>
  );
}
