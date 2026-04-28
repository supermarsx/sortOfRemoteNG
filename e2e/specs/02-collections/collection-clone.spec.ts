import { S } from '../../helpers/selectors';
import { createCollection, resetAppState } from '../../helpers/app';

async function openCollectionCenter(): Promise<void> {
  const selector = await $(S.collectionSelector);
  if (await selector.isDisplayed().catch(() => false)) {
    return;
  }

  const toolbarButton = await $(S.toolbarCollection);
  await toolbarButton.waitForClickable({ timeout: 10_000 });
  await toolbarButton.click();
  await selector.waitForDisplayed({ timeout: 10_000 });
}

async function getCollectionRow(name: string) {
  const row = await $(`//div[@role="button" and .//h4[normalize-space()="${name}"]]`);
  await row.waitForExist({ timeout: 10_000 });
  return row;
}

async function listCollectionNames(): Promise<string[]> {
  const headings = await $$(`${S.collectionSelector} [role="button"] h4`);
  const names: string[] = [];

  for (const heading of headings) {
    names.push((await heading.getText()).trim());
  }

  return names;
}

describe('Collection Clone', () => {
  beforeEach(async () => {
    await resetAppState();
  });

  it('clones a collection from the overflow menu and keeps the Collection Center open', async () => {
    await createCollection('Primary');
    await openCollectionCenter();

    const row = await getCollectionRow('Primary');
    const trigger = await row.$(S.collectionActionsTrigger);
    await trigger.waitForClickable({ timeout: 10_000 });
    await trigger.click();

    const menu = await $(S.collectionActionMenu);
    await menu.waitForDisplayed({ timeout: 10_000 });

    const cloneButton = await menu.$('button=Clone');
    await cloneButton.waitForClickable({ timeout: 10_000 });
    await cloneButton.click();

    await browser.waitUntil(
      async () => (await listCollectionNames()).includes('Primary (Copy)'),
      {
        timeout: 10_000,
        timeoutMsg: 'Expected cloned collection to appear in Collection Center',
      },
    );

    const selector = await $(S.collectionSelector);
    expect(await selector.isDisplayed()).toBe(true);
    expect(await listCollectionNames()).toEqual(['Primary', 'Primary (Copy)']);
  });
});