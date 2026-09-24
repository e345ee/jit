import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertCircle,
  Bell,
  BookOpen,
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardList,
  FileText,
  HeartPulse,
  ListChecks,
  MessageCircle,
  Search,
  ShieldCheck
} from 'lucide-react';
import { createReminder, loadKnowledge, loadSituations } from './api';
import type { KnowledgeCard, SituationCard, SituationStep } from './types';
import './styles.css';

type Answers = Record<string, string>;
type View = 'routes' | 'route' | 'knowledge' | 'details';

const categories = [
  { label: 'Документы', query: 'документ' },
  { label: 'Справки', query: 'справка' },
  { label: 'Льготы', query: 'льготы' },
  { label: 'ОМС', query: 'ОМС' },
  { label: 'МСЭ', query: 'МСЭ' },
  { label: 'Вычеты', query: 'вычет' },
  { label: 'Госпитализация', query: 'госпитализация' },
  { label: 'Диагностика', query: 'диагностика' },
  { label: 'Дети', query: 'ребенок' },
  { label: 'Переезд', query: 'переезд' }
];

const categoryLabels: Record<string, string> = {
  diagnostics: 'Диагностика',
  hospitalization: 'Госпитализация',
  disability: 'МСЭ',
  tax: 'Вычеты',
  medicines: 'Лекарства',
  booking: 'Запись',
  digital: 'Документы и запись',
  benefits: 'Льготы',
  social: 'Социальный маршрут',
  documents: 'Справки и документы',
  family: 'Семья и дети',
  migration: 'Переезд и адаптация'
};

const sourceTypeLabels: Record<string, string> = {
  official: 'официальный источник',
  clinic: 'клиника',
  law: 'правовой акт',
  faq: 'памятка',
  synthetic: 'справочный материал'
};

function useChecklist(situationId?: string) {
  const key = situationId ? `navigator:checklist:${situationId}` : '';
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!key) return;
    const raw = localStorage.getItem(key);
    setChecked(raw ? JSON.parse(raw) : {});
  }, [key]);

  function toggle(stepId: string) {
    setChecked((current) => {
      const next = { ...current, [stepId]: !current[stepId] };
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }

  function reset() {
    if (!key) return;
    localStorage.removeItem(key);
    setChecked({});
  }

  return { checked, toggle, reset };
}

function stepMatches(step: SituationStep, answers: Answers) {
  if (!step.conditions) return true;
  return Object.entries(step.conditions).every(([questionId, allowed]) => {
    const answer = answers[questionId];
    return answer ? allowed.includes(answer) : true;
  });
}

function App() {
  const [query, setQuery] = useState('');
  const [situations, setSituations] = useState<SituationCard[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeCard[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStep, setSelectedStep] = useState<SituationStep | null>(null);
  const [selectedKnowledge, setSelectedKnowledge] = useState<KnowledgeCard | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [view, setView] = useState<View>('routes');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [connectionDialogDismissed, setConnectionDialogDismissed] = useState(false);
  const [reminderState, setReminderState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      setReloadKey((value) => value + 1);
    }

    function handleOffline() {
      setIsOnline(false);
      setConnectionDialogDismissed(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setConnectionDialogDismissed(false);
    Promise.all([loadSituations(query), loadKnowledge()])
      .then(([nextSituations, nextKnowledge]) => {
        if (cancelled) return;
        setSituations(nextSituations);
        setKnowledge(nextKnowledge);
        setSelectedId((current) => {
          if (current && nextSituations.some((item) => item.id === current)) return current;
          return nextSituations[0]?.id ?? null;
        });
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить справочник. Проверьте API или попробуйте позже.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query, reloadKey]);

  const selected = useMemo(
    () => situations.find((item) => item.id === selectedId) ?? situations[0] ?? null,
    [situations, selectedId]
  );

  const checklist = useChecklist(selected?.id);
  const visibleSteps = useMemo(
    () => selected?.steps.filter((step) => stepMatches(step, answers)) ?? [],
    [selected, answers]
  );
  const completed = visibleSteps.filter((step) => checklist.checked[step.id]).length;
  const visibleKnowledge = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return knowledge.slice(0, 10);

    const filtered = knowledge.filter((card) => {
      const haystack = [
        card.title,
        card.summary,
        ...card.body,
        ...card.tags,
        ...card.sources.map((source) => source.title)
      ].join(' ').toLowerCase();
      return haystack.includes(normalized);
    });

    return (filtered.length > 0 ? filtered : knowledge).slice(0, 10);
  }, [knowledge, query]);

  async function scheduleReminder(step: SituationStep) {
    if (!selected) return;
    setReminderState('saving');
    const remindAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    try {
      await createReminder({
        situationId: selected.id,
        stepId: step.id,
        remindAt,
        text: 'Пора вернуться к сохраненному шагу маршрута.'
      });
      setReminderState('saved');
    } catch {
      setReminderState('error');
    }
  }

  const sourceTarget = selectedKnowledge ?? selected;
  const connectionIssue = !isOnline
    ? {
        title: 'Нет связи с интернетом',
        text: 'Справочник уже открыт, но новые данные и напоминания могут быть недоступны. Проверьте подключение и повторите загрузку.'
      }
    : error
      ? {
          title: 'Не удалось загрузить данные',
          text: 'Сервер справочника сейчас недоступен или соединение прервалось. Можно повторить попытку через несколько секунд.'
        }
      : null;
  const showConnectionDialog = Boolean(connectionIssue && !connectionDialogDismissed);

  return (
    <main className="appShell">
      <section className="appTop" aria-label="Поиск и навигация">
        <div className="brand">
          <div className="logoMark">
            <HeartPulse size={23} />
          </div>
          <div>
            <strong>Навигатор</strong>
            <span>для пациента</span>
          </div>
        </div>

        <label className="searchBox">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedId(null);
              setSelectedKnowledge(null);
              setSelectedStep(null);
              setView('routes');
            }}
            placeholder="Документ, справка или ситуация"
          />
        </label>

        <div className="categoryGrid">
          {categories.map((category) => (
            <button
              className={query.toLowerCase() === category.query.toLowerCase() ? 'active' : ''}
              key={category.label}
              type="button"
              onClick={() => {
                setQuery(category.query);
                setSelectedId(null);
                setSelectedKnowledge(null);
                setSelectedStep(null);
                setView('routes');
              }}
            >
              {category.label}
            </button>
          ))}
        </div>

        <div className="pageTabs" aria-label="Разделы">
          <button className={view === 'routes' ? 'selected' : ''} type="button" onClick={() => setView('routes')}>
            <ListChecks size={16} />
            Маршруты
          </button>
          <button className={view === 'route' ? 'selected' : ''} type="button" onClick={() => setView('route')}>
            <ClipboardList size={16} />
            Карточка
          </button>
          <button className={view === 'knowledge' ? 'selected' : ''} type="button" onClick={() => setView('knowledge')}>
            <BookOpen size={16} />
            Справочник
          </button>
          <button className={view === 'details' ? 'selected' : ''} type="button" onClick={() => setView('details')}>
            <FileText size={16} />
            Детали
          </button>
        </div>
      </section>

      {view === 'routes' && (
        <section className="pagePanel" aria-label="Маршруты">
          <div className="channelCard">
            <MessageCircle size={19} />
            <div>
              <strong>Через MAX-бота</strong>
              <span>Напишите: полис, СНИЛС, больничный, вычет, МСЭ или госпитализация. Бот найдет маршрут или справку.</span>
            </div>
          </div>

          <div className="sectionTitle">Ситуации</div>
          {loading && <p className="muted">Загружаем справочник...</p>}
          {error && <p className="errorText">{error}</p>}
          {!loading && !error && situations.length === 0 && (
            <p className="muted">Маршрут не найден. Посмотрите справочник по документам, полису, СНИЛС и вычетам.</p>
          )}
          {situations.map((item) => (
            <button
              className={`resultItem ${item.id === selected?.id ? 'active' : ''}`}
              key={item.id}
              type="button"
              onClick={() => {
                setSelectedId(item.id);
                setSelectedStep(null);
                setSelectedKnowledge(null);
                setView('route');
              }}
            >
              <span>{item.title}</span>
              <ChevronRight size={16} />
            </button>
          ))}
        </section>
      )}

      {view === 'route' && (
        <section className="pagePanel" aria-label="Карточка маршрута">
          {!selected ? (
            <div className="emptyState">
              <AlertCircle size={28} />
              <h1>Выберите ситуацию</h1>
              <p>Справочник покажет шаги, сроки и частые ошибки.</p>
            </div>
          ) : (
            <>
              <header className="cardHeader">
                <div>
                  <span className="eyebrow">{categoryLabels[selected.category] ?? selected.category} · {selected.region}</span>
                  <h1>{selected.title}</h1>
                  <p>{selected.shortDescription}</p>
                  <div className="routeMeta">
                    <span>{visibleSteps.length} шагов</span>
                    <span>Чек-лист</span>
                    <span>{selected.sources.length} источника</span>
                  </div>
                </div>
                <div className="headerActions" aria-label="Прогресс маршрута">
                  <div className="progressBadge">
                    <ClipboardList size={18} />
                    {completed}/{visibleSteps.length}
                  </div>
                </div>
              </header>

              <div className="notice">
                <ShieldCheck size={18} />
                <span>{selected.disclaimer}</span>
              </div>

              <div className="questions">
                {selected.decisionQuestions.map((question) => (
                  <fieldset key={question.id}>
                    <legend>{question.text}</legend>
                    <div className="segments">
                      {question.options.map((option) => (
                        <button
                          className={answers[question.id] === option.value ? 'selected' : ''}
                          key={option.value}
                          type="button"
                          onClick={() => setAnswers((current) => ({ ...current, [question.id]: option.value }))}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    {question.options.find((option) => option.value === answers[question.id])?.note && (
                      <p className="hint">{question.options.find((option) => option.value === answers[question.id])?.note}</p>
                    )}
                  </fieldset>
                ))}
              </div>

              <div className="stepList">
                <div className="sectionTitle">Что подготовить</div>
                {visibleSteps.map((step) => (
                  <article className="stepRow" key={step.id}>
                    <button
                      className={`checkButton ${checklist.checked[step.id] ? 'done' : ''}`}
                      type="button"
                      aria-label={checklist.checked[step.id] ? 'Снять отметку' : 'Отметить шаг'}
                      onClick={() => checklist.toggle(step.id)}
                    >
                      {checklist.checked[step.id] && <Check size={17} />}
                    </button>
                    <button
                      className="stepBody"
                      type="button"
                      onClick={() => {
                        setSelectedStep(step);
                        setSelectedKnowledge(null);
                        setView('details');
                      }}
                    >
                      <strong>{step.title}</strong>
                      <span>{step.summary}</span>
                    </button>
                    <button className="iconButton" type="button" aria-label="Напомнить" onClick={() => scheduleReminder(step)}>
                      <Bell size={17} />
                    </button>
                  </article>
                ))}
              </div>

              <footer className="metaFooter">
                <button type="button" onClick={checklist.reset}>Сбросить чек-лист</button>
                <span>Актуально: {selected.actualOn}</span>
                <button type="button" onClick={() => setView('details')}>Источники</button>
              </footer>
            </>
          )}
        </section>
      )}

      {view === 'knowledge' && (
        <section className="pagePanel" aria-label="Справочные материалы">
          <div className="sectionTitle">Справочные материалы</div>
          {visibleKnowledge.map((card) => (
            <button
              className={`knowledgeItem ${selectedKnowledge?.id === card.id ? 'active' : ''}`}
              key={card.id}
              type="button"
              onClick={() => {
                setSelectedKnowledge(card);
                setSelectedStep(null);
                setView('details');
              }}
            >
              <BookOpen size={15} />
              <div>
                <strong>{card.title}</strong>
                <p>{card.summary}</p>
              </div>
            </button>
          ))}
        </section>
      )}

      {view === 'details' && (
        <aside className="pagePanel detailPanel" aria-label="Детали">
          {selectedStep ? (
            <>
              <span className="eyebrow">Детали шага</span>
              <h2>{selectedStep.title}</h2>
              <p>{selectedStep.why}</p>
              {selectedStep.validFor && (
                <div className="detailBlock">
                  <CalendarClock size={17} />
                  <span>{selectedStep.validFor}</span>
                </div>
              )}
              <h3>Где получить</h3>
              <ul>
                {selectedStep.whereToGet.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <h3>Частые ошибки</h3>
              <ul>
                {selectedStep.commonMistakes.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </>
          ) : selectedKnowledge ? (
            <>
              <span className="eyebrow">Справка · {selectedKnowledge.actualOn}</span>
              <h2>{selectedKnowledge.title}</h2>
              <p>{selectedKnowledge.summary}</p>
              <div className="knowledgeBody">
                {selectedKnowledge.body.map((item) => (
                  <article key={item}>
                    <FileText size={16} />
                    <span>{item}</span>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="emptyState small">
              <BookOpen size={24} />
              <h2>Откройте шаг или справку</h2>
              <p>Здесь появятся объяснения, источники, сроки и частые ошибки без медицинских назначений.</p>
            </div>
          )}

          {sourceTarget && (
            <div className="sourcePanel">
              <div className="sectionTitle">Где прочитать подробнее</div>
              {(selectedKnowledge?.sources ?? selected?.sources ?? []).map((source) => (
                <article key={`${source.title}-${source.actualOn}`}>
                  {source.url ? (
                    <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                  ) : (
                    <strong>{source.title}</strong>
                  )}
                  <span>{sourceTypeLabels[source.type] ?? source.type} · {source.actualOn}</span>
                </article>
              ))}
            </div>
          )}
        </aside>
      )}

      {reminderState !== 'idle' && (
        <div className={`toast ${reminderState}`}>
          {reminderState === 'saving' && 'Создаем напоминание...'}
          {reminderState === 'saved' && 'Напоминание создано.'}
          {reminderState === 'error' && 'Не удалось создать напоминание. Маршрут можно продолжить.'}
        </div>
      )}

      {showConnectionDialog && connectionIssue && (
        <div className="modalBackdrop" role="presentation">
          <section className="connectionDialog" role="alertdialog" aria-modal="true" aria-labelledby="connection-title">
            <div className="dialogIcon">
              <AlertCircle size={22} />
            </div>
            <div>
              <h2 id="connection-title">{connectionIssue.title}</h2>
              <p>{connectionIssue.text}</p>
            </div>
            <div className="dialogActions">
              <button
                type="button"
                onClick={() => {
                  setConnectionDialogDismissed(false);
                  setReloadKey((value) => value + 1);
                }}
              >
                Повторить
              </button>
              <button type="button" className="secondary" onClick={() => setConnectionDialogDismissed(true)}>
                Закрыть
              </button>
            </div>
          </section>
        </div>
      )}

      <nav className="bottomNav" aria-label="Основная навигация">
        <button className={view === 'routes' ? 'selected' : ''} type="button" onClick={() => setView('routes')}>
          <Search size={18} />
          <span>Поиск</span>
        </button>
        <button className={view === 'route' ? 'selected' : ''} type="button" onClick={() => setView('route')}>
          <ListChecks size={18} />
          <span>Маршрут</span>
        </button>
        <button className={view === 'knowledge' || view === 'details' ? 'selected' : ''} type="button" onClick={() => setView('knowledge')}>
          <BookOpen size={18} />
          <span>Справки</span>
        </button>
      </nav>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
