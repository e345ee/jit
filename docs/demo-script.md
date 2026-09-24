# Demo script

Target length: 3-4 minutes.

## 0:00-0:30 Problem

Patient routes are fragmented: a person has to understand documents, deadlines, where to get them, and what mistakes break the appointment. The MVP focuses on one concrete route instead of a generic medical chatbot.

## 0:30-1:00 Entry through MAX

1. Open the existing MAX bot.
2. Send `/start`.
3. Show the neutral intro: the product does not diagnose, does not interpret tests, and does not replace a doctor.
4. Click "Открыть навигатор".

## 1:00-2:20 Main scenario

1. Search for "МРТ с контрастом".
2. Answer the quick questions:
   - referral exists or not;
   - reaction/allergy history exists or not.
3. Show the adapted card:
   - steps;
   - why each step matters;
   - where to get documents;
   - validity period;
   - common mistakes.
4. Mark one step in the local checklist.
5. Open "Анализ на креатинин" details.

## 2:20-2:50 Reminder

1. Click the reminder button for a step.
2. Explain that the reminder is neutral: it stores a step deadline, not a diagnosis or medical document.
3. Mention that the production path uses PostgreSQL and a worker, while the mini app checklist stays on device.

## 2:50-3:30 Trust and scale

1. Show source metadata: source, date, region, data status.
2. Open the list of other cards: CT with contrast, MSE, tax deduction, hospitalization, preferential medicines.
3. Explain the content pipeline:
   - official source;
   - date of relevance;
   - status `official`, `clinic`, or `synthetic`;
   - expert review before pilot.

## 3:30-4:00 Commercial close

Pilot offer:

- one partner;
- one route;
- 2-4 weeks;
- QR/deeplink from clinic materials;
- metrics: successful card opens, checklist completion, support questions reduced, user feedback.

Do not promise medical advice. Promise navigation, fewer missed documents, and clearer patient communication.

