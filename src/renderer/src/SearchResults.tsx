import type { MeetingSearchHit, MeetingSearchResult } from '../../shared/types';
import { formatMeetingDate } from './recording-utils';

type SearchResultsProps = {
  query: string;
  result: MeetingSearchResult | null;
  loading: boolean;
  onSelect: (hit: MeetingSearchHit) => void;
};

function highlight(text: string, query: string) {
  const needle = query.trim();
  if (!needle) {
    return text;
  }
  const lowerText = text.toLocaleLowerCase('ja-JP');
  const lowerNeedle = needle.toLocaleLowerCase('ja-JP');
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

export function SearchResults({
  query,
  result,
  loading,
  onSelect,
}: SearchResultsProps) {
  const hits = result?.hits ?? [];
  return (
    <section className="search-panel" aria-labelledby="search-title">
      <div className="table-toolbar">
        <div>
          <p className="section-label">Search</p>
          <h1 id="search-title" className="table-title">
            検索結果
          </h1>
          <p className="muted search-summary">
            {query.trim() ? `「${query.trim()}」` : ''}
            {loading ? ' を検索しています...' : ` · ${hits.length} 件`}
            {result?.truncated ? '（上限に達しました）' : ''}
          </p>
        </div>
      </div>
      {loading ? (
        <div className="meeting-empty">検索しています。</div>
      ) : hits.length === 0 ? (
        <div className="meeting-empty">
          <h2>一致する会議はありませんでした</h2>
          <p>文字起こし、翻訳、要約、タイトルから検索します。2 文字以上で入力してください。</p>
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
                  {formatMeetingDate(hit.startedAt)}
                </span>
                <span className="search-kind">{hit.kindLabel}</span>
                {hit.timestamp ? (
                  <span className="search-hit-time mono">{hit.timestamp}</span>
                ) : null}
              </span>
              <span className="search-hit-text">{highlight(hit.text, query)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
