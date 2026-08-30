import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Link2, Share2, Sparkles, X } from 'lucide-react';
import { ru } from '@rolemate/shared';
import { api, type GiftDetail, type GiftListing, type GiftShelf } from '../api.js';
import { Button, Card, EmptyState, useTextPrompt } from '../components/ui.js';
import { GiftCard, type GiftAppearance } from '../components/gift-card.js';
import { getTelegram } from '../telegram.js';

/** Appearance arrives as JSON on the row; a broken one simply draws plainly. */
function appearanceOf(row: {
  model_appearance?: string | null;
  pattern_appearance?: string | null;
  backdrop_appearance?: string | null;
}): GiftAppearance {
  const parse = (value: string | null | undefined) => {
    if (!value) return null;
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return null;
    }
  };
  return {
    model: parse(row.model_appearance),
    pattern: parse(row.pattern_appearance),
    backdrop: parse(row.backdrop_appearance),
  };
}

const RANKS = ['white', 'black', 'moon', 'blue', 'red', 'bell', 'plain'] as const;

/**
 * The gift market.
 *
 * Telegram's own is the shape being followed: a grid of cards, filters down the
 * side of it, and a card that opens into the collectible's own page with its
 * model, pattern, backdrop and the size of the issue. The animation belongs to
 * the opened gift, not to the grid — a page of moving cards is what a modest
 * phone cannot carry, and the whole product lives inside a free plan.
 */
export function GiftsPage() {
  const queryClient = useQueryClient();
  const { ask, dialog: promptDialog } = useTextPrompt();
  const [tab, setTab] = useState<'market' | 'mine' | 'offers'>('market');
  const [rank, setRank] = useState<string>('');
  const [sort, setSort] = useState('recent');
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const balance = useQuery({
    queryKey: ['star-balance'],
    queryFn: api.starBalance,
    staleTime: 30_000,
  });
  const topUp = useMutation({
    mutationFn: (stars: number) => api.topUpStars(stars),
    onSuccess: (result) => {
      // Telegram opens the invoice; the balance follows when it reports back.
      if (result.invoiceLink) getTelegram()?.openInvoice(result.invoiceLink);
    },
  });
  const withdraw = useMutation({
    mutationFn: (stars: number) => api.withdrawStars(stars),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['star-balance'] }),
  });

  const market = useQuery({
    queryKey: ['gift-market', rank, sort],
    queryFn: () =>
      api.giftMarket({
        ...(rank ? { rank } : {}),
        sort,
        limit: 30,
        offset: 0,
      }),
    enabled: tab === 'market',
    staleTime: 60_000,
  });
  const mine = useQuery({
    queryKey: ['gift-mine'],
    queryFn: api.myGifts,
    enabled: tab === 'mine',
    staleTime: 60_000,
  });
  const offers = useQuery({
    queryKey: ['gift-offers'],
    queryFn: api.giftOffers,
    enabled: tab === 'offers',
    staleTime: 60_000,
  });
  const [shelf, setShelf] = useState<string>('');
  const createShelf = useMutation({
    mutationFn: (title: string) => api.createGiftShelf(title),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['gift-mine'] }),
  });
  const removeShelf = useMutation({
    mutationFn: (shelfId: string) => api.removeGiftShelf(shelfId),
    onSuccess: () => {
      setShelf('');
      void queryClient.invalidateQueries({ queryKey: ['gift-mine'] });
    },
  });
  const answer = useMutation({
    mutationFn: ({ offerId, action }: { offerId: string; action: 'accepted' | 'declined' }) =>
      api.answerGiftOffer(offerId, action),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gift-offers'] });
      void queryClient.invalidateQueries({ queryKey: ['gift-mine'] });
    },
  });

  return (
    <section className="page-stack">
      <header className="page-header">
        <p className="eyebrow">{ru.miniApp.gifts.title}</p>
        <h1>{ru.miniApp.gifts.marketplaceTitle}</h1>
      </header>

      {/* Everything here is bought and sold in stars, so the balance is the
          first thing the market says. */}
      <Card className="star-balance">
        <div>
          <strong>{ru.miniApp.gifts.stars(balance.data?.balance ?? 0)}</strong>
          <small>{ru.miniApp.gifts.balance}</small>
        </div>
        <div className="star-balance-actions">
          <Button
            variant="secondary"
            loading={topUp.isPending}
            onClick={() =>
              ask(ru.miniApp.gifts.topUpPrompt, (value) => {
                const stars = Number.parseInt(value, 10);
                if (Number.isFinite(stars) && stars > 0) topUp.mutate(stars);
              })
            }
          >
            {ru.miniApp.gifts.topUp}
          </Button>
          {balance.data?.refundable ? (
            <Button
              variant="secondary"
              loading={withdraw.isPending}
              onClick={() =>
                ask(ru.miniApp.gifts.withdrawPrompt, (value) => {
                  const stars = Number.parseInt(value, 10);
                  if (Number.isFinite(stars) && stars > 0) withdraw.mutate(stars);
                })
              }
            >
              {ru.miniApp.gifts.withdraw}
            </Button>
          ) : null}
        </div>
      </Card>
      {balance.data?.refundable ? (
        <p className="text-xs text-muted">{ru.miniApp.gifts.withdrawHint}</p>
      ) : null}
      {withdraw.isError ? <div className="error-box">{withdraw.error.message}</div> : null}

      <div className="gift-tabs" role="tablist">
        {(
          [
            ['market', ru.miniApp.gifts.tabMarket],
            ['mine', ru.miniApp.gifts.tabMine],
            ['offers', ru.miniApp.gifts.tabOffers],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'is-active' : ''}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'market' ? (
        <>
          <div className="gift-filters">
            <div className="gift-filter-row">
              <button
                type="button"
                className={rank === '' ? 'is-active' : ''}
                onClick={() => setRank('')}
              >
                {ru.miniApp.gifts.rankAll}
              </button>
              {RANKS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={rank === value ? 'is-active' : ''}
                  onClick={() => setRank(value)}
                >
                  {ru.miniApp.gifts.rankNames[value] ?? value}
                </button>
              ))}
            </div>
            <select
              className="input"
              value={sort}
              aria-label={ru.miniApp.gifts.sortRecent}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="recent">{ru.miniApp.gifts.sortRecent}</option>
              <option value="price_asc">{ru.miniApp.gifts.sortPriceAsc}</option>
              <option value="price_desc">{ru.miniApp.gifts.sortPriceDesc}</option>
              <option value="serial">{ru.miniApp.gifts.sortSerial}</option>
            </select>
          </div>
          {market.data?.length ? (
            <div className="gift-grid">
              {market.data.map((listing: GiftListing) => (
                <button
                  key={listing.listing_id}
                  type="button"
                  className="gift-grid-cell"
                  onClick={() => setOpenItemId(listing.item_id)}
                >
                  <GiftCard
                    appearance={appearanceOf(listing)}
                    rank={listing.rank}
                    seriesCode={listing.series_code}
                    size={104}
                  />
                  <strong>{listing.series_title}</strong>
                  <small>#{listing.serial.toLocaleString('ru-RU')}</small>
                  <span className="gift-price">{ru.miniApp.gifts.stars(listing.star_price)}</span>
                </button>
              ))}
            </div>
          ) : market.isLoading ? null : (
            <EmptyState
              icon={<Gift aria-hidden />}
              title={ru.miniApp.gifts.marketplaceTitle}
              description={ru.miniApp.gifts.marketEmpty}
            />
          )}
        </>
      ) : null}

      {tab === 'mine' && mine.data?.items.length ? (
        // The shelves somebody arranges their own gifts on, named by them, the
        // way Telegram lets an owner group what they have.
        <div className="gift-shelves">
          <div className="gift-filter-row">
            <button
              type="button"
              className={shelf === '' ? 'is-active' : ''}
              onClick={() => setShelf('')}
            >
              {ru.miniApp.gifts.allGifts}
            </button>
            {(mine.data.shelves ?? []).map((row) => (
              <button
                key={row.id}
                type="button"
                className={shelf === row.id ? 'is-active' : ''}
                onClick={() => setShelf(row.id)}
              >
                {row.title}
              </button>
            ))}
            <button
              type="button"
              onClick={() =>
                ask(ru.miniApp.gifts.newShelfPrompt, (title) => {
                  if (title.trim()) createShelf.mutate(title.trim());
                })
              }
            >
              + {ru.miniApp.gifts.newShelf}
            </button>
          </div>
          {shelf ? (
            <button
              type="button"
              className="gift-shelf-remove"
              onClick={() => removeShelf.mutate(shelf)}
            >
              {ru.miniApp.gifts.removeShelf}
            </button>
          ) : null}
        </div>
      ) : null}

      {tab === 'mine' ? (
        mine.data?.items.length ? (
          <div className="gift-grid">
            {mine.data.items
              .filter((item) => !shelf || item.user_collection_id === shelf)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="gift-grid-cell"
                  onClick={() => setOpenItemId(item.id)}
                >
                  <GiftCard
                    appearance={appearanceOf(item)}
                    rank={item.rank}
                    seriesCode={item.series_code}
                    size={104}
                  />
                  <strong>{item.series_title}</strong>
                  <small>#{item.serial.toLocaleString('ru-RU')}</small>
                  {item.listed_price ? (
                    <span className="gift-price">{ru.miniApp.gifts.stars(item.listed_price)}</span>
                  ) : null}
                </button>
              ))}
          </div>
        ) : mine.isLoading ? null : (
          <EmptyState
            icon={<Gift aria-hidden />}
            title={ru.miniApp.gifts.tabMine}
            description={ru.miniApp.gifts.mineEmpty}
          />
        )
      ) : null}

      {tab === 'offers' ? (
        offers.data?.length ? (
          <div className="grid gap-2">
            {offers.data.map((offer) => (
              <Card key={offer.id} className="gift-offer">
                <div>
                  <strong>
                    {offer.series_title} #{offer.serial.toLocaleString('ru-RU')}
                  </strong>
                  <small>
                    {offer.from_name ?? ''} · {ru.miniApp.gifts.stars(offer.star_amount)}
                  </small>
                  {offer.message ? <p>{offer.message}</p> : null}
                </div>
                {offer.status === 'pending' ? (
                  <div className="gift-offer-actions">
                    <Button
                      loading={answer.isPending}
                      onClick={() => answer.mutate({ offerId: offer.id, action: 'accepted' })}
                    >
                      {ru.miniApp.gifts.accept}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => answer.mutate({ offerId: offer.id, action: 'declined' })}
                    >
                      {ru.miniApp.gifts.decline}
                    </Button>
                  </div>
                ) : (
                  <small>{offer.status}</small>
                )}
              </Card>
            ))}
          </div>
        ) : offers.isLoading ? null : (
          <EmptyState
            icon={<Sparkles aria-hidden />}
            title={ru.miniApp.gifts.tabOffers}
            description={ru.miniApp.gifts.offersEmpty}
          />
        )
      ) : null}

      {openItemId ? (
        <GiftSheet
          itemId={openItemId}
          shelves={mine.data?.shelves ?? []}
          onClose={() => setOpenItemId(null)}
          ask={ask}
        />
      ) : null}
      {promptDialog}
    </section>
  );
}

/**
 * One collectible, opened. This is where the animation lives, and where the
 * table of attributes says exactly what this copy is: its model, its pattern,
 * its backdrop, each with how rare that is, and how large the issue was.
 */
function GiftSheet({
  itemId,
  shelves,
  onClose,
  ask,
}: {
  itemId: string;
  shelves: GiftShelf[];
  onClose: () => void;
  ask: (title: string, onSubmit: (value: string) => void) => void;
}) {
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const gift = useQuery({
    queryKey: ['gift', itemId],
    queryFn: () => api.gift(itemId),
    staleTime: 60_000,
  });
  const offer = useMutation({
    mutationFn: (starAmount: number) => api.giftOffer(itemId, starAmount),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['gift-offers'] }),
  });
  const listing = useMutation({
    mutationFn: (starPrice: number | null) => api.giftListing(itemId, starPrice),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gift', itemId] });
      void queryClient.invalidateQueries({ queryKey: ['gift-mine'] });
      void queryClient.invalidateQueries({ queryKey: ['gift-market'] });
    },
  });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 5 * 60_000 });
  const buy = useMutation({
    mutationFn: () => api.buyGift(itemId),
    onSuccess: () => {
      // The stars move between two balances, so everything is current at once.
      void queryClient.invalidateQueries({ queryKey: ['star-balance'] });
      void queryClient.invalidateQueries({ queryKey: ['gift', itemId] });
      void queryClient.invalidateQueries({ queryKey: ['gift-market'] });
      void queryClient.invalidateQueries({ queryKey: ['gift-mine'] });
    },
  });
  const moveToShelf = useMutation({
    mutationFn: (shelfId: string | null) => api.giftArrangement(itemId, { shelfId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gift', itemId] });
      void queryClient.invalidateQueries({ queryKey: ['gift-mine'] });
    },
  });
  const pin = useMutation({
    mutationFn: (pinnedOrder: number | null) => api.giftArrangement(itemId, { pinnedOrder }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gift', itemId] });
      void queryClient.invalidateQueries({ queryKey: ['gift-showcase'] });
    },
  });

  const item: GiftDetail | undefined = gift.data;
  const rarity = (value: number | null | undefined) =>
    value === null || value === undefined ? '' : `${(value / 10).toFixed(1)}%`;

  return (
    <div className="editor-sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="editor-sheet gift-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={item?.series_title ?? ru.miniApp.gifts.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="editor-sheet-header">
          <strong>{item?.series_title ?? ru.miniApp.gifts.title}</strong>
          <span className="gift-sheet-header-actions">
            <button
              type="button"
              aria-label={ru.miniApp.gifts.share}
              onClick={() => setMenuOpen((value) => !value)}
            >
              <Share2 aria-hidden />
            </button>
            <button type="button" aria-label={ru.miniApp.dialogs.cancel} onClick={onClose}>
              <X aria-hidden />
            </button>
          </span>
        </header>
        {menuOpen && item ? (
          <div className="gift-sheet-menu" role="menu">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(
                  `${window.location.origin}/gifts?item=${item.id}`,
                );
                setMenuOpen(false);
              }}
            >
              <Link2 aria-hidden /> {ru.miniApp.gifts.copyLink}
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                ask(ru.miniApp.gifts.proposeTradePrompt, (value) => {
                  const amount = Number.parseInt(value, 10);
                  if (Number.isFinite(amount) && amount >= 0) offer.mutate(amount);
                });
              }}
            >
              <Sparkles aria-hidden /> {ru.miniApp.gifts.proposeTrade}
            </button>
          </div>
        ) : null}
        <div className="editor-sheet-body">
          {item ? (
            <>
              <div className="gift-sheet-hero">
                <GiftCard
                  appearance={appearanceOf(item)}
                  rank={item.rank}
                  seriesCode={item.series_code}
                  size={196}
                  playing
                  label={item.series_title}
                />
                <h2>
                  {item.series_title} <span>#{item.serial.toLocaleString('ru-RU')}</span>
                </h2>
                {item.subtitle ? <p className="text-muted">{item.subtitle}</p> : null}
              </div>
              {item.lore ? <p className="gift-sheet-lore">{item.lore}</p> : null}
              {shelves.length ? (
                <label className="gift-shelf-picker">
                  <span>{ru.miniApp.gifts.moveToShelf}</span>
                  <select
                    className="input"
                    value={item.user_collection_id ?? ''}
                    onChange={(event) => moveToShelf.mutate(event.target.value || null)}
                  >
                    <option value="">{ru.miniApp.gifts.allGifts}</option>
                    {shelves.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <table className="gift-attributes">
                <tbody>
                  <tr>
                    <th>{ru.miniApp.gifts.owner}</th>
                    <td>{item.owner_name ?? '—'}</td>
                  </tr>
                  <tr>
                    <th>{ru.miniApp.gifts.model}</th>
                    <td>
                      {item.model_title ?? '—'} <i>{rarity(item.model_rarity)}</i>
                    </td>
                  </tr>
                  <tr>
                    <th>{ru.miniApp.gifts.pattern}</th>
                    <td>
                      {item.pattern_title ?? '—'} <i>{rarity(item.pattern_rarity)}</i>
                    </td>
                  </tr>
                  <tr>
                    <th>{ru.miniApp.gifts.backdrop}</th>
                    <td>
                      {item.backdrop_title ?? '—'} <i>{rarity(item.backdrop_rarity)}</i>
                    </td>
                  </tr>
                  <tr>
                    <th>{ru.miniApp.gifts.quantity}</th>
                    <td>{ru.miniApp.gifts.issued(item.issued, item.total_supply)}</td>
                  </tr>
                  <tr>
                    <th>{ru.miniApp.gifts.value}</th>
                    <td>{ru.miniApp.gifts.stars(item.listed_price ?? item.star_price)}</td>
                  </tr>
                </tbody>
              </table>
            </>
          ) : null}
        </div>
        <footer className="editor-sheet-footer">
          {item && item.owner_user_id !== me.data?.userId && item.listed_price ? (
            <Button loading={buy.isPending} onClick={() => buy.mutate()}>
              {ru.miniApp.gifts.buy} · {ru.miniApp.gifts.stars(item.listed_price)}
            </Button>
          ) : null}
          {buy.isError ? <div className="error-box">{buy.error.message}</div> : null}
          {item?.owner_user_id === me.data?.userId && item?.listed_price ? (
            <Button
              variant="secondary"
              loading={listing.isPending}
              onClick={() => listing.mutate(null)}
            >
              {ru.miniApp.gifts.unlist}
            </Button>
          ) : item?.owner_user_id === me.data?.userId ? (
            <Button
              variant="secondary"
              loading={listing.isPending}
              onClick={() =>
                ask(ru.miniApp.gifts.sellPrompt, (value) => {
                  const price = Number.parseInt(value, 10);
                  if (Number.isFinite(price) && price > 0) listing.mutate(price);
                })
              }
            >
              {ru.miniApp.gifts.sell}
            </Button>
          ) : null}
          {item && item.owner_user_id === me.data?.userId ? (
            <Button
              variant="secondary"
              loading={pin.isPending}
              onClick={() => pin.mutate(item.pinned_order === null ? 0 : null)}
            >
              {item.pinned_order === null ? ru.miniApp.gifts.pin : ru.miniApp.gifts.unpin}
            </Button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

/** The way into the market from the home screen. */
export function GiftsHomeCard() {
  return (
    <div className="gift-home-card">
      <Gift aria-hidden />
      <div>
        <strong>{ru.miniApp.gifts.marketplaceTitle}</strong>
        <small>{ru.miniApp.gifts.homeDescription}</small>
      </div>
    </div>
  );
}
