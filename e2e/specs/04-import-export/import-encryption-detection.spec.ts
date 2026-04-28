import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S } from '../../helpers/selectors';
import { resetAppState, createCollection, openImportExport } from '../../helpers/app';

const fixturesDir = fileURLToPath(new URL('../../helpers/fixtures', import.meta.url));

async function openImportTab(): Promise<void> {
  await openImportExport();

  const importTab = await $(S.importTab);
  await importTab.waitForClickable({ timeout: 5_000 });
  await importTab.click();

  await (await $(S.importFileInput)).waitForExist({ timeout: 10_000 });
}

async function stubPrompt(response: string | null): Promise<void> {
  await browser.execute((nextResponse: string | null) => {
    const win = window as any;
    win.__promptCalls = [];
    win.prompt = (message?: string) => {
      win.__promptCalls.push(String(message ?? ''));
      return nextResponse;
    };
  }, response);
}

async function getPromptCalls(): Promise<string[]> {
  return (await browser.execute(() => (window as any).__promptCalls ?? [])) as string[];
}

async function injectVirtualFile(
  content: string,
  filename: string,
  mimeType: string,
): Promise<void> {
  await browser.execute(
    (selector: string, fileName: string, fileContent: string, type: string) => {
      const input = document.querySelector(selector) as HTMLInputElement | null;
      if (!input) {
        throw new Error(`Input not found for selector: ${selector}`);
      }

      const file = new File([new Blob([fileContent], { type })], fileName, { type });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      Object.defineProperty(input, 'files', {
        value: dataTransfer.files,
        configurable: true,
      });

      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    S.importFileInput,
    filename,
    content,
    mimeType,
  );

  await (await $(S.importPreview)).waitForDisplayed({ timeout: 10_000 });
}

async function injectFixtureAs(sourceFilename: string, injectedFilename: string): Promise<void> {
  const content = readFileSync(path.resolve(fixturesDir, sourceFilename), 'utf8');
  await injectVirtualFile(content, injectedFilename, 'application/json');
}

describe('Import Encryption Detection', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Import Encryption Detection');
    await (await $(S.connectionTree)).waitForDisplayed({ timeout: 10_000 });
  });

  it('does not prompt for decryption on ordinary JSON imports', async () => {
    await openImportTab();
    await stubPrompt('unused');
    await injectFixtureAs('connections.json', 'connections.json');

    const previewText = await (await $(S.importPreview)).getText();
    const promptCalls = await getPromptCalls();

    expect(previewText).toContain('Import Successful');
    expect(previewText).toContain('Found 5 connections ready to import.');
    expect(promptCalls).toHaveLength(0);
  });

  it('prompts when the filename contains .encrypted. and fails if the prompt is cancelled', async () => {
    await openImportTab();
    await stubPrompt(null);
    await injectFixtureAs('connections.json', 'connections.encrypted.json');

    const previewText = await (await $(S.importPreview)).getText();
    const promptCalls = await getPromptCalls();

    expect(promptCalls).toEqual(['Enter decryption password:']);
    expect(previewText).toContain('Import Failed');
    expect(previewText).toContain('Password required for encrypted file');
  });

  it('prompts when the extension itself is .encrypted and surfaces decrypt failures', async () => {
    await openImportTab();
    await stubPrompt('WrongPassword123');
    await injectFixtureAs('connections.json', 'connections.json.encrypted');

    const previewText = await (await $(S.importPreview)).getText();
    const promptCalls = await getPromptCalls();

    expect(promptCalls).toEqual(['Enter decryption password:']);
    expect(previewText).toContain('Import Failed');
    expect(previewText).toContain('Failed to decrypt file. Check your password.');
  });
});