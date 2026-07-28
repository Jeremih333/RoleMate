import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Ban, Flag, Heart, RotateCcw, SlidersHorizontal, Star, X } from 'lucide-react';
import { useState } from 'react';
import { ru } from '@rolemate/shared';
import { api, type SearchProfile } from '../api.js';
import { Button, Card, EmptyState, Skeleton } from '../components/ui.js';
import { haptic } from '../telegram.js';

function list(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function ProfileCard({ profile }: { profile: SearchProfile }) {
  const fandoms = list(profile.fandoms);
  const genres = list(profile.genres);
  return (
    <Card className="profile-card overflow-hidden">
      <div className="profile-cover">
        <div className="compatibility">
          {profile.compatibility}%<span>{ru.miniApp.search.matchPercent}</span>
        </div>
        {profile.is_premium ? (
          <span className="premium-badge">
            <Star /> Premium
          </span>
        ) : null}
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-3xl font-semibold">{profile.display_name}</h2>
            <p className="mt-1 text-sm text-muted">{profile.short_headline}</p>
          </div>
          <span className="activity-dot" title={ru.miniApp.search.recentlyActive} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[...fandoms.slice(0, 3), ...genres.slice(0, 2)].map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
        <p className="mt-4 line-clamp-4 text-sm leading-relaxed text-soft">{profile.about}</p>
        <div className="mt-5 grid grid-cols-2 gap-2 text-xs text-muted">
          <span>
            {ru.miniApp.search.style}: {profile.writing_style}
          </span>
          <span>
            {ru.miniApp.search.posts}: {profile.average_post_length}
          </span>
          <span>
            {ru.miniApp.search.activity}: {profile.activity_frequency}
          </span>
          <span>
            {ru.miniApp.search.age}: {profile.age_group}
          </span>
        </div>
      </div>
    </Card>
  );
}

export function SearchPage() {
  const queryClient = useQueryClient();
  const profiles = useQuery({ queryKey: ['search'], queryFn: api.search });
  const [index, setIndex] = useState(0);
  const current = profiles.data?.[index];
  const swipe = useMutation({
    mutationFn: ({
      action,
      profile,
    }: {
      action: 'like' | 'skip' | 'super_like';
      profile: SearchProfile;
    }) => api.swipe(profile.user_id, action),
    onSuccess: (result) => {
      haptic(result.matched ? 'heavy' : 'light');
      setIndex((value) => value + 1);
      if (result.matched) void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  if (profiles.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[34rem]" />
      </div>
    );
  }
  if (!current) {
    return (
      <EmptyState
        icon={<Star className="h-7 w-7" />}
        title={ru.miniApp.search.emptyTitle}
        description={ru.miniApp.search.emptyDescription}
        action={<Button onClick={() => void profiles.refetch()}>{ru.miniApp.search.retry}</Button>}
      />
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="eyebrow">{ru.miniApp.search.eyebrow}</p>
          <h1 className="font-display text-3xl font-semibold">{ru.miniApp.search.title}</h1>
        </div>
        <Button variant="ghost" aria-label={ru.miniApp.search.filters}>
          <SlidersHorizontal className="h-5 w-5" />
        </Button>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -80, rotate: -4 }}
        >
          <ProfileCard profile={current} />
        </motion.div>
      </AnimatePresence>
      <div className="swipe-actions">
        <Button variant="ghost" aria-label={ru.miniApp.search.rewind}>
          <RotateCcw />
        </Button>
        <Button
          variant="secondary"
          aria-label={ru.miniApp.search.skip}
          onClick={() => swipe.mutate({ action: 'skip', profile: current })}
        >
          <X />
        </Button>
        <Button
          className="like-button"
          aria-label={ru.miniApp.search.like}
          onClick={() => swipe.mutate({ action: 'like', profile: current })}
        >
          <Heart />
        </Button>
        <Button
          variant="secondary"
          aria-label={ru.miniApp.search.superLike}
          onClick={() => swipe.mutate({ action: 'super_like', profile: current })}
        >
          <Star />
        </Button>
      </div>
      <div className="mt-3 flex justify-center gap-6 text-xs text-muted">
        <button className="inline-flex gap-1">
          <Ban className="h-3.5 w-3.5" /> {ru.miniApp.search.block}
        </button>
        <button className="inline-flex gap-1">
          <Flag className="h-3.5 w-3.5" /> {ru.miniApp.search.report}
        </button>
      </div>
    </div>
  );
}
