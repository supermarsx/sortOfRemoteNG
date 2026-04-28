function toXPathLiteral(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }

  if (!value.includes('"')) {
    return `"${value}"`;
  }

  return `concat('${value.replace(/'/g, `', "'", '`)}')`;
}

export async function selectCustomOption(
  triggerSelector: string,
  optionLabels: string | string[],
): Promise<void> {
  const labels = Array.isArray(optionLabels) ? optionLabels : [optionLabels];
  const trigger = await $(triggerSelector);

  await trigger.waitForClickable({ timeout: 10_000 });
  await trigger.click();

  await browser.waitUntil(
    async () => (await trigger.getAttribute('aria-expanded').catch(() => null)) === 'true',
    {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: 'Expected custom select to open',
    },
  );

  for (const label of labels) {
    const optionLiteral = toXPathLiteral(label);
    const inlineButtonOption = await trigger.$(
      `./following-sibling::*//button[.//span[normalize-space(.)=${optionLiteral}] or normalize-space(.)=${optionLiteral}]`,
    );

    if (await inlineButtonOption.isExisting().catch(() => false)) {
      await inlineButtonOption.scrollIntoView();
      await inlineButtonOption.click();
      return;
    }

    const listboxOption = await $(
      `//*[@role="option" and normalize-space(.)=${optionLiteral}]`,
    );

    if (await listboxOption.isExisting().catch(() => false)) {
      await listboxOption.scrollIntoView();
      await listboxOption.click();
      return;
    }
  }

  const listboxOptions = await $$('//*[@role="option"]');
  const inlineButtonOptions = await trigger.$$('./following-sibling::*//button');
  const optionTexts = [
    ...(await listboxOptions.map((option) => option.getText().catch(() => ''))),
    ...(await inlineButtonOptions.map((option) => option.getText().catch(() => ''))),
  ];

  throw new Error(
    `Custom select option not found. Tried: ${labels.join(', ')}. Available: ${optionTexts
      .filter(Boolean)
      .join(', ')}`,
  );
}