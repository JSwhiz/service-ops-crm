import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const componentUrl = new URL('./one-time-order-preview-drawer.tsx', import.meta.url);
const pageUrl = new URL('../../../app/(app)/one-time-orders/[id]/page.tsx', import.meta.url);
const cssUrl = new URL('./one-time-order-preview-drawer.module.css', import.meta.url);
const detailCssUrl = new URL('../../../app/(app)/one-time-orders/[id]/one-time-order-detail.module.css', import.meta.url);

test('preview links enter the matching order-card section and edit mode', async () => {
  const [component, page] = await Promise.all([
    readFile(componentUrl, 'utf8'),
    readFile(pageUrl, 'utf8'),
  ]);

  assert.match(component, /\?section=execution#one-time-order-specification`} onClick=\{close\}>Открыть работы и ТЗ/);
  assert.match(component, /\?section=execution#one-time-order-tasks`} onClick=\{close\}>Открыть задачи/);
  assert.doesNotMatch(component, /#one-time-order-daily-report/);
  assert.match(page, /<section id="one-time-order-specification" className=\{styles.executionAnchor\} tabIndex=\{-1\} aria-label="Техническое задание">\s*<OneTimeOrderSpecificationPanel[\s\S]*?<\/section>/);
  assert.match(page, /<section id="one-time-order-tasks" className=\{styles.executionAnchor\} tabIndex=\{-1\} aria-label="Задачи заказа">\s*<OneTimeOrderTasksPanel[\s\S]*?<\/section>/);
  assert.match(page, /if \(isLoading \|\| activeSection !== 'execution'\) return/);
  assert.match(page, /target\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(page, /target\?\.scrollIntoView\(\{ block: 'start' \}\)/);
  assert.match(component, /\?section=materials/);
  assert.match(component, /\?section=finance/);
  assert.match(component, /\?section=overview&edit=1/);
  assert.match(page, /searchParams\.get\('edit'\) !== '1'/);
  assert.match(page, /setIsEditing\(true\)/);
});

test('execution anchors clear the fixed 64px header plus a spacing-token gap', async () => {
  const css = await readFile(detailCssUrl, 'utf8');
  assert.match(css, /\.executionAnchor\s*\{\s*scroll-margin-top:\s*calc\(max\(var\(--ui-topbar-height\), 64px\) \+ var\(--ui-space-4\)\);\s*\}/);
});

test('operational content precedes payment and collapsed review in DOM order', async () => {
  const component = await readFile(componentUrl, 'utf8');
  const sections = [
    'Основная информация',
    'Ход выполнения',
    'Быстрая смена статуса',
    'Комментарии к заказу',
    'Условия оплаты',
    'Отзыв клиента',
  ];
  const positions = sections.map((label) => component.indexOf(`aria-label="${label}"`));
  positions.forEach((position, index) => {
    assert.ok(position >= 0, `${sections[index]} is present`);
    if (index > 0) assert.ok(position > positions[index - 1], `${sections[index]} follows ${sections[index - 1]}`);
  });
  assert.match(component, /const \[reviewFormOpen, setReviewFormOpen\] = useState\(false\)/);
  const warnings = component.indexOf('aria-label="Требует внимания"');
  assert.ok(warnings > component.indexOf('className={styles.statusRow}'));
  assert.ok(warnings < positions[0]);
  assert.match(component, /className=\{styles.warning\}>Менеджеры не назначены/);
  assert.match(component, /!executionStartDate \|\| !executionEndDate/);
});

test('review and comment disclosure preserves controlled drafts', async () => {
  const component = await readFile(componentUrl, 'utf8');

  assert.match(component, /value=\{reviewDraft\}/);
  assert.match(component, /value=\{commentDraft\}/);
  assert.match(component, /canEditReview && reviewFormOpen/);
  assert.match(component, /commentFormOpen \? <form/);
  assert.match(component, /Плановая сумма заказа/);
  assert.match(component, /Полученные платежи и подотчёт/);
});

test('drawer action controls remain intrinsic width on narrow screens', async () => {
  const css = await readFile(cssUrl, 'utf8');

  assert.match(css, /\.footer > \* \{ flex: 0 1 auto; align-self: flex-start; \}/);
  assert.match(css, /\.statusAction > button \{ width: auto; \}/);
});

test('changing the order resets all scoped drafts; same-order access refresh preserves them', async () => {
  const component = await readFile(componentUrl, 'utf8');
  assert.match(component, /const nextItemId = item\?\.id \?\? null/);
  const reset = component.match(/if \(draftItemId.current !== nextItemId\) \{([\s\S]*?)\n {4}\}/)?.[1];
  assert.ok(reset, 'reset is keyed by order id, not access version');
  assert.match(reset, /draftItemId.current = nextItemId/);
  assert.match(reset, /reviewFormOpenRef.current = false/);
  for (const statement of [
    'setLoadedScope(null)', 'setDetails(null)', 'setComments([])',
    'setError(null)', 'setNotice(null)', 'setCommentDraft(\'\')',
    'setReviewDraft(\'\')', 'setReviewRatingDraft(null)',
    'setReviewFormOpen(false)', 'setCommentFormOpen(false)',
    'setNextStatus(\'\')', 'setStatusMenuOpen(false)', 'setClearReviewConfirmOpen(false)',
  ]) assert.ok(reset.includes(statement), `${statement} clears the previous order's state`);
  assert.match(component, /if \(!reviewFormOpenRef.current\) \{\s*setReviewDraft/);
  assert.match(component, /\}, \[scope, accessRetry\]\)/);
});

test('late writes from another order cannot overwrite the current drawer, including A → B → A', async () => {
  const component = await readFile(componentUrl, 'utf8');
  assert.match(component, /itemGeneration.current \+= 1/);
  assert.match(component, /generation === itemGeneration.current && itemRef.current\?\.id === item.id/);
  for (const name of ['saveComment', 'saveReview', 'clearReview', 'applyStatus']) {
    const start = component.indexOf(`const ${name} = async`);
    const end = component.indexOf('\n  };', start);
    const handler = component.slice(start, end);
    assert.match(handler, /const isCurrentItem = captureItemOperation\(\)/);
    assert.match(handler, /if \(!isCurrentItem\(\)\) return/);
    assert.match(handler, /finally \{\s*if \(isCurrentItem\(\)\) setSaving/);
  }
});
