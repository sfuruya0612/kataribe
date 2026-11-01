import type {
  MeetingSearchHit,
  MeetingSearchKind,
  MeetingSearchResult,
} from '../../shared/types';
import { useI18n, type I18nValue } from './i18n';
import { formatMeetingDate } from './recording-utils';

type SearchResultsProps = {
  query: string;
  result: MeetingSearchResult | null;
  loading: boolean;
  onSelect: (hit: MeetingSearchHit) => void;
};

function highlight(text: string, query: string, locale: 'ja' | 'en') {
  const needle = query.trim();
  if (!needle) {
    return text;
  }
  const lowerText = text.toLocaleLowerCase(locale === 'en' ? 'en-US' : 'ja-JP');
  const lowerNeedle = needle.toLocaleLowerCase(locale === 'en' ? 'en-US' : 'ja-JP');
  const index = lowerText.indexOf(lowerNeedle);
  if (index < 0) {
    return text;
  }
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  );
}

function searchKindLabel(
  kind: MeetingSearchKind,
  t: I18nValue['t'],
): string {
  switch (kind) {
    case 'title':
      return t('タイトル');
    case 'transcript':
      return t('文字起こし');
    case 'translation-ja':
      return t('文字起こし（日本語訳）');
    case 'translation-en':
      return t('文字起こし（English 訳）');
    case 'summary':
      return t('要約');
  }
}

export function SearchResults({
  query,
  result,
  loading,
  onSelect,
}: SearchResultsProps) {
  const { locale, t, tc } = useI18n();
  const hits = result?.hits ?? [];
  return (
    <section className="search-panel" aria-labelledby="search-title">
      <div className="table-toolbar">
        <div>
          <p className="section-label">{t('検索')}</p>
          <h1 id="search-title" className="table-title">
            {t('検索結果')}
          </h1>
          <p className="muted search-summary">
            {loading
              ? t('「{query}」を検索しています...', { query: query.trim() })
              : `${t('「{query}」', { query: query.trim() })} · ${tc(
                  hits.length,
                  '1 件',
                  '{count} 件',
                )}`}
            {result?.truncated ? t('（上限に達しました）') : ''}
          </p>
        </div>
      </div>
      {loading ? (
        <div className="meeting-empty">{t('検索しています。')}</div>
      ) : hits.length === 0 ? (
        <div className="meeting-empty">
          <h2>{t('一致する会議はありませんでした')}</h2>
          <p>
            {t(
              '文字起こし、翻訳、要約、タイトルから検索します。2 文字以上で入力してください。',
            )}
          </p>
        </div>
      ) : (
        <div className="search-list">
          {hits.map((hit, index) => (
            <button
              type="button"
              className="search-hit"
              key={`${hit.meetingId}-${hit.kind}-${hit.lineNumber ?? 0}-${index}`}
              onClick={() => onSelect(hit)}
            >
              <span className="search-hit-head">
                <span className="search-hit-title">{hit.title}</span>
                <span className="search-hit-date">
                  {formatMeetingDate(hit.startedAt, locale)}
                </span>
                <span className="search-kind">{searchKindLabel(hit.kind, t)}</span>
                {hit.timestamp ? (
                  <span className="search-hit-time mono">{hit.timestamp}</span>
                ) : null}
              </span>
              <span className="search-hit-text">{highlight(hit.text, query, locale)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
