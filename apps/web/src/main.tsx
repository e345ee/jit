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

const statusLabels: Record<string, string> = {
  official: 'Официальные данные',
  clinic: 'Правила организации',
  synthetic: 'Демо-данные'
};

const sourceTypeLabels: Record<string, string> = {
  official: 'официальный источник',
  clinic: 'клиника',
  law: 'правовой акт',
  faq: 'памятка',
  synthetic: 'демо'
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reminderState, setReminderState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([loadSituations(query), loadKnowledge()])
      .then(([nextSituations, nextKnowledge]) => {
        if (cancelled) return;
        setSituations(nextSituations);
        setKnowledge(nextKnowledge);
        if (!selectedId && nextSituations[0]) {
          setSelectedId(nextSituations[0].id);
        }
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
  }, [query, selectedId]);

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
        text: `Напоминание: проверьте срок документа для шага "${step.title}".`
      });
      setReminderState('saved');
    } catch {
      setReminderState('error');
    }
  }

  return (
    <main className="appShell">
      <section className="sidebar" id="search" aria-label="Поиск и категории">
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
              }}
            >
              {category.label}
            </button>
          ))}
        </div>

        <div className="channelCard">
          <MessageCircle size={19} />
          <div>
            <strong>Через MAX-бота</strong>
            <span>Напишите: полис, СНИЛС, больничный, вычет, МСЭ или госпитализация. Бот найдет маршрут или справку.</span>
          </div>
        </div>

        <div className="resultList">
          <div className="sectionTitle">Ситуации</div>
          {loading && <p className="muted">Загружаем справочник...</p>}
          {error && <p className="errorText">{error}</p>}
          {!loading && !error && situations.length === 0 && (
            <p className="muted">Маршрут не найден. Ниже есть справочные материалы по документам, полису, СНИЛС и вычетам.</p>
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
              }}
            >
              <span>{item.title}</span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>

        <div className="knowledgeList">
          <div className="sectionTitle">Справочные материалы</div>
          {visibleKnowledge.map((card) => (
            <button
              className={`knowledgeItem ${selectedKnowledge?.id === card.id ? 'active' : ''}`}
              key={card.id}
              type="button"
              onClick={() => {
                setSelectedKnowledge(card);
                setSelectedStep(null);
              }}
            >
              <BookOpen size={15} />
              <div>
                <strong>{card.title}</strong>
                <p>{card.summary}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="contentPanel" id="route" aria-label="Карточка справочника">
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
                  <span>Локальный чек-лист</span>
                  <span>{selected.sources.length} источника</span>
                </div>
              </div>
              <div className="headerActions" aria-label="Статус маршрута">
                <div className="progressBadge">
                  <ClipboardList size={18} />
                  {completed}/{visibleSteps.length}
                </div>
                <div className="sourceBadge">
                  <FileText size={17} />
                  {statusLabels[selected.dataStatus] ?? selected.dataStatus}
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
              <span>Источников: {selected.sources.length}</span>
            </footer>

            {reminderState !== 'idle' && (
              <div className={`toast ${reminderState}`}>
                {reminderState === 'saving' && 'Создаем напоминание...'}
                {reminderState === 'saved' && 'Напоминание создано без диагноза и медицинских данных.'}
                {reminderState === 'error' && 'Не удалось создать напоминание. Основной сценарий можно продолжить.'}
              </div>
            )}
          </>
        )}
      </section>

      <aside className="detailPanel" id="details" aria-label="Детали шага">
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
            <span className="eyebrow">{statusLabels[selectedKnowledge.dataStatus] ?? selectedKnowledge.dataStatus} · {selectedKnowledge.actualOn}</span>
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

        {(selectedKnowledge ?? selected) && (
          <div className="sourcePanel">
            <div className="sectionTitle">Источники</div>
            {(selectedKnowledge?.sources ?? selected?.sources ?? []).map((source) => (
              <article key={`${source.title}-${source.actualOn}`}>
                <strong>{source.title}</strong>
                <span>{sourceTypeLabels[source.type] ?? source.type} · {source.actualOn}</span>
              </article>
            ))}
          </div>
        )}
      </aside>

      <nav className="bottomNav" aria-label="Основная навигация">
        <a href="#search">
          <Search size={18} />
          <span>Поиск</span>
        </a>
        <a href="#route">
          <ListChecks size={18} />
          <span>Маршрут</span>
        </a>
        <a href="#details">
          <BookOpen size={18} />
          <span>Детали</span>
        </a>
      </nav>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
