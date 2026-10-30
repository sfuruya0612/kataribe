import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_APP_SETTINGS } from '../../shared/settings';
import type {
  AppInfo,
  AppSettings,
  MeetingSummary,
  RecordingStopResult,
} from '../../shared/types';
import { MeetingDetail } from './MeetingDetail';
import { MeetingTable } from './MeetingTable';
import { RecordingView } from './RecordingView';
import { SettingsPanel } from './SettingsPanel';
import { Sidebar, type MeetingFilter } from './Sidebar';
import { TopBar } from './TopBar';
import { errorText } from './recording-utils';
import { useRecorder } from './use-recorder';

type View = 'meetings' | 'detail' | 'recording' | 'settings';

export default function App() {
  const recorder = useRecorder();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(true);
  const [view, setView] = useState<View>('meetings');
  const [filter, setFilter] = useState<MeetingFilter>('all');
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refreshMeetings = useCallback(async () => {
    setMeetingsLoading(true);
    try {
      const list = await window.kataribe.listMeetings();
      setMeetings(list);
    } catch (reason: unknown) {
      setToast(`会議一覧を読み込めませんでした: ${errorText(reason)}`);
    } finally {
      setMeetingsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.kataribe
      .getAppInfo()
      .then((value) => {
        if (!cancelled) {
          setInfo(value);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setToast(`アプリ情報を取得できませんでした: ${errorText(reason)}`);
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
          setToast(`設定を読み込めませんでした: ${errorText(reason)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshMeetings();
  }, [refreshMeetings]);

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
      setToast(`設定を保存できませんでした: ${errorText(reason)}`);
    }
  }, []);

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
    setView('detail');
  };

  const openDetailFromResult = (result: RecordingStopResult) => {
    setSelectedMeetingId(result.meetingId);
    setView('detail');
    void refreshMeetings();
  };

  const runShellAction = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (reason: unknown) {
      setToast(`操作に失敗しました: ${errorText(reason)}`);
    }
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

  return (
    <div className="app-shell">
      <TopBar
        appState={recorder.appState}
        saveRoot={info?.saveRoot ?? '~/Documents/Kataribe'}
        meetingCount={meetings.length}
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
            />
          ) : null}

          {view === 'detail' ? (
            <MeetingDetail
              meeting={selectedMeeting}
              onBack={() => setView('meetings')}
              onOpenFolder={openMeetingFolder}
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
              saveRoot={info?.saveRoot ?? '~/Documents/Kataribe'}
              version={info?.version ?? '0.1.0'}
              settings={settings}
              inputSource={recorder.appState.inputSource}
              permission={recorder.permission}
              microphones={recorder.microphones}
              systemDevices={recorder.systemDevices}
              onUpdateSettings={(patch) => void updateSettings(patch)}
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
