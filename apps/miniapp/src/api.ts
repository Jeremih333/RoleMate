import { ru, type MenuLaunchRoute, type ProfileInput } from '@rolemate/shared';

const API_BASE = '/api';

let csrfToken = sessionStorage.getItem('rm_csrf') ?? '';
let csrfRefresh: Promise<string> | null = null;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type ApiErrorPayload = { error?: string; message?: string };

async function renewCsrfToken(): Promise<string> {
  if (csrfRefresh) return csrfRefresh;
  csrfRefresh = (async () => {
    const response = await fetch(`${API_BASE}/auth/session`, {
      method: 'POST',
      body: '{}',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ApiErrorPayload;
      throw new ApiError(
        response.status,
        body.error ?? 'REQUEST_FAILED',
        body.message ?? ru.api.requestFailed,
      );
    }
    const result: { csrfToken: string } = await response.json();
    csrfToken = result.csrfToken;
    sessionStorage.setItem('rm_csrf', csrfToken);
    return csrfToken;
  })().finally(() => {
    csrfRefresh = null;
  });
  return csrfRefresh;
}

async function request<T>(
  path: string,
  options: RequestInit & { body?: string } = {},
  allowCsrfRecovery = true,
): Promise<T> {
  const method = options.method ?? 'GET';
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(method !== 'GET' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    if (
      allowCsrfRecovery &&
      method !== 'GET' &&
      path !== '/auth/session' &&
      body.error === 'INVALID_CSRF'
    ) {
      await renewCsrfToken();
      return request<T>(path, options, false);
    }
    throw new ApiError(
      response.status,
      body.error ?? 'REQUEST_FAILED',
      body.message ?? ru.api.requestFailed,
    );
  }
  const payload: unknown = await response.json();
  return payload as T;
}

async function uploadJsonWithProgress<T>(
  path: string,
  body: string,
  onProgress: (percent: number) => void,
  allowCsrfRecovery = true,
): Promise<T> {
  const result = await new Promise<
    { ok: true; value: T } | { ok: false; status: number; error: string; message: string }
  >((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`);
    xhr.withCredentials = true;
    xhr.timeout = 120_000;
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(99, Math.max(1, Math.round((event.loaded / event.total) * 100))));
    };
    xhr.onerror = () => reject(new ApiError(0, 'REQUEST_FAILED', ru.api.requestFailed));
    xhr.ontimeout = () => reject(new ApiError(408, 'REQUEST_TIMEOUT', ru.api.requestFailed));
    xhr.onload = () => {
      let payload: unknown;
      try {
        payload = xhr.responseText ? (JSON.parse(xhr.responseText) as unknown) : {};
      } catch {
        payload = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve({ ok: true, value: payload as T });
        return;
      }
      const errorPayload = payload as ApiErrorPayload;
      resolve({
        ok: false,
        status: xhr.status,
        error: errorPayload.error ?? 'REQUEST_FAILED',
        message: errorPayload.message ?? ru.api.requestFailed,
      });
    };
    xhr.send(body);
  });
  if (result.ok) return result.value;
  if (allowCsrfRecovery && result.error === 'INVALID_CSRF') {
    await renewCsrfToken();
    return uploadJsonWithProgress<T>(path, body, onProgress, false);
  }
  throw new ApiError(result.status, result.error, result.message);
}

export const api = {
  async refreshSession() {
    const result = await request<{
      user: {
        id: string;
        telegramUserId: number;
        role: string;
        isAdmin: boolean;
        isOwner: boolean;
      };
      csrfToken: string;
    }>('/auth/session', { method: 'POST', body: '{}' });
    csrfToken = result.csrfToken;
    sessionStorage.setItem('rm_csrf', csrfToken);
    return result.user;
  },
  async authenticate(initData: string) {
    const result = await request<{
      user: { id: string; telegramUserId: number; role: string };
      csrfToken: string;
    }>('/auth/telegram', { method: 'POST', body: JSON.stringify({ initData }) });
    csrfToken = result.csrfToken;
    sessionStorage.setItem('rm_csrf', csrfToken);
    return result.user;
  },
  async authenticateMenu(token: string, route: MenuLaunchRoute) {
    const result = await request<{
      user: { id: string; telegramUserId: number; role: string };
      csrfToken: string;
    }>('/auth/menu', { method: 'POST', body: JSON.stringify({ token, route }) });
    csrfToken = result.csrfToken;
    sessionStorage.setItem('rm_csrf', csrfToken);
    return result.user;
  },
  me: () =>
    request<{
      userId: string;
      telegramUserId: number;
      role: string;
      isAdmin: boolean;
      isOwner: boolean;
      riskScore: number;
    }>('/me'),
  notifications: () => request<UserNotification[]>('/notifications'),
  readNotification: (notificationId: string) =>
    request<{ read: true }>(`/notifications/${notificationId}/read`, {
      method: 'PUT',
      body: '{}',
    }),
  dismissNotification: (notificationId: string) =>
    request<{ dismissed: boolean }>(`/notifications/${notificationId}`, { method: 'DELETE' }),
  dismissAllNotifications: () =>
    request<{ dismissed: number }>('/notifications', { method: 'DELETE' }),
  resolveMentions: (usernames: string[]) =>
    request<Array<{ username: string; user_id: string }>>(
      `/mentions/resolve?usernames=${encodeURIComponent(usernames.join(','))}`,
    ),
  profile: () => request<UserProfileSummary>('/profile'),
  publicProfile: () => request<PublicUserProfile>('/public-profile'),
  publicProfileByUsername: (username: string) => {
    let decodedUsername = username;
    try {
      decodedUsername = decodeURIComponent(username);
    } catch {
      // The route can already contain a decoded username.
    }
    return request<PublicUserProfile>(
      `/profiles/by-username/${encodeURIComponent(decodedUsername.toLowerCase())}`,
    );
  },
  publicProfileByUserId: (userId: string) =>
    request<PublicUserProfile>(`/users/${encodeURIComponent(userId)}/profile`),
  publicQuestionnaires: (userId: string) =>
    request<SearchProfile[]>(`/users/${encodeURIComponent(userId)}/questionnaires?limit=5`),
  publicPosts: (userId: string) =>
    request<SocialPost[]>(`/users/${encodeURIComponent(userId)}/posts?limit=30`),
  followProfile: (userId: string) =>
    request<{ following: boolean }>(`/users/${encodeURIComponent(userId)}/follow`, {
      method: 'POST',
      body: '{}',
    }),
  unfollowProfile: (userId: string) =>
    request<{ following: boolean }>(`/users/${encodeURIComponent(userId)}/follow`, {
      method: 'DELETE',
    }),
  profileFollowers: (userId: string) =>
    request<PublicUserProfile[]>(`/users/${encodeURIComponent(userId)}/followers`),
  profileFollowing: (userId: string) =>
    request<PublicUserProfile[]>(`/users/${encodeURIComponent(userId)}/following`),
  ratePublicProfile: (userId: string, value: -1 | 1) =>
    request<{ saved: true; removed: boolean }>(
      `/users/${encodeURIComponent(userId)}/profile/rating`,
      {
        method: 'PUT',
        body: JSON.stringify({ value }),
      },
    ),
  publicProfileUsernames: () => request<ProfileUsername[]>('/public-profile/usernames'),
  claimPublicProfileUsername: (username: string) =>
    request<{ claimed: true; username: string }>('/public-profile/usernames', {
      method: 'PUT',
      body: JSON.stringify({ username }),
    }),
  releasePublicProfileUsername: (username: string) =>
    request<{ released: true }>(`/public-profile/usernames/${encodeURIComponent(username)}`, {
      method: 'DELETE',
    }),
  savePublicProfile: (input: {
    displayName: string;
    bio: string;
    avatarMediaIds: string[];
    visibilityMode: 'public' | 'following_only';
    showFollowers: boolean;
    showFollowing: boolean;
    showQuestionnaires: boolean;
    showPosts: boolean;
    showLastSeen: boolean;
    directMessagePolicy: 'everyone' | 'following_and_staff';
  }) =>
    request<{ updated: true }>('/public-profile', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  savePublicProfilePrivacy: (input: PublicProfilePrivacyInput) =>
    request<{ updated: true }>('/public-profile/privacy', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  questionnaires: () => request<QuestionnaireCollection>('/questionnaires'),
  questionnaire: (questionnaireId: string) =>
    request<QuestionnaireSummary>(`/questionnaires/${questionnaireId}`),
  questionnairePreview: (questionnaireId: string) =>
    request<SearchProfile>(`/questionnaires/${questionnaireId}/preview`),
  saveQuestionnaire: (questionnaireId: string, title: string, profile: ProfileInput) =>
    request<{ updated: true }>(`/questionnaires/${questionnaireId}`, {
      method: 'PUT',
      body: JSON.stringify({ title, profile }),
    }),
  cloneQuestionnaire: (title: string) =>
    request<{ id: string; cloned: true }>('/questionnaires/clone', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  deleteQuestionnaire: (questionnaireId: string) =>
    request<{ deleted: true }>(`/questionnaires/${questionnaireId}`, {
      method: 'DELETE',
    }),
  setQuestionnaireActive: (questionnaireId: string, active: boolean) =>
    request<{ active: boolean }>(`/questionnaires/${questionnaireId}/state`, {
      method: 'PUT',
      body: JSON.stringify({ active }),
    }),
  setPrimaryQuestionnaire: (questionnaireId: string) =>
    request<{ primary: true; questionnaireId: string }>(
      `/questionnaires/${questionnaireId}/primary`,
      { method: 'PUT', body: '{}' },
    ),
  profilePreview: () => request<SearchProfile>('/profile/preview'),
  saveProfile: (profile: ProfileInput) =>
    request<{ profileId: string; moderationStatus: string; completion: number }>('/profile', {
      method: 'PUT',
      body: JSON.stringify(profile),
    }),
  setProfileActive: (active: boolean) =>
    request<{ active: boolean }>('/profile/state', {
      method: 'PUT',
      body: JSON.stringify({ active }),
    }),
  profileMedia: () => request<ProfileMedia[]>('/profile/media'),
  deleteProfileMedia: (mediaId: string) =>
    request<{ deleted: true }>(`/profile/media/${mediaId}`, { method: 'DELETE' }),
  reorderProfileMedia: (mediaIds: string[]) =>
    request<{ reordered: true; mediaIds: string[] }>('/profile/media/order', {
      method: 'PUT',
      body: JSON.stringify({ mediaIds }),
    }),
  reorderProfileAudio: (mediaIds: string[]) =>
    request<{ reordered: true; mediaIds: string[] }>('/profile/audio/order', {
      method: 'PUT',
      body: JSON.stringify({ mediaIds }),
    }),
  questionnaireMedia: (questionnaireId: string) =>
    request<ProfileMedia[]>(`/questionnaires/${questionnaireId}/media`),
  deleteQuestionnaireMedia: (questionnaireId: string, mediaId: string) =>
    request<{ deleted: true }>(`/questionnaires/${questionnaireId}/media/${mediaId}`, {
      method: 'DELETE',
    }),
  reorderQuestionnaireMedia: (questionnaireId: string, mediaIds: string[]) =>
    request<{ reordered: true; mediaIds: string[] }>(
      `/questionnaires/${questionnaireId}/media/order`,
      {
        method: 'PUT',
        body: JSON.stringify({ mediaIds }),
      },
    ),
  setProfileAvatar: (mediaId: string | null) =>
    request<{ avatarMediaId: string | null; renderMode: 'photo' | 'animation' | null }>(
      '/profile/avatar',
      {
        method: 'PUT',
        body: JSON.stringify({ mediaId }),
      },
    ),
  search: (query = '', cursor = 0) =>
    request<SearchProfile[]>(
      `/search?limit=20&q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(String(cursor))}`,
    ),
  searchPublicProfiles: (query = '') =>
    request<PublicUserProfile[]>(`/search/profiles?limit=20&q=${encodeURIComponent(query)}`),
  searchAvailability: () => request<SearchAvailability>('/search/availability'),
  searchPreferences: () => request<SearchPreferences>('/search/preferences'),
  taxonomySuggestions: (
    kind:
      | 'language'
      | 'fandom'
      | 'genre'
      | 'tag'
      | 'hashtag'
      | 'plot'
      | 'setting'
      | 'looking_for'
      | 'boundary',
    query = '',
  ) =>
    request<Array<{ value: string; usage_count: number }>>(
      `/taxonomy/suggestions?kind=${encodeURIComponent(kind)}&q=${encodeURIComponent(query)}&limit=12`,
    ),
  recordTaxonomySelection: (
    kind:
      | 'language'
      | 'fandom'
      | 'genre'
      | 'tag'
      | 'hashtag'
      | 'plot'
      | 'setting'
      | 'looking_for'
      | 'boundary',
    value: string,
  ) =>
    request<{ recorded: boolean; usage_count: number }>('/taxonomy/selections', {
      method: 'POST',
      body: JSON.stringify({ kind, value }),
    }),
  saveSearchPreferences: (preferences: SearchPreferencesInput) =>
    request<{ updated: true }>('/search/preferences', {
      method: 'PUT',
      body: JSON.stringify(preferences),
    }),
  filterSets: () => request<SavedFilterSet[]>('/search/filter-sets'),
  saveFilterSet: (name: string, filters: SearchPreferencesInput) =>
    request<SavedFilterSet>('/search/filter-sets', {
      method: 'POST',
      body: JSON.stringify({ name, filters }),
    }),
  activateFilterSet: (filterSetId: string) =>
    request<{ activated: true }>(`/search/filter-sets/${filterSetId}/activate`, {
      method: 'POST',
      body: '{}',
    }),
  deleteFilterSet: (filterSetId: string) =>
    request<{ deleted: true }>(`/search/filter-sets/${filterSetId}`, { method: 'DELETE' }),
  swipe: (
    targetUserId: string,
    action: 'like' | 'skip' | 'super_like' | 'rewind',
    questionnaireId?: string,
  ) =>
    request<{ created: boolean; matched: boolean; matchId?: string; alreadySent?: boolean }>(
      '/swipes',
      {
        method: 'POST',
        body: JSON.stringify({ targetUserId, action, questionnaireId }),
      },
    ),
  rewind: () =>
    request<{ rewound: true; targetUserId: string }>('/swipes/rewind', {
      method: 'POST',
      body: '{}',
    }),
  incomingLikes: () => request<IncomingLike[]>('/swipes/incoming'),
  posts: (sort: 'interesting' | 'new' = 'interesting', followingOnly = false) =>
    request<SocialPost[]>(
      `/posts?limit=30&sort=${encodeURIComponent(sort)}&followingOnly=${String(followingOnly)}`,
    ),
  post: (postId: string) => request<SocialPost>(`/posts/${encodeURIComponent(postId)}`),
  ownPosts: () => request<SocialPost[]>('/posts/own?limit=30'),
  repostPost: (postId: string) =>
    request<{ reposted: true; postId: string }>(`/posts/${postId}/repost`, {
      method: 'POST',
      body: '{}',
    }),
  updateOwnPost: (
    postId: string,
    input: {
      title: string;
      bodyMarkdown: string;
      tags: string[];
      fandoms: string[];
      hashtags: string[];
      playlistTitle?: string | null;
    },
  ) =>
    request<{ updated: true }>(`/posts/${postId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  removeOwnPostMedia: (postId: string, mediaId?: string) =>
    request<{ removed: true }>(
      mediaId ? `/posts/${postId}/media/${mediaId}` : `/posts/${postId}/media`,
      { method: 'DELETE' },
    ),
  deleteOwnPost: (postId: string) =>
    request<{ deleted: true }>(`/posts/${postId}`, { method: 'DELETE' }),
  postComments: (postId: string, sort: 'interesting' | 'new' = 'interesting') =>
    request<PostComment[]>(`/posts/${postId}/comments?sort=${encodeURIComponent(sort)}`),
  addPostComment: (postId: string, body: string, parentCommentId?: string) =>
    request<{ id: string; created: true }>(`/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body, ...(parentCommentId ? { parentCommentId } : {}) }),
    }),
  updatePostComment: (commentId: string, body: string) =>
    request<{ updated: true; postId: string }>(`/comments/${commentId}`, {
      method: 'PUT',
      body: JSON.stringify({ body }),
    }),
  deleteOwnPostComment: (commentId: string) =>
    request<{ deleted: true; postId: string }>(`/comments/${commentId}`, {
      method: 'DELETE',
    }),
  ratePostComment: (commentId: string, value: -1 | 1) =>
    request<{ saved: true }>(`/comments/${commentId}/rating`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  ratePost: (postId: string, value: -1 | 1) =>
    request<{ saved: true; value: -1 | 1 | null }>(`/posts/${postId}/rating`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  recordPostView: (postId: string) =>
    request<{ recorded: boolean }>(`/posts/${postId}/view`, {
      method: 'POST',
      body: '{}',
    }),
  postEngagement: (postId: string, kind: 'ratings' | 'shares') =>
    request<PostEngagementUser[]>(
      `/posts/${encodeURIComponent(postId)}/engagement?kind=${encodeURIComponent(kind)}`,
    ),
  hidePost: (postId: string) =>
    request<{ hidden: true }>(`/posts/${encodeURIComponent(postId)}/hide`, {
      method: 'POST',
      body: '{}',
    }),
  recordQuestionnaireView: (questionnaireId: string) =>
    request<{ recorded: boolean }>(`/questionnaires/${questionnaireId}/view`, {
      method: 'POST',
      body: '{}',
    }),
  premiumStatus: () => request<PremiumStatus>('/premium/status'),
  applyPromotion: (code: string) =>
    request<{
      type: 'discount' | 'premium_days';
      discountStars?: number;
      discountRubles?: number;
      premiumDays?: number;
      eligibleProductIds?: string[];
    }>('/promotions/apply', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  premiumBoost: () =>
    request<{ boosted: true }>('/premium/boost', {
      method: 'POST',
      body: '{}',
    }),
  premiumStats: () => request<PremiumStats>('/premium/stats'),
  profileVariants: () => request<ProfileVariant[]>('/premium/profile-variants'),
  saveProfileVariant: (input: ProfileVariantInput) =>
    request<{ id: string }>('/premium/profile-variants', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  activateProfileVariant: (variantId: string) =>
    request<{ activated: true }>(`/premium/profile-variants/${variantId}/activate`, {
      method: 'POST',
      body: '{}',
    }),
  deleteProfileVariant: (variantId: string) =>
    request<{ deleted: true }>(`/premium/profile-variants/${variantId}`, { method: 'DELETE' }),
  conversations: (archived = false) =>
    request<Conversation[]>(archived ? '/conversations?archived=1' : '/conversations'),
  archiveConversation: (conversationId: string, archived: boolean) =>
    request<{ archived: boolean }>(`/conversations/${conversationId}/archive`, {
      method: 'PUT',
      body: JSON.stringify({ archived }),
    }),
  pinConversation: (conversationId: string, pinned: boolean) =>
    request<{ pinned: boolean }>(`/conversations/${conversationId}/pin`, {
      method: 'PUT',
      body: JSON.stringify({ pinned }),
    }),
  reorderPinnedConversations: (conversationIds: string[]) =>
    request<{ reordered: true; conversationIds: string[] }>('/conversations/pins/order', {
      method: 'PUT',
      body: JSON.stringify({ conversationIds }),
    }),
  conversationMessages: (conversationId: string) =>
    request<ConversationMessage[]>(`/conversations/${conversationId}/messages`),
  conversationMessage: (conversationId: string, messageId: string) =>
    request<ConversationMessage>(`/conversations/${conversationId}/messages/${messageId}`),
  conversationDraft: (conversationId: string) =>
    request<{ text: string; updatedAt: string | null }>(`/conversations/${conversationId}/draft`),
  saveConversationDraft: (conversationId: string, text: string) =>
    request<{ saved?: true; deleted?: true }>(`/conversations/${conversationId}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ text }),
    }),
  deleteConversationDraft: (conversationId: string) =>
    request<{ deleted: true }>(`/conversations/${conversationId}/draft`, { method: 'DELETE' }),
  pinnedConversationMessages: (conversationId: string) =>
    request<PinnedConversationMessage[]>(`/conversations/${conversationId}/pins`),
  pinConversationMessage: (
    conversationId: string,
    messageId: string,
    pinned: boolean,
    sharedWithParticipant = false,
  ) =>
    request<{ pinned: boolean; shared: boolean }>(
      `/conversations/${conversationId}/messages/${messageId}/pin`,
      {
        method: 'PUT',
        body: JSON.stringify({ pinned, sharedWithParticipant }),
      },
    ),
  conversationPresence: (conversationId: string) =>
    request<{ activity: ChatLiveActivity | null }>(`/conversations/${conversationId}/presence`),
  setConversationPresence: (conversationId: string, activity: ChatLiveActivity | 'idle') =>
    request<{ updated: true }>(`/conversations/${conversationId}/presence`, {
      method: 'PUT',
      body: JSON.stringify({ activity }),
    }),
  deleteConversationMessages: (conversationId: string, messageIds: string[]) =>
    request<{ deleted: number }>(`/conversations/${conversationId}/messages`, {
      method: 'DELETE',
      body: JSON.stringify({ messageIds }),
    }),
  forwardConversationMessages: (
    conversationId: string,
    messageIds: string[],
    conversationIds: string[],
  ) =>
    request<{ forwarded: number; conversationIds: string[] }>(
      `/conversations/${conversationId}/messages/forward`,
      {
        method: 'POST',
        body: JSON.stringify({ messageIds, conversationIds }),
      },
    ),
  updateConversationMessageText: (conversationId: string, messageId: string, text: string) =>
    request<{ updated: true }>(`/conversations/${conversationId}/messages/${messageId}/text`, {
      method: 'PUT',
      body: JSON.stringify({ text }),
    }),
  reorderConversationMedia: (conversationId: string, mediaGroupId: string, messageIds: string[]) =>
    request<{ reordered: true }>(
      `/conversations/${conversationId}/media-groups/${mediaGroupId}/order`,
      { method: 'PUT', body: JSON.stringify({ messageIds }) },
    ),
  replaceConversationMedia: (
    conversationId: string,
    messageId: string,
    input: {
      kind: ChatMediaKind;
      fileName: string;
      mimeType: string;
      dataBase64: string;
    },
  ) =>
    request<{ replaced: true }>(`/conversations/${conversationId}/messages/${messageId}/media`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteConversation: (conversationId: string) =>
    request<{ deleted: true }>(`/conversations/${conversationId}`, {
      method: 'DELETE',
    }),
  startDirectConversation: (targetUserId: string) =>
    request<{ conversationId: string }>('/conversations/direct', {
      method: 'POST',
      body: JSON.stringify({ targetUserId }),
    }),
  sendConversationMessage: (conversationId: string, text: string, replyToMessageId?: string) =>
    request<{ sent: true; messageId: string }>(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text, ...(replyToMessageId ? { replyToMessageId } : {}) }),
    }),
  sendConversationMedia: (
    conversationId: string,
    input: {
      kind: ChatMediaKind;
      fileName: string;
      mimeType: string;
      dataBase64: string;
      mediaGroupId?: string;
      playlistTitle?: string | null;
      notifyRecipient?: boolean;
      replyToMessageId?: string;
      caption?: string;
      captionPosition?: 'top' | 'bottom';
    },
    onProgress?: (percent: number) => void,
  ) => {
    const path = `/conversations/${conversationId}/media`;
    const body = JSON.stringify(input);
    return onProgress
      ? uploadJsonWithProgress<{ sent: true; messageType: ChatMediaKind; messageId: string }>(
          path,
          body,
          onProgress,
        )
      : request<{ sent: true; messageType: ChatMediaKind; messageId: string }>(path, {
          method: 'POST',
          body,
        });
  },
  reactConversationMessage: (conversationId: string, messageId: string, reaction: ChatReaction) =>
    request<{ reaction: ChatReaction | null }>(
      `/conversations/${conversationId}/messages/${messageId}/reaction`,
      { method: 'PUT', body: JSON.stringify({ reaction }) },
    ),
  shareConversationProfile: (conversationId: string, replyToMessageId?: string) =>
    request<{ sent: true; messageId: string }>(`/conversations/${conversationId}/profile-share`, {
      method: 'POST',
      body: JSON.stringify(replyToMessageId ? { replyToMessageId } : {}),
    }),
  shareConversationScenario: (
    conversationId: string,
    variantId: string,
    replyToMessageId?: string,
  ) =>
    request<{ sent: true; messageId: string }>(`/conversations/${conversationId}/scenario-share`, {
      method: 'POST',
      body: JSON.stringify({ variantId, ...(replyToMessageId ? { replyToMessageId } : {}) }),
    }),
  shareEntity: (input: {
    entityType: 'post' | 'questionnaire';
    entityId: string;
    conversationIds: string[];
    caption?: string;
  }) =>
    request<{ sent: number }>('/shares/entity', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  sharePlaylist: (input: {
    sourceType: 'post' | 'chat';
    sourceId: string;
    trackIds: string[];
    conversationIds: string[];
    title?: string | null;
  }) =>
    request<{ sent: number; tracks: number }>('/shares/playlist', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  giftPremiumInvoice: (conversationId: string, productId: string) =>
    request<{ invoiceLink?: string }>(`/conversations/${conversationId}/premium-gift/invoice`, {
      method: 'POST',
      body: JSON.stringify({ productId }),
    }),
  matches: () => request<Match[]>('/matches'),
  blockedUsers: () => request<BlockedUser[]>('/blocks'),
  block: (blockedUserId: string, reason = 'user_request') =>
    request<{ blocked: true }>('/blocks', {
      method: 'POST',
      body: JSON.stringify({ blockedUserId, reason }),
    }),
  unblock: (blockedUserId: string) =>
    request<{ blocked: false }>(`/blocks/${encodeURIComponent(blockedUserId)}`, {
      method: 'DELETE',
    }),
  report: (input: {
    reportedUserId: string;
    conversationId?: string;
    postId?: string;
    questionnaireId?: string;
    commentId?: string;
    profileUserId?: string;
    category: ReportCategory;
    description: string;
  }) =>
    request<{ reportId: string }>('/reports', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  controlConversation: (
    conversationId: string,
    action: 'mute' | 'unmute' | 'pause' | 'resume' | 'close',
  ) =>
    request<{ status: string; muted: boolean }>(`/conversations/${conversationId}/control`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  rateConversation: (conversationId: string, value: -1 | 1) =>
    request<{ saved: true }>(`/conversations/${conversationId}/rating`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    }),
  settings: () => request<UserSettings>('/settings'),
  saveSettings: (settings: SettingsInput) =>
    request<{ updated: true }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  setSearchEnabled: (enabled: boolean) =>
    request<{ enabled: boolean }>('/search/state', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  products: () => request<Product[]>('/products'),
  invoice: (productId: string) =>
    request<{ invoiceLink?: string }>('/payments/invoice', {
      method: 'POST',
      body: JSON.stringify({ productId }),
    }),
  referrals: () => request<ReferralSummary>('/referrals'),
  adminDashboard: () => request<AdminStats>('/admin/dashboard'),
  adminModerators: () => request<AdminModerator[]>('/admin/moderators'),
  adminAssignModerator: (telegramUserId: number) =>
    request<{ assigned: true }>('/admin/moderators', {
      method: 'POST',
      body: JSON.stringify({ telegramUserId }),
    }),
  adminRemoveModerator: (telegramUserId: number) =>
    request<{ removed: true }>(`/admin/moderators/${telegramUserId}`, {
      method: 'DELETE',
      body: '{}',
    }),
  adminUsers: (query = '') =>
    request<AdminUser[]>(`/admin/users?q=${encodeURIComponent(query)}&limit=50`),
  adminProfiles: (status = 'all', query = '') =>
    request<AdminProfile[]>(
      `/admin/profiles?status=${encodeURIComponent(status)}&q=${encodeURIComponent(query)}&limit=50`,
    ),
  adminPublicProfiles: (status = 'all', query = '') =>
    request<AdminPublicProfile[]>(
      `/admin/public-profiles?status=${encodeURIComponent(status)}&q=${encodeURIComponent(query)}&limit=50`,
    ),
  adminModeratePublicProfile: (
    profileUserId: string,
    status: 'active' | 'blocked',
    reason: string,
  ) =>
    request<{ updated: true }>(`/admin/public-profiles/${profileUserId}/moderate`, {
      method: 'POST',
      body: JSON.stringify({ status, reason }),
    }),
  adminReplaceProfileUsernames: (userId: string, usernames: string[]) =>
    request<{ updated: true; usernames: string[] }>(`/admin/users/${userId}/usernames`, {
      method: 'PUT',
      body: JSON.stringify({ usernames }),
    }),
  adminQuestionnaires: (status = 'all', query = '') =>
    request<AdminQuestionnaire[]>(
      `/admin/questionnaires?status=${encodeURIComponent(status)}&q=${encodeURIComponent(query)}&limit=50`,
    ),
  adminModerateQuestionnaire: (
    questionnaireId: string,
    status: 'approved' | 'rejected' | 'paused' | 'archived',
    reason: string,
  ) =>
    request<{ updated: true }>(`/admin/questionnaires/${questionnaireId}/moderate`, {
      method: 'POST',
      body: JSON.stringify({ status, reason }),
    }),
  adminPosts: (status = 'all', query = '') =>
    request<AdminPost[]>(
      `/admin/posts?status=${encodeURIComponent(status)}&q=${encodeURIComponent(query)}&limit=50`,
    ),
  adminModeratePost: (
    postId: string,
    status: 'active' | 'blocked' | 'limited' | 'shadow_banned',
    reason: string,
  ) =>
    request<{ moderated: true }>(`/admin/posts/${postId}/moderate`, {
      method: 'POST',
      body: JSON.stringify({ status, reason }),
    }),
  adminDeleteComment: (commentId: string, reason: string) =>
    request<{ deleted: true }>(`/admin/comments/${commentId}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    }),
  adminMedia: (status = 'pending') =>
    request<AdminMedia[]>(`/admin/media?status=${encodeURIComponent(status)}&limit=50`),
  adminModerateMedia: (mediaId: string, status: 'approved' | 'rejected', reason: string) =>
    request<{ updated: true }>(`/admin/media/${mediaId}/moderate`, {
      method: 'POST',
      body: JSON.stringify({ status, reason }),
    }),
  adminReports: (status = 'open') =>
    request<AdminReport[]>(`/admin/reports?status=${encodeURIComponent(status)}&limit=100`),
  adminPayments: (status = 'all') =>
    request<AdminPayment[]>(`/admin/payments?status=${encodeURIComponent(status)}&limit=50`),
  adminProducts: () => request<Product[]>('/admin/products'),
  adminUpdateProduct: (productId: string, starsAmount: number, isActive: boolean) =>
    request<{ updated: true }>(`/admin/products/${productId}`, {
      method: 'PUT',
      body: JSON.stringify({ starsAmount, isActive }),
    }),
  adminPromotions: () => request<AdminPromotion[]>('/admin/promotions'),
  adminCreatePromotion: (input: AdminPromotionInput) =>
    request<{ id: string }>('/admin/promotions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  adminUpdatePromotion: (promotionId: string, input: AdminPromotionUpdateInput) =>
    request<{ updated: true }>(`/admin/promotions/${promotionId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  adminDeletePromotion: (promotionId: string) =>
    request<{ deleted: true; archived: boolean }>(`/admin/promotions/${promotionId}`, {
      method: 'DELETE',
      body: '{}',
    }),
  adminPostingRequirements: () => request<PostingRequirement[]>('/admin/posting-requirements'),
  adminCreatePostingRequirement: (input: PostingRequirementInput) =>
    request<{ id: string; integrationSecret?: string; callbackUrl?: string }>(
      '/admin/posting-requirements',
      { method: 'POST', body: JSON.stringify(input) },
    ),
  adminUpdatePostingRequirement: (requirementId: string, isActive: boolean) =>
    request<{ updated: true }>(`/admin/posting-requirements/${requirementId}`, {
      method: 'PUT',
      body: JSON.stringify({ isActive }),
    }),
  adminRefundPayment: (orderId: string) =>
    request<{ refunded: true }>(`/admin/payments/${orderId}/refund`, {
      method: 'POST',
      body: '{}',
    }),
  adminReferrals: (status = 'all') =>
    request<AdminReferral[]>(`/admin/referrals?status=${encodeURIComponent(status)}&limit=50`),
  adminReviewReferral: (
    referralId: string,
    action: 'confirm' | 'reject' | 'revoke',
    reason: string,
  ) =>
    request<{ updated: true }>(`/admin/referrals/${referralId}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, reason }),
    }),
  adminBroadcasts: () => request<AdminBroadcast[]>('/admin/broadcasts?limit=50'),
  adminCreateBroadcast: (input: {
    title: string;
    message: string;
    segment: 'all' | 'active' | 'premium' | 'nonpremium';
    rateLimitPerSecond: number;
  }) =>
    request<{ id: string; status: string }>('/admin/broadcasts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  adminBroadcastDryRun: (broadcastId: string) =>
    request<{ estimatedRecipients: number; confirmationPhrase: string }>(
      `/admin/broadcasts/${broadcastId}/dry-run`,
      { method: 'POST', body: '{}' },
    ),
  adminControlBroadcast: (
    broadcastId: string,
    action: 'queue' | 'pause' | 'cancel',
    confirmationPhrase = '',
  ) =>
    request<{ updated: true }>(`/admin/broadcasts/${broadcastId}/control`, {
      method: 'POST',
      body: JSON.stringify({ action, confirmationPhrase }),
    }),
  adminSystem: () => request<AdminSystemStatus>('/admin/system'),
  adminModerateUser: (
    userId: string,
    input: {
      action:
        'warn' | 'temporary_ban' | 'permanent_ban' | 'unban' | 'disable_profile' | 'reset_captcha';
      reason: string;
      bannedUntil?: string;
    },
  ) =>
    request<{ updated: true }>(`/admin/users/${userId}/moderate`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  adminModerateProfile: (
    profileId: string,
    status: 'approved' | 'rejected' | 'paused' | 'archived',
    reason: string,
  ) =>
    request<{ updated: true }>(`/admin/profiles/${profileId}/moderate`, {
      method: 'POST',
      body: JSON.stringify({ status, reason }),
    }),
  adminResolveReport: (
    reportId: string,
    status: 'reviewing' | 'resolved' | 'dismissed',
    resolution: string,
  ) =>
    request<{ updated: true }>(`/admin/reports/${reportId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ status, resolution }),
    }),
  adminGrantPremium: (
    userId: string,
    durationDays: number,
    reason: string,
    idempotencyKey: string,
  ) =>
    request<{ granted: true }>(`/admin/users/${userId}/premium/grant`, {
      method: 'POST',
      body: JSON.stringify({ durationDays, reason, idempotencyKey }),
    }),
  adminRevokePremium: (userId: string, reason: string) =>
    request<{ revoked: true }>(`/admin/users/${userId}/premium/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  adminFlags: () => request<FeatureFlag[]>('/admin/flags'),
  adminUpdateFlag: (key: string, enabled: boolean) =>
    request<{ updated: true }>(`/admin/flags/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled, payload: {} }),
    }),
  adminConfig: () => request<AdminConfig[]>('/admin/config'),
  adminUpdateConfig: (key: AdminConfig['key'], value: string) =>
    request<{ updated: true }>(`/admin/config/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  adminGroupCampaignSettings: () =>
    request<AdminGroupCampaignSettings>('/admin/group-campaigns/settings'),
  adminUpdateGroupCampaignSettings: (intervalMinutes: number) =>
    request<{ updated: true; intervalMinutes: number }>('/admin/group-campaigns/settings', {
      method: 'PUT',
      body: JSON.stringify({ intervalMinutes }),
    }),
  adminAudit: () => request<AuditEntry[]>('/admin/audit?limit=50'),
  deleteAccount: () =>
    request<{ deleted: true }>('/account', {
      method: 'DELETE',
      body: JSON.stringify({ confirmation: ru.api.deleteConfirmation }),
    }),
};

export interface SearchProfile {
  id: string;
  user_id: string;
  display_name: string;
  age_group: string | null;
  gender: string | null;
  short_headline: string;
  about: string;
  fandoms: string;
  genres: string;
  tags: string;
  writing_style: string;
  average_post_length: string;
  activity_frequency: string;
  roleplay_experience?: string;
  preferred_role?: string;
  timezone?: string;
  active_hours?: string;
  languages?: string;
  settings?: string;
  plots?: string;
  looking_for?: string;
  boundaries?: string;
  adult_topics_allowed?: number;
  contact_reveal_policy?: string;
  compatibility: number;
  is_premium: number;
  has_premium: number;
  media_id?: string | null;
  media_type?: ProfileMedia['media_type'] | null;
  media_items?: string;
  avatar_media_id?: string | null;
  avatar_render_mode?: 'photo' | 'animation' | 'still' | null;
  rating_likes: number;
  rating_dislikes: number;
  rating_score: number;
  own_rating?: -1 | 1 | null;
  view_count: number;
  username?: string | null;
  verification_kind?: 'owner' | 'moderator' | null;
  is_online?: number;
}

export interface UserProfileSummary extends Record<string, unknown> {
  profile_completion_percent: number;
  in_search_pool: number;
  is_active: number;
  moderation_status: string;
}

export interface BlockedUser {
  id: string;
  display_name: string | null;
  username: string | null;
  verification_kind: 'owner' | 'moderator' | null;
  has_premium: number;
  blocked_at: string;
}

export interface PublicUserProfile {
  id: string;
  display_name: string;
  bio: string;
  avatar_media_id: string | null;
  avatar_render_mode: 'photo' | 'animation' | 'still' | null;
  avatar_media_items?: string;
  moderation_status: 'active' | 'blocked';
  moderation_reason: string | null;
  verification_kind: 'owner' | 'moderator' | null;
  usernames: string;
  featured_audio_items: string;
  questionnaire_count: number;
  post_count: number;
  rating_likes: number;
  rating_dislikes: number;
  rating_score: number;
  own_rating: -1 | 1 | null;
  owner_liked?: number;
  visibility_mode: 'public' | 'following_only';
  followers_count: number;
  following_count: number;
  has_premium: number;
  is_following: number;
  follows_viewer: number;
  blocked_by_me: number;
  blocked_me: number;
  content_access: number;
  show_followers: number;
  show_following: number;
  show_questionnaires: number;
  show_posts: number;
  direct_message_policy: 'everyone' | 'following_and_staff';
  show_last_seen: number;
  can_direct_message?: number;
  created_at: string;
  updated_at: string;
}

export interface PublicProfilePrivacyInput {
  visibilityMode: 'public' | 'following_only';
  showFollowers: boolean;
  showFollowing: boolean;
  showQuestionnaires: boolean;
  showPosts: boolean;
  showLastSeen: boolean;
  directMessagePolicy: 'everyone' | 'following_and_staff';
}

export interface UserNotification {
  id: string;
  actor_user_id: string | null;
  kind: 'mention' | 'comment' | 'message';
  context: 'chat' | 'questionnaire' | 'post' | 'comment';
  entity_id: string | null;
  message: string;
  open_path: string;
  read_at: string | null;
  created_at: string;
}

export interface ProfileUsername {
  username: string;
  is_primary: number;
  created_at: string;
}

export interface QuestionnaireSummary extends UserProfileSummary {
  id: string;
  title: string;
  display_name: string;
  short_headline: string;
  is_primary: number;
  media_count: number;
  rating_likes: number;
  rating_dislikes: number;
  rating_score: number;
}

export interface QuestionnaireCollection {
  premium: boolean;
  limit: number;
  questionnaires: QuestionnaireSummary[];
}

export interface SocialPost {
  id: string;
  author_user_id: string;
  source_chat_id: number | null;
  source_message_id: number | null;
  content_type: string;
  title: string;
  body_markdown: string;
  text_preview: string;
  media_telegram_file_id: string | null;
  media_mime_type?: string | null;
  media_thumbnail_file_id: string | null;
  track_title: string | null;
  track_performer: string | null;
  playlist_title: string | null;
  published_at: string;
  display_name: string;
  avatar_media_id: string | null;
  avatar_render_mode: 'photo' | 'animation' | 'still' | null;
  verification_kind: 'owner' | 'moderator' | null;
  has_premium: number;
  repost_source_post_id?: string | null;
  original_author_user_id?: string | null;
  original_author_name?: string | null;
  original_author_avatar_media_id?: string | null;
  original_author_avatar_render_mode?: 'photo' | 'animation' | 'still' | null;
  likes: number;
  dislikes: number;
  rating_score: number;
  comment_count: number;
  share_count?: number;
  view_count: number;
  own_rating: -1 | 1 | null;
  owner_liked?: number;
  media_items: string;
  tags: string;
  fandoms: string;
  hashtags: string;
  reach_status: 'normal' | 'limited' | 'shadow_banned';
  affinity_score?: number;
  is_following?: number;
  top_comment?: string | null;
  top_comments?: string | null;
}

export interface PostEngagementUser {
  id: string;
  display_name: string;
  avatar_media_id: string | null;
  avatar_render_mode: 'photo' | 'animation' | 'still' | null;
  verification_kind: 'owner' | 'moderator' | null;
  has_premium: number;
  value: -1 | 1 | null;
  activity_at: string;
}

export type SearchScope = 'questionnaires' | 'profiles';

export interface PostComment {
  id: string;
  post_id: string;
  author_user_id: string;
  parent_comment_id: string | null;
  body: string;
  created_at: string;
  display_name: string;
  avatar_media_id: string | null;
  avatar_render_mode: 'photo' | 'animation' | 'still' | null;
  verification_kind: 'owner' | 'moderator' | null;
  has_premium: number;
  likes: number;
  dislikes: number;
  own_rating: -1 | 1 | null;
  owner_liked?: number;
  thread_reply_count: number;
}

export interface SearchAvailability {
  otherProfiles: number;
  otherSearchable: number;
  safeCandidates: number;
}

export interface ProfileMedia {
  id: string;
  media_type: 'photo' | 'animation' | 'video' | 'audio' | 'voice' | 'document';
  sort_order: number;
  audio_sort_order?: number | null;
  moderation_status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  track_title?: string | null;
  track_performer?: string | null;
  has_thumbnail?: number;
  file_size_bytes?: number | null;
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
  is_avatar?: number;
}

export interface SearchPreferences {
  premium: boolean;
  age_groups: string;
  languages: string;
  genres: string;
  fandoms: string;
  writing_styles: string;
  activity_levels: string;
  only_online: number;
  only_with_photo: number;
}

export interface SearchPreferencesInput {
  ageGroups: Array<'under_16' | '16_17' | '18_20' | '21_25' | '26_plus'>;
  languages: string[];
  genres: string[];
  fandoms: string[];
  writingStyles: string[];
  activityLevels: string[];
  onlyOnline: boolean;
  onlyWithPhoto: boolean;
}

export interface SavedFilterSet {
  id: string;
  name: string;
  filters: string;
  is_active: number;
}

export interface IncomingLike extends SearchProfile {
  swipe_id: string;
  action: 'like' | 'super_like';
  created_at: string;
}

export interface PremiumStatus {
  premium: boolean;
  endsAt?: string;
  earlyAccess: boolean;
  usage: {
    profileViews: number;
    profileViewLimit: number;
    superLikes: number;
    superLikeLimit: number;
  };
}

export interface ProfileVariant {
  id: string;
  name: string;
  short_headline: string;
  about: string;
  plots: string;
  is_active: number;
}

export interface ProfileVariantInput {
  name: string;
  shortHeadline: string;
  about: string;
  plots: string;
}

export interface PremiumStats {
  viewsToday: number;
  viewsSevenDays: number;
  viewsTotal: number;
  incomingLikes: number;
}

export interface Conversation {
  id: string;
  status: string;
  anonymous_alias: string;
  other_user_id: string;
  display_name?: string;
  short_headline?: string;
  avatar_media_id?: string | null;
  avatar_render_mode?: 'photo' | 'animation' | 'still' | null;
  verification_kind?: 'owner' | 'moderator' | null;
  has_premium?: number;
  own_rating?: -1 | 1 | null;
  contact_reveal_status: string;
  is_muted: number;
  archived_at?: string | null;
  pinned_order?: number | null;
  last_message_at?: string;
  last_message_type?: string | null;
  last_media_group_id?: string | null;
  last_media_group_size?: number | null;
  last_playlist_title?: string | null;
  last_sender_user_id?: string | null;
  last_message_text?: string | null;
  draft_text?: string | null;
  is_online?: number;
  presence_last_seen_at?: string | null;
}

export type ChatMediaKind = 'photo' | 'animation' | 'video' | 'audio' | 'voice';
export type ChatLiveActivity = 'typing' | 'recording_voice' | 'sending_media';
export type ChatReaction = string;

export interface ConversationMessage {
  id: string;
  sender_user_id: string;
  message_type: ChatMediaKind | 'text' | 'profile' | 'scenario' | 'sticker' | 'document';
  text_content: string | null;
  mime_type: string | null;
  file_name: string | null;
  track_title: string | null;
  track_performer: string | null;
  duration_seconds: number | null;
  has_thumbnail: number;
  created_at: string;
  is_own: number;
  has_media: number;
  delivered_at: string | null;
  read_at: string | null;
  edited_at?: string | null;
  media_group_id: string | null;
  playlist_title?: string | null;
  own_reaction: ChatReaction | null;
  reactions: string;
  reply_to_message_id?: string | null;
  reply_message_type?: ConversationMessage['message_type'] | null;
  reply_text_content?: string | null;
  reply_file_name?: string | null;
  reply_has_media?: number;
  reply_is_own?: number;
  reply_sender_name?: string | null;
  forwarded_from_message_id?: string | null;
  forwarded_author_user_id?: string | null;
  forwarded_author_name?: string | null;
  forwarded_author_avatar_media_id?: string | null;
  forwarded_author_avatar_render_mode?: 'photo' | 'animation' | 'still' | null;
  forwarded_author_has_premium?: number;
  forwarded_author_verification_kind?: 'owner' | 'moderator' | null;
  caption_position?: 'top' | 'bottom' | null;
  reply_count?: number;
  pinned_by_me?: number;
}

export interface PinnedConversationMessage {
  id: string;
  pinned_at: string;
  pinned_by_user_id: string;
  sender_user_id: string;
  sender_name: string;
  message_type: ConversationMessage['message_type'];
  text_content: string | null;
  file_name: string | null;
  has_media: number;
}

export interface Match {
  id: string;
  status: string;
  matched_at: string;
  conversation_id: string;
  other_user_id: string;
  display_name?: string;
  short_headline?: string;
  avatar_media_id?: string | null;
  avatar_render_mode?: 'photo' | 'animation' | 'still' | null;
  verification_kind?: 'owner' | 'moderator' | null;
  has_premium?: number;
}

export type ReportCategory =
  | 'spam'
  | 'advertising'
  | 'insults'
  | 'harassment'
  | 'unwanted_content'
  | 'impersonation'
  | 'fraud'
  | 'personal_data'
  | 'prohibited_adult_content'
  | 'unsafe_minor'
  | 'other';

export interface UserSettings {
  notifications_enabled: number;
  telegram_notifications_enabled: number;
  match_notifications_enabled: number;
  message_notifications_enabled: number;
  mention_notifications_enabled: number;
  comment_notifications_enabled: number;
  referral_notifications_enabled: number;
  premium_notifications_enabled: number;
  follower_post_notifications_enabled: number;
  follower_questionnaire_notifications_enabled: number;
  privacy_shield_enabled: number;
  show_online_status: number;
  show_premium_badge: number;
  hide_demographics: number;
  chat_archive_visible: number;
  auto_archive_new_chats: number;
  hide_forward_author: number;
  quick_reaction: string;
  theme: 'telegram' | 'light' | 'dark';
  search_enabled: number;
}

export interface SettingsInput {
  notificationsEnabled: boolean;
  telegramNotificationsEnabled: boolean;
  matchNotificationsEnabled: boolean;
  messageNotificationsEnabled: boolean;
  mentionNotificationsEnabled: boolean;
  commentNotificationsEnabled: boolean;
  referralNotificationsEnabled: boolean;
  premiumNotificationsEnabled: boolean;
  followerPostNotificationsEnabled: boolean;
  followerQuestionnaireNotificationsEnabled: boolean;
  privacyShieldEnabled: boolean;
  showOnlineStatus: boolean;
  showPremiumBadge: boolean;
  hideDemographics: boolean;
  chatArchiveVisible: boolean;
  autoArchiveNewChats: boolean;
  hideForwardAuthor: boolean;
  quickReaction: string;
  theme: 'telegram' | 'light' | 'dark';
}

export interface AdminPromotion {
  id: string;
  code: string;
  type: 'discount' | 'premium_days';
  discount_stars: number;
  discount_rubles: number;
  premium_days: number;
  eligible_product_ids: string;
  expires_at?: string;
  max_activations?: number;
  activation_count: number;
  is_active: number;
}

export interface AdminPromotionInput {
  code: string;
  type: 'discount' | 'premium_days';
  discountStars: number;
  discountRubles: number;
  premiumDays: number;
  eligibleProductIds: string[];
  expiresAt?: string;
  maxActivations?: number;
}

export type AdminPromotionUpdateInput = Omit<
  AdminPromotionInput,
  'expiresAt' | 'maxActivations'
> & {
  expiresAt: string | null;
  maxActivations: number | null;
  isActive: boolean;
};

export interface PostingRequirement {
  id: string;
  type: 'channel' | 'supergroup' | 'bot';
  title: string;
  target_chat_id?: string;
  username?: string;
  action_url: string;
  expires_at?: string;
  max_conversions?: number;
  conversion_count: number;
  is_active: number;
}

export interface PostingRequirementInput {
  type: 'channel' | 'supergroup' | 'bot';
  title: string;
  targetChatId?: string;
  username?: string;
  actionUrl?: string;
  createInvite: boolean;
  expiresAt?: string;
  maxConversions?: number;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  description: string;
  billing_type: string;
  duration_days: number;
  stars_amount: number;
  original_stars_amount?: number;
  effective_stars_amount?: number;
  applied_discount_stars?: number;
  is_active: number;
}

export interface ReferralSummary {
  link: string;
  rewardDays: number;
  invited: number;
  qualified: number;
  pending: number;
}

export interface AdminStats {
  users: number;
  newUsers24h: number;
  activeUsers24h: number;
  profiles: number;
  matches: number;
  conversations: number;
  openReports: number;
  bannedUsers: number;
  premiumUsers: number;
  starsPayments: number;
  qualifiedReferrals: number;
  captcha24h: number;
  pendingJobs: number;
  failedJobs: number;
}

export interface AdminUser {
  id: string;
  telegram_user_id: number;
  telegram_username?: string;
  telegram_first_name: string;
  status: string;
  is_banned: number;
  risk_score: number;
  premium_ends_at?: string;
  has_premium?: number;
}

export interface AdminModerator {
  telegram_user_id: number;
  has_premium?: number;
  telegram_username?: string;
  telegram_first_name: string;
  assigned_at: string;
}

export interface AdminProfile {
  id: string;
  user_id: string;
  display_name: string;
  short_headline: string;
  about: string;
  moderation_status: string;
  risk_score: number;
  telegram_user_id: number;
  has_premium?: number;
}

export interface AdminPublicProfile {
  id: string;
  display_name: string;
  bio: string;
  avatar_media_id: string | null;
  avatar_render_mode: 'photo' | 'animation' | 'still' | null;
  moderation_status: 'active' | 'blocked';
  moderation_reason: string | null;
  verification_kind: 'owner' | 'moderator' | null;
  usernames: string;
  risk_score: number;
  telegram_user_id: number;
  telegram_username?: string;
  questionnaire_count: number;
  post_count: number;
  has_premium?: number;
}

export interface AdminQuestionnaire extends AdminProfile {
  title: string;
  is_primary: number;
  is_active: number;
  media_count: number;
}

export interface AdminPost {
  id: string;
  author_user_id: string;
  content_type: string;
  text_preview: string;
  status: 'active' | 'deleted' | 'blocked';
  published_at: string | null;
  created_at: string;
  display_name: string | null;
  telegram_user_id: number;
  telegram_username?: string;
  reach_status: 'normal' | 'limited' | 'shadow_banned';
  has_premium?: number;
}

export interface AdminMedia {
  id: string;
  media_type: 'photo' | 'animation' | 'video' | 'audio' | 'voice' | 'document';
  moderation_status: 'pending' | 'approved' | 'rejected';
  profile_id: string;
  user_id: string;
  display_name: string;
  telegram_user_id: number;
  created_at: string;
  has_premium?: number;
}

export interface AdminReport {
  id: string;
  category: string;
  description?: string;
  status: string;
  reported_user_id: string;
  reported_telegram_id: number;
  reported_display_name?: string;
  created_at: string;
  questionnaire_id?: string | null;
  post_id?: string | null;
  comment_id?: string | null;
  conversation_id?: string | null;
  target_type: 'questionnaire' | 'post' | 'comment' | 'conversation' | 'user';
  target_title?: string | null;
  target_body?: string | null;
  context_items: string;
}

export interface AdminPayment {
  id: string;
  provider: string;
  currency: string;
  amount: number;
  status: string;
  product_name: string;
  product_id: string;
  product_code: string;
  billing_type: string;
  duration_days: number;
  telegram_user_id: number;
  telegram_username?: string;
  telegram_payment_charge_id?: string;
  entitlement_ends_at?: string;
  entitlement_status?: string;
  expires_at: string;
  paid_at?: string;
  refunded_at?: string;
  created_at: string;
}

export interface AdminReferral {
  id: string;
  status: string;
  qualification_reason?: string;
  qualified_at?: string;
  created_at: string;
  referrer_telegram_id: number;
  referred_telegram_id: number;
  referrer_display_name?: string;
  referred_display_name?: string;
  referred_risk_events_score: number;
}

export interface AdminBroadcast {
  id: string;
  title: string;
  message: string;
  segment: 'all' | 'active' | 'premium' | 'nonpremium';
  status: string;
  rate_limit_per_second: number;
  estimated_recipients: number;
  sent_count: number;
  failed_count: number;
  delivery_errors: number;
  dry_run_at?: string;
  created_at: string;
}

export interface AdminSystemStatus {
  d1: string;
  api: string;
  version: string;
  commitSha: string;
  environment: string;
  uptimeSeconds: number;
  checkedAt: string;
  maintenanceMode: boolean;
  jobs: { pending: number; running: number; failed: number; deadLetters: number };
  lastFailures: Array<{ error_code: string; safe_message: string; created_at: string }>;
  runtime?: { provider?: string; service?: string | null };
}

export interface FeatureFlag {
  key: string;
  enabled: number;
  payload: string;
}

export interface AdminConfig {
  key:
    | 'search_limit'
    | 'relay_rate_limit'
    | 'free_daily_profile_limit'
    | 'premium_daily_profile_limit'
    | 'free_super_like_limit'
    | 'premium_super_like_limit'
    | 'boost_cooldown_days'
    | 'support_text'
    | 'maintenance_text';
  value: string;
  updated_at?: string;
}

export interface AdminGroupCampaignSettings {
  intervalMinutes: number;
  minimumMinutes: number;
  maximumMinutes: number;
  activeCount: number;
  pausedCount: number;
  removedCount: number;
  nextSendAt: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  reason?: string;
  target_user_id?: string;
  request_id: string;
  result: string;
  created_at: string;
}
