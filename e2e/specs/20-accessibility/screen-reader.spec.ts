import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Screen Reader / ARIA Support', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('ARIA Tests');
  });

  it('should have ARIA roles on interactive elements', async () => {
    // Toolbar buttons should have button role
    const toolbarBtns = await $$(S.toolbar + ' button');
    for (const btn of toolbarBtns) {
      const role = await btn.getAttribute('role');
      const tagName = await btn.getTagName();
      // Native <button> elements implicitly have role="button"
      expect(tagName === 'button' || role === 'button').toBe(true);
    }

    // Connection tree should have tree or list role
    const tree = await $(S.connectionTree);
    if (await tree.isExisting()) {
      const role = await tree.getAttribute('role');
      expect(role === 'tree' || role === 'list' || role === 'listbox' || role === 'group').toBe(
        true,
      );
    }
  });

  it('should have labels on form inputs', async () => {
    // Open connection editor
    const addBtn = await $(S.toolbarNewConnection);
    await addBtn.click();
    await browser.pause(500);

    const nameInput = await $(S.editorName);
    await nameInput.waitForDisplayed({ timeout: 5_000 });

    // Check that the name input has an accessible label
    const ariaLabel = await nameInput.getAttribute('aria-label');
    const ariaLabelledBy = await nameInput.getAttribute('aria-labelledby');
    const id = await nameInput.getAttribute('id');

    const hasLabel = !!(ariaLabel || ariaLabelledBy || (id && (await $(`label[for="${id}"]`).isExisting())));
    expect(hasLabel).toBe(true);

    // Check hostname input
    const hostInput = await $(S.editorHostname);
    const hostAriaLabel = await hostInput.getAttribute('aria-label');
    const hostAriaLabelledBy = await hostInput.getAttribute('aria-labelledby');
    const hostId = await hostInput.getAttribute('id');

    const hostHasLabel = !!(
      hostAriaLabel ||
      hostAriaLabelledBy ||
      (hostId && (await $(`label[for="${hostId}"]`).isExisting()))
    );
    expect(hostHasLabel).toBe(true);
  });

  it('should have aria-modal on modal dialogs', async () => {
    const settingsBtn = await $(S.toolbarSettings);
    await settingsBtn.click();
    await browser.pause(500);

    const dialog = await $(S.settingsDialog);
    await dialog.waitForExist({ timeout: 5_000 });

    // The dialog or its container should have aria-modal or role="dialog"
    const ariaModal = await dialog.getAttribute('aria-modal');
    const role = await dialog.getAttribute('role');

    expect(ariaModal === 'true' || role === 'dialog' || role === 'alertdialog').toBe(true);

    await browser.keys('Escape');
    await browser.pause(300);
  });

  it('should have accessible names on all buttons', async () => {
    // Gather all visible buttons in the toolbar
    const buttons = await $$(S.toolbar + ' button');

    for (const btn of buttons) {
      if (!(await btn.isDisplayed())) continue;

      const ariaLabel = await btn.getAttribute('aria-label');
      const textContent = await btn.getText();
      const title = await btn.getAttribute('title');

      const hasAccessibleName = !!(
        (ariaLabel && ariaLabel.trim().length > 0) ||
        (textContent && textContent.trim().length > 0) ||
        (title && title.trim().length > 0)
      );
      expect(hasAccessibleName).toBe(true);
    }
  });
});
