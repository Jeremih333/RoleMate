import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Crown,
  Database,
  Heart,
  MessageCircle,
  Shield,
  Users,
} from 'lucide-react';
import { Redirect } from 'wouter';
import { api } from '../api.js';
import { Card, SectionTitle, Skeleton } from '../components/ui.js';
import { useUserStore } from '../store.js';

export function AdminPage() {
  const isAdmin = useUserStore((state) => state.user?.isAdmin);
  const stats = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: api.adminDashboard,
    enabled: isAdmin === true,
  });
  if (!isAdmin) return <Redirect to="/" replace />;
  if (stats.isLoading) return <Skeleton className="h-96" />;
  const data = stats.data;
  const items = [
    ['Пользователи', data?.users, Users],
    ['Активные анкеты', data?.profiles, Activity],
    ['Мэтчи', data?.matches, Heart],
    ['Активные чаты', data?.conversations, MessageCircle],
    ['Открытые жалобы', data?.openReports, AlertTriangle],
    ['Premium', data?.premiumUsers, Crown],
    ['Stars payments', data?.starsPayments, Database],
  ] as const;
  return (
    <div>
      <SectionTitle eyebrow="доступ владельца">Управление RoleMate</SectionTitle>
      <div className="admin-banner">
        <Shield />
        <div>
          <strong>Защищённая панель</strong>
          <p>Каждое действие проверяется backend и записывается в audit log.</p>
        </div>
      </div>
      <div className="admin-grid mt-5">
        {items.map(([label, value, Icon]) => (
          <Card key={label} className="admin-stat">
            <Icon />
            <strong>{value ?? 0}</strong>
            <small>{label}</small>
          </Card>
        ))}
      </div>
      <SectionTitle eyebrow="рабочие очереди">Разделы</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          'Пользователи',
          'Анкеты и модерация',
          'Жалобы',
          'Premium и возвраты',
          'Рефералы',
          'Рассылки',
          'Feature flags',
          'Система и jobs',
        ].map((item) => (
          <Card key={item} className="p-5 font-semibold">
            {item}
          </Card>
        ))}
      </div>
    </div>
  );
}
