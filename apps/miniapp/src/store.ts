import { create } from 'zustand';

interface UserState {
  user:
    | {
        id: string;
        telegramUserId: number;
        role: string;
        isAdmin?: boolean;
      }
    | undefined;
  setUser: (user: NonNullable<UserState['user']>) => void;
}

export const useUserStore = create<UserState>((set) => ({
  user: undefined,
  setUser: (user) => set({ user }),
}));
