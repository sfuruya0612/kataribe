import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_APP_SETTINGS } from '../../shared/settings';
import { formatSaveLocationSyncWarning } from '../../shared/i18n';
import type {
  AppInfo,
  AppSettings,
  MeetingSearchHit,
  MeetingSearchResult,
  MeetingSummary,
  ProcessingState,
  RecordingStopResult,
  UiLanguage,
} from '../../shared/types';
import { MeetingDetail } from './MeetingDetail';
import { MeetingTable } from './MeetingTable';
import { RecordingView } from './RecordingView';
import { SearchResults } from './SearchResults';
import { SettingsPanel } from './SettingsPanel';
import { Sidebar, type MeetingFilter } from './Sidebar';
import { TopBar } from './TopBar';
import { errorText } from './recording-utils';
import { useI18n } from './i18n';
import { useRecorder } from './use-recorder';

type View = 'meetings' | 'detail' | 'recording' | 'settings' | 'search';

function cloudSyncService(path: string): string | null {
  const value = path.toLowerCase();
  if (value.includes('/library/mobile documents/')) return 'iCloud Drive';
  if (value.includes('/dropbox/')) return 'Dropbox';
  if (value.includes('/onedrive')) return 'OneDrive';
  if (value.includes('/google drive') || value.includes('/googledrive')) {
    return 'Google Drive';
  }
  if (value.includes('/obsidian')) return 'Obsidian';
  return null;
}

export default function App({
  initialUiLanguage = 'ja',
}: {
  initialUiLanguage?: UiLanguage;
}) {
  const { locale, t, setLocale } = useI18n();
  const recorder = useRecorder();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => ({
    ...DEFAULT_APP_SETTINGS,
    uiLanguage: initialUiLanguage,
  }));
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(true);
  const [view, setView] = useState<View>('meetings');
  const [filter, setFilter] = useState<MeetingFilter>('all');
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [detailSeekSeconds, setDetailSeekSeconds] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<MeetingSearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [processing, setProcessing] = useState<ProcessingState>({
    stage: null,
    meetingId: null,
    progress: null,
    etaSeconds: null,
    message: null,
    cancellable: false,
    error: null,
  });
  const lastStageRef = useRef<ProcessingState['stage']>(null);

  useEffect(() => {
    setLocale(settings.uiLanguage);
  }, [setLocale, settings.uiLanguage]);

  const refreshMeetings = useCallback(async () => {
    setMeetingsLoading(true);
    try {
      const list = await window.kataribe.listMeetings();
      setMeetings(list);
    } catch (reason: unknown) {
      setToast(
        t('会議一覧を読み込めませんでした: {error}', { error: errorText(reason) }),
      );
    } finally {
      setMeetingsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    void window.kataribe
      .getAppInfo()
      .then((value) => {
        if (!cancelled) {
          setInfo(value);
          const service = cloudSyncService(value.saveRoot);
          if (service) {
            setToast(formatSaveLocationSyncWarning(service, locale));
          }
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setToast(
            t('アプリ情報を取得できませんでした: {error}', {
              error: errorText(reason),
            }),
          );
        }
      });
    void window.kataribe
      .getSettings()
      .then((value) => {
        if (!cancelled) {
          setSettings(value);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setToast(
            t('設定を読み込めませんでした: {error}', { error: errorText(reason) }),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    void refreshMeetings();
  }, [refreshMeetings]);

  useEffect(() => {
    if (view !== 'settings') {
      return;
    }
    let cancelled = false;
    void window.kataribe
      .getSettings()
      .then((value) => {
        if (!cancelled) {
          setSettings(value);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setToast(
            t('設定を読み込めませんでした: {error}', { error: errorText(reason) }),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t, view]);

  useEffect(() => {
    let cancelled = false;
    void window.kataribe
      .listWhisperModels()
      .then((list) => {
        if (!cancelled && !list.models.some((model) => model.installed)) {
          setToast(
            t(
              'whisper モデルが未取得です。設定 > 文字起こし からダウンロードしてください。',
            ),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    void window.kataribe
      .getProcessingState()
      .then((state) => {
        if (!cancelled) {
          setProcessing(state);
          lastStageRef.current = state.stage;
        }
      })
      .catch(() => undefined);
    const unsubscribeState = window.kataribe.onProcessingState((state) => {
      setProcessing(state);
      const stageChanged = lastStageRef.current !== state.stage;
      lastStageRef.current = state.stage;
      if (stageChanged) {
        void refreshMeetings();
      }
      if (state.error) {
        setToast(state.error);
      }
    });
    const unsubscribeMeetings = window.kataribe.onMeetingUpdated(() => {
      void refreshMeetings();
    });
    const unsubscribeChanged = window.kataribe.onMeetingsChanged((list) => {
      setMeetings(list);
    });
    return () => {
      cancelled = true;
      unsubscribeState();
      unsubscribeMeetings();
      unsubscribeChanged();
    };
  }, [refreshMeetings]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchLoading(false);
      setSearchResult(null);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      void window.kataribe
        .searchMeetings(query)
        .then((result) => {
          if (!cancelled) {
            setSearchResult(result);
          }
        })
        .catch((reason: unknown) => {
          if (!cancelled) {
            setToast(t('検索できませんでした: {error}', { error: errorText(reason) }));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSearchLoading(false);
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery, t]);

  useEffect(() => {
    if (recorder.appState.lastResult) {
      void refreshMeetings();
    }
  }, [refreshMeetings, recorder.appState.lastResult]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    try {
      const next = await window.kataribe.updateSettings(patch);
      setSettings(next);
    } catch (reason: unknown) {
      setToast(
        t('設定を保存できませんでした: {error}', { error: errorText(reason) }),
      );
    }
  }, [t]);

  const filteredMeetings = useMemo(() => {
    switch (filter) {
      case 'processing':
        return meetings.filter(
          (meeting) =>
            meeting.status === 'encoding' || meeting.status === 'transcribing',
        );
      case 'error':
        return meetings.filter((meeting) => meeting.status === 'error');
      case 'recording':
        return meetings.filter((meeting) => meeting.status === 'recording');
      case 'all':
        return meetings;
      default: {
        if (filter.startsWith('month:')) {
          const key = filter.slice('month:'.length);
          return meetings.filter((meeting) => {
            const date = new Date(meeting.startedAt);
            if (!Number.isFinite(date.getTime())) {
              return false;
            }
            const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            return month === key;
          });
        }
        const year = filter.slice('year:'.length);
        return meetings.filter(
          (meeting) =>
            meeting.startedAt.length >= 4 && meeting.startedAt.slice(0, 4) === year,
        );
      }
    }
  }, [filter, meetings]);

  const selectedMeeting =
    meetings.find((meeting) => meeting.id === selectedMeetingId) ?? null;

  const openDetail = (meeting: MeetingSummary) => {
    setSelectedMeetingId(meeting.id);
    setDetailSeekSeconds(null);
    setView('detail');
  };

  const openDetailFromResult = (result: RecordingStopResult) => {
    setSelectedMeetingId(result.meetingId);
    setDetailSeekSeconds(null);
    setView('detail');
    void refreshMeetings();
  };

  const runShellAction = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (reason: unknown) {
      setToast(t('操作に失敗しました: {error}', { error: errorText(reason) }));
    }
  };

  const changeSaveRoot = useCallback(async () => {
    try {
      const result = await window.kataribe.chooseSaveRoot();
      if (!result) {
        return;
      }
      setInfo(result.info);
      setSettings(result.settings);
      setFilter('all');
      setSelectedMeetingId(null);
      setView('meetings');
      setSearchQuery('');
      setSearchResult(null);
      await refreshMeetings();
      setToast(t('保存先を変更しました。'));
    } catch (reason: unknown) {
      setToast(
        t('保存先を変更できませんでした: {error}', { error: errorText(reason) }),
      );
    }
  }, [refreshMeetings, t]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (value.trim()) {
      setView('search');
    } else if (view === 'search') {
      setView('meetings');
    }
  };

  const openSearchHit = (hit: MeetingSearchHit) => {
    setSelectedMeetingId(hit.meetingId);
    if (hit.timestamp) {
      const [hours, minutes, seconds] = hit.timestamp.split(':').map(Number);
      setDetailSeekSeconds(hours * 3600 + minutes * 60 + seconds);
    } else {
      setDetailSeekSeconds(null);
    }
    setView('detail');
  };

  const toggleRecording = () => {
    if (recorder.appState.status === 'recording') {
      void recorder.requestStop();
      return;
    }
    if (
      recorder.appState.status === 'starting' ||
      recorder.appState.status === 'stopping'
    ) {
      return;
    }
    setView('recording');
    void recorder.requestStart();
  };

  const openMeetingFolder = () => {
    if (selectedMeeting) {
      void runShellAction(() =>
        window.kataribe.openMeetingFolder(selectedMeeting.id),
      );
    }
  };

  const importAudio = async () => {
    try {
      const meeting = await window.kataribe.importAudio();
      if (!meeting) {
        return;
      }
      setSelectedMeetingId(meeting.id);
      setDetailSeekSeconds(null);
      setView('detail');
      await refreshMeetings();
    } catch (reason: unknown) {
      setToast(t('音声を取り込めませんでした: {error}', { error: errorText(reason) }));
    }
  };

  const setMeetingPinned = async (
    meeting: MeetingSummary,
    pinned: boolean,
  ) => {
    try {
      const updated = await window.kataribe.setMeetingPinned(meeting.id, pinned);
      setMeetings((current) =>
        current
          .map((entry) => (entry.id === updated.id ? updated : entry))
          .sort(
            (left, right) =>
              Number(right.pinned) - Number(left.pinned) ||
              right.startedAt.localeCompare(left.startedAt),
          ),
      );
    } catch (reason: unknown) {
      setToast(t('Pin を変更できませんでした: {error}', { error: errorText(reason) }));
    }
  };

  const deleteMeeting = async (meeting: MeetingSummary) => {
    if (
      !window.confirm(
        t(
          '「{title}」を削除します。音声、文字起こし、要約、メタデータがすべて削除され、元に戻せません。',
          { title: meeting.title },
        ),
      )
    ) {
      return;
    }
    try {
      await window.kataribe.deleteMeeting(meeting.id);
      if (selectedMeetingId === meeting.id) {
        setSelectedMeetingId(null);
        setDetailSeekSeconds(null);
        setView('meetings');
      }
      await refreshMeetings();
      setToast(t('会議を削除しました。'));
    } catch (reason: unknown) {
      setToast(t('会議を削除できませんでした: {error}', { error: errorText(reason) }));
    }
  };

  return (
    <div className="app-shell">
      <TopBar
        appState={recorder.appState}
        saveRoot={settings.saveRoot || info?.saveRoot || '~/Documents/Kataribe'}
        meetingCount={meetings.length}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        onToggleRecording={toggleRecording}
      />

      <div className="workspace">
        <Sidebar
          meetings={meetings}
          view={view}
          filter={filter}
          onFilter={(next) => {
            setFilter(next);
            setView('meetings');
          }}
          onOpenRecording={() => setView('recording')}
          onOpenSettings={() => setView('settings')}
        />

        <main className="main-pane">
          {view === 'meetings' ? (
            <MeetingTable
              meetings={filteredMeetings}
              loading={meetingsLoading}
              selectedId={selectedMeetingId}
              isRecording={recorder.appState.status === 'recording'}
              recordingBusy={
                recorder.appState.status === 'starting' ||
                recorder.appState.status === 'stopping'
              }
              onSelect={openDetail}
              onRefresh={() => void refreshMeetings()}
              onToggleRecording={toggleRecording}
              onImportAudio={() => void importAudio()}
              onSetPinned={(meeting, pinned) => void setMeetingPinned(meeting, pinned)}
              onDeleteMeeting={(meeting) => void deleteMeeting(meeting)}
            />
          ) : null}

          {view === 'search' ? (
            <SearchResults
              query={searchQuery}
              result={searchResult}
              loading={searchLoading}
              onSelect={openSearchHit}
            />
          ) : null}

          {view === 'detail' ? (
            <MeetingDetail
              meeting={selectedMeeting}
              processing={processing}
              defaultSummaryLanguage={settings.summaryLanguage}
              whisperModel={settings.whisperModel}
              initialSeekSeconds={detailSeekSeconds}
              onUpdateSettings={(patch) => updateSettings(patch)}
              onBack={() => setView('meetings')}
              onOpenFolder={openMeetingFolder}
              onOpenSettings={() => setView('settings')}
            />
          ) : null}

          {view === 'recording' ? (
            <RecordingView
              recorder={recorder}
              onOpenDetail={openDetailFromResult}
              onOpenReadme={() =>
                void runShellAction(() => window.kataribe.openReadme())
              }
            />
          ) : null}

          {view === 'settings' ? (
            <SettingsPanel
              saveRoot={settings.saveRoot || info?.saveRoot || '~/Documents/Kataribe'}
              version={info?.version ?? '0.1.0'}
              settings={settings}
              inputSource={recorder.appState.inputSource}
              permission={recorder.permission}
              microphones={recorder.microphones}
              systemDevices={recorder.systemDevices}
              onUpdateSettings={(patch) => updateSettings(patch)}
              onChangeSaveRoot={() => void changeSaveRoot()}
              onSetInputSource={(source) => void recorder.setInputSource(source)}
              onRequestPermission={() => void recorder.requestPermission()}
              onOpenMicrophoneSettings={() => void recorder.openMicrophoneSettings()}
              onOpenReadme={() =>
                void runShellAction(() => window.kataribe.openReadme())
              }
              onOpenBlackHoleSite={() =>
                void runShellAction(() => window.kataribe.openBlackHoleSite())
              }
              onShowAbout={() => void runShellAction(() => window.kataribe.showAbout())}
            />
          ) : null}
        </main>
      </div>

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
