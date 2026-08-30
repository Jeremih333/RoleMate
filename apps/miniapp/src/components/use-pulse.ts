import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type Pulse } from '../api.js';

/**
 * Keeps the screen current without polling every list on it.
 *
 * Nothing refreshed on its own: a notification arrived only after walking to
 * another tab and back, and a feed sat still while posts appeared. Polling each
 * list would have cost several requests a minute from every open app, and the
 * whole product runs inside a hundred thousand requests a day.
 *
 * So one small request asks whether anything moved, and only the list whose
 * counter changed is refetched. It runs while the app is in front and somebody
 * is using it; after a few minutes of stillness it slows to a check every two
 * minutes, and while the app is hidden it stops entirely.
 */
const ACTIVE_INTERVAL = 30_000;
const IDLE_INTERVAL = 120_000;
const IDLE_AFTER = 180_000;

export function usePulse(): void {
  const queryClient = useQueryClient();
  const previous = useRef<Pulse | null>(null);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    const noteActivity = () => {
      lastActivity.current = Date.now();
    };
    for (const event of ['pointerdown', 'keydown', 'scroll'] as const) {
      window.addEventListener(event, noteActivity, { passive: true });
    }
    return () => {
      for (const event of ['pointerdown', 'keydown', 'scroll'] as const) {
        window.removeEventListener(event, noteActivity);
      }
    };
  }, []);

  useEffect(() => {
    let timer = 0;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      const idle = Date.now() - lastActivity.current > IDLE_AFTER;
      timer = window.setTimeout(() => void run(), idle ? IDLE_INTERVAL : ACTIVE_INTERVAL);
    };

    const run = async () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') {
        schedule();
        return;
      }
      try {
        const pulse = await api.pulse();
        const before = previous.current;
        previous.current = pulse;
        if (before) {
          const changed = (key: keyof Pulse) => before[key] !== pulse[key];
          if (changed('unread_notifications') || changed('last_notification_at')) {
            void queryClient.invalidateQueries({ queryKey: ['notifications'] });
          }
          if (changed('unread_messages') || changed('last_message_at')) {
            void queryClient.invalidateQueries({ queryKey: ['conversations'] });
            void queryClient.invalidateQueries({ queryKey: ['conversation-messages'] });
          }
          if (changed('incoming_likes')) {
            void queryClient.invalidateQueries({ queryKey: ['incoming-likes'] });
            void queryClient.invalidateQueries({ queryKey: ['profile-stats'] });
          }
          if (changed('last_post_at')) {
            void queryClient.invalidateQueries({ queryKey: ['posts'] });
            void queryClient.invalidateQueries({ queryKey: ['feed'] });
          }
        }
      } catch {
        // A missed beat is not worth telling anyone about; the next one tries.
      }
      schedule();
    };

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      // Coming back to the app is the moment freshness matters most.
      lastActivity.current = Date.now();
      window.clearTimeout(timer);
      void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [queryClient]);
}
