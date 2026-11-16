import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type {
  ChatContextInfo,
  ChatHistory,
  ChatMessage,
  LlmProfilesState,
} from '../../shared/types';
import { useI18n, type I18nValue } from './i18n';
import { errorText, formatDateTime } from './recording-utils';

type MeetingChatProps = {
  meetingId: string;
  hasSummary: boolean;
  hasTranscript: boolean;
  llmProfiles: LlmProfilesState | null;
  defaultWebSearch: boolean;
  contextVersion: string;
  onOpenSettings: () => void;
};

function selectProfileId(
  state: LlmProfilesState | null,
  current: string,
  preferred: string | null,
): string {
  if (!state) {
    return current || preferred || '';
  }
  const candidate = current || preferred || state.defaultProfileId;
  if (candidate && state.profiles.some((profile) => profile.id === candidate)) {
    return candidate;
  }
  return state.defaultProfileId || state.profiles[0]?.id || '';
}

function sourceHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function contextStateLabel(
  context: ChatContextInfo | null,
  t: I18nValue['t'],
): string {
  switch (context?.transcriptState) {
    case 'ready':
      return t('文字起こし: 相槌と擬音を除去済み');
    case 'partial':
      return t('文字起こし: 一部の区間で相槌と擬音を除去できていません');
    case 'stale':
      return t('文字起こし: 除去済みの内容が現在の文字起こしと一致しません');
    case 'missing':
    default:
      return t('文字起こし: 相槌と擬音を除去していません');
  }
}

export function MeetingChat({
  meetingId,
  hasSummary,
  hasTranscript,
  llmProfiles,
  defaultWebSearch,
  contextVersion,
  onOpenSettings,
}: MeetingChatProps) {
  const { locale, t } = useI18n();
  const [history, setHistory] = useState<ChatHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [profileId, setProfileId] = useState('');
  const [webSearch, setWebSearch] = useState(defaultWebSearch);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmPrepare, setConfirmPrepare] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const profilesRef = useRef<LlmProfilesState | null>(llmProfiles);
  profilesRef.current = llmProfiles;

  const profiles = llmProfiles?.profiles ?? [];
  const selectedProfile =
    profiles.find((profile) => profile.id === profileId) ?? null;
  const context = history?.context ?? null;
  const busy = sending || preparing;
  const canSend =
    Boolean(history) &&
    Boolean(selectedProfile) &&
    !busy &&
    !loading &&
    draft.trim().length > 0;

  useEffect(() => {
    setProfileId((current) =>
      selectProfileId(profilesRef.current, current, null),
    );
  }, [llmProfiles]);

  useEffect(() => {
    setWebSearch(defaultWebSearch);
  }, [defaultWebSearch, meetingId]);

  const loadHistory = useCallback(async () => {
    if (!hasSummary) {
      setHistory(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const value = await window.kataribe.getChatHistory(meetingId);
      setHistory(value);
      setProfileId((current) =>
        selectProfileId(
          profilesRef.current,
          value.lastProfileId || current,
          null,
        ),
      );
    } catch (reason: unknown) {
      setLoadError(
        t('チャット履歴を読み込めませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [hasSummary, meetingId, t]);

  useEffect(() => {
    void loadHistory();
  }, [contextVersion, loadHistory]);

  useEffect(() => {
    const node = listRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [history?.messages.length, pendingMessage, preparing, sending]);

  const openSource = (event: ReactMouseEvent, url: string) => {
    event.preventDefault();
    void window.kataribe.openExternal(url).catch((reason: unknown) => {
      setError(errorText(reason));
    });
  };

  const send = async () => {
    if (!canSend) {
      return;
    }
    const message = draft.trim();
    setSending(true);
    setError(null);
    setNotice(null);
    setPendingMessage(message);
    try {
      const result = await window.kataribe.sendChatMessage({
        meetingId,
        message,
        profileId: profileId || null,
        webSearch,
      });
      setHistory(result.history);
      setProfileId(result.history.lastProfileId ?? profileId);
      setDraft('');
      setNotice(result.searchError);
    } catch (reason: unknown) {
      const message = errorText(reason);
      if (message === t('チャットをキャンセルしました。')) {
        setNotice(message);
      } else {
        setError(message);
      }
    } finally {
      setSending(false);
      setPendingMessage(null);
    }
  };

  const cancel = async () => {
    try {
      await window.kataribe.cancelChat(meetingId);
    } catch (reason: unknown) {
      setError(errorText(reason));
    }
  };

  const prepare = async () => {
    setConfirmPrepare(false);
    setPreparing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.kataribe.prepareChatContext(
        meetingId,
        profileId || undefined,
      );
      setHistory(result);
      setNotice(result.warning);
    } catch (reason: unknown) {
      const message = errorText(reason);
      if (message === t('相槌と擬音の除去をキャンセルしました。')) {
        setNotice(message);
      } else {
        setError(message);
      }
    } finally {
      setPreparing(false);
    }
  };

  const clear = async () => {
    setConfirmClear(false);
    setError(null);
    try {
      const result = await window.kataribe.clearChatHistory(meetingId);
      setHistory(result);
      setNotice(t('チャット履歴を消去しました。'));
    } catch (reason: unknown) {
      setError(errorText(reason));
    }
  };

  if (!hasSummary) {
    return (
      <div className="chat-pane">
        <div className="chat-empty">
          <h2>{t('会議チャット')}</h2>
          <p>
            {t(
              '要約を生成すると、要約と文字起こしをもとに会議の内容について質問できます。',
            )}
          </p>
          {profiles.length === 0 ? (
            <button type="button" className="link-button" onClick={onOpenSettings}>
              {t('LLM の設定を開く')}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!hasTranscript) {
    return (
      <div className="chat-pane">
        <div className="chat-empty">
          <h2>{t('会議チャット')}</h2>
          <p>{t('文字起こしがありません。先に文字起こしを完了してください。')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-pane" aria-labelledby="chat-title">
      <div className="chat-head">
        <div>
          <h2 id="chat-title">{t('会議チャット')}</h2>
          <p className="muted">
            {t('要約と文字起こしをもとに、会議の内容について質問できます。')}
          </p>
        </div>
        <div className="chat-head-actions">
          <select
            className="setting-input"
            aria-label={t('チャットに使う LLM プロファイル')}
            value={profileId}
            disabled={busy || profiles.length === 0}
            onChange={(event) => setProfileId(event.target.value)}
          >
            {profiles.length > 0 ? (
              profiles.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.id}
                  {profile.isDefault ? t('（既定）') : ''}
                </option>
              ))
            ) : (
              <option value="">{t('プロファイル未設定')}</option>
            )}
          </select>
          <button
            type="button"
            className="link-button"
            disabled={busy || (history?.messages.length ?? 0) === 0}
            onClick={() => setConfirmClear(true)}
          >
            {t('履歴を消去')}
          </button>
        </div>
      </div>

      {profiles.length === 0 ? (
        <div className="chat-alert">
          <p className="alert alert-warning">
            {t(
              'LLM プロファイルが設定されていません。設定画面でプロファイルを追加してください。',
            )}
          </p>
          <button type="button" className="link-button" onClick={onOpenSettings}>
            {t('LLM の設定を開く')}
          </button>
        </div>
      ) : null}

      {context ? (
        <div className={`chat-context chat-context-${context.transcriptState}`}>
          <div className="chat-context-text">
            <strong>{contextStateLabel(context, t)}</strong>
            <span className="muted">
              {t(
                '送信するコンテキスト: 要約 {summaryChars} 文字 + 文字起こし {transcriptChars} 文字（約 {tokens} トークン）',
                {
                  summaryChars: context.summaryChars,
                  transcriptChars: context.usedTranscriptChars,
                  tokens: context.estimatedTokens,
                },
              )}
            </span>
            {context.excerpted ? (
              <span className="muted">
                {t(
                  '文字起こしが長いため、質問に関連する箇所を抜粋して送ります。',
                )}
              </span>
            ) : null}
          </div>
          {profiles.length > 0 &&
          (context.transcriptState === 'missing' ||
            context.transcriptState === 'stale') ? (
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={() => setConfirmPrepare(true)}
            >
              {t('相槌と擬音を除去する')}
            </button>
          ) : null}
        </div>
      ) : null}

      {history?.contextChanged ? (
        <p className="alert alert-warning" role="status">
          {t(
            '要約または文字起こしが更新されました。次の回答から新しい内容を使います。',
          )}
        </p>
      ) : null}
      {history?.warning ? (
        <p className="alert alert-warning" role="status">
          {history.warning}
        </p>
      ) : null}
      {loadError ? (
        <div className="chat-alert">
          <p className="alert alert-error">{loadError}</p>
          <button
            type="button"
            className="link-button"
            onClick={() => void loadHistory()}
          >
            {t('再読み込み')}
          </button>
        </div>
      ) : null}
      {error ? <p className="alert alert-error">{error}</p> : null}
      {notice ? <p className="notice-text">{notice}</p> : null}
      {preparing ? (
        <p className="notice-text" role="status">
          {t('相槌と擬音を除去しています...')}{' '}
          <button type="button" className="link-button" onClick={() => void cancel()}>
            {t('停止')}
          </button>
        </p>
      ) : null}

      <div className="chat-messages" ref={listRef} aria-live="polite">
        {loading && !history ? (
          <p className="muted">{t('チャット履歴を読み込んでいます。')}</p>
        ) : null}
        {!loading && !loadError && (history?.messages.length ?? 0) === 0 && !busy ? (
          <div className="chat-empty chat-empty-inline">
            <p>{t('会議の内容について質問できます。')}</p>
            <p className="muted">
              {t(
                '例: 決定事項の背景は？ 反対した人はいる？ 次回までの宿題は？',
              )}
            </p>
          </div>
        ) : null}
        {history?.messages.map((message) => (
          <ChatMessageView
            key={message.id}
            message={message}
            locale={locale}
            onOpenSource={openSource}
            t={t}
          />
        ))}
        {pendingMessage ? (
          <div className="chat-message chat-message-user chat-message-pending">
            <div className="chat-bubble">
              <p className="chat-content">{pendingMessage}</p>
            </div>
          </div>
        ) : null}
        {sending ? (
          <div className="chat-message chat-message-assistant">
            <div className="chat-bubble">
              <p className="chat-content muted">
                {t('回答を生成しています...')}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          className="setting-input chat-input"
          rows={3}
          value={draft}
          placeholder={t('会議について質問を入力')}
          aria-label={t('会議について質問を入力')}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              (event.metaKey || event.ctrlKey) &&
              canSend
            ) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="chat-actions">
          <label className="chat-web-search">
            <input
              type="checkbox"
              checked={webSearch}
              disabled={busy}
              onChange={(event) => setWebSearch(event.target.checked)}
            />
            <span>{t('Web 検索を使う')}</span>
          </label>
          <span className="muted chat-hint">
            {t('Cmd + Enter で送信')}
          </span>
          <span className="chat-action-spacer" />
          {sending ? (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void cancel()}
            >
              {t('停止')}
            </button>
          ) : null}
          <button type="submit" className="button" disabled={!canSend}>
            {sending ? t('送信中...') : t('送信')}
          </button>
        </div>
        <p className="muted chat-privacy">
          {t(
            '送信するのは要約と文字起こしです。Web 検索を有効にすると、検索語も検索エンジンに送信されます。',
          )}
        </p>
      </form>

      {confirmPrepare ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-prepare-title"
        >
          <div className="confirm-dialog">
            <div className="confirm-head">
              <div>
                <p className="section-label">{t('確認')}</p>
                <h2 id="chat-prepare-title">
                  {t('相槌と擬音を除去する')}
                </h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={t('閉じる')}
                disabled={preparing}
                onClick={() => setConfirmPrepare(false)}
              >
                ×
              </button>
            </div>
            <p>
              {t(
                '文字起こしを LLM に送って相槌と擬音を除去し、チャットのコンテキストに使います。',
              )}
            </p>
            <dl className="confirm-meta">
              <div>
                <dt>{t('プロファイル')}</dt>
                <dd>{selectedProfile?.id ?? t('プロファイル未設定')}</dd>
              </div>
              <div>
                <dt>{t('モデル')}</dt>
                <dd>{selectedProfile?.model ?? '-'}</dd>
              </div>
              <div>
                <dt>{t('エンドポイント')}</dt>
                <dd className="confirm-endpoint">
                  {selectedProfile?.endpoint || '-'}
                </dd>
              </div>
              <div>
                <dt>{t('文字起こしの文字数')}</dt>
                <dd>{context?.transcriptChars ?? 0}</dd>
              </div>
            </dl>
            <p className="muted">
              {t(
                '送信するのは文字起こしの本文だけです。音声ファイルは送信しません。',
              )}
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={preparing}
                onClick={() => setConfirmPrepare(false)}
              >
                {t('キャンセル')}
              </button>
              <button
                type="button"
                className="button"
                disabled={preparing}
                onClick={() => void prepare()}
              >
                {t('除去する')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmClear ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-clear-title"
        >
          <div className="confirm-dialog">
            <div className="confirm-head">
              <div>
                <p className="section-label">{t('確認')}</p>
                <h2 id="chat-clear-title">{t('チャット履歴を消去')}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={t('閉じる')}
                onClick={() => setConfirmClear(false)}
              >
                ×
              </button>
            </div>
            <p>
              {t(
                'この会議のチャット履歴を削除します。元に戻せません。要約と文字起こしは削除しません。',
              )}
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setConfirmClear(false)}
              >
                {t('キャンセル')}
              </button>
              <button type="button" className="button" onClick={() => void clear()}>
                {t('消去')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ChatMessageView({
  message,
  locale,
  onOpenSource,
  t,
}: {
  message: ChatMessage;
  locale: 'ja' | 'en';
  onOpenSource: (event: ReactMouseEvent, url: string) => void;
  t: I18nValue['t'];
}) {
  const isUser = message.role === 'user';
  return (
    <div
      className={`chat-message ${
        isUser ? 'chat-message-user' : 'chat-message-assistant'
      }`}
    >
      <div className="chat-bubble">
        <p className="chat-content">{message.content}</p>
        {!isUser && message.webSearch ? (
          <p className="chat-search-status muted">
            {message.searchError
              ? message.searchError
              : message.sources.length > 0
                ? t('Web 検索の結果を使いました。')
                : t('Web 検索結果はありませんでした。')}
          </p>
        ) : null}
        {message.sources.length > 0 ? (
          <div className="chat-sources">
            <p className="chat-sources-title">{t('出典')}</p>
            <ol>
              {message.sources.map((source) => (
                <li key={`${source.index}-${source.url}`}>
                  <a
                    href={source.url}
                    onClick={(event) => onOpenSource(event, source.url)}
                  >
                    {source.title}
                  </a>
                  <span className="muted">
                    {' '}
                    {sourceHost(source.displayUrl ?? source.url)}
                  </span>
                  {source.snippet ? (
                    <p className="chat-source-snippet">{source.snippet}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        <p className="chat-message-meta muted">
          {!isUser && message.model ? `${message.model} · ` : ''}
          {message.createdAt
            ? formatDateTime(message.createdAt, locale)
            : ''}
        </p>
      </div>
    </div>
  );
}
