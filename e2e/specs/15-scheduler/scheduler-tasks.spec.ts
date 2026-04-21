import { S } from '../../helpers/selectors';
import { resetAppState, createCollection } from '../../helpers/app';

describe('Scheduler Tasks', () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection('Scheduler Tests');
  });

  it('should open scheduler panel', async () => {
    const schedBtn = await $(S.schedulerPanel);
    await schedBtn.click();
    await browser.pause(500);

    const panel = await $('[data-testid="scheduler-panel-content"]');
    await panel.waitForDisplayed({ timeout: 5_000 });
    expect(await panel.isDisplayed()).toBe(true);
  });

  it('should create a scheduled health_check task', async () => {
    const schedBtn = await $(S.schedulerPanel);
    await schedBtn.click();
    await browser.pause(500);

    const createBtn = await $(S.schedulerAddTask);
    await createBtn.click();
    await browser.pause(500);

    const taskNameInput = await $('[data-testid="scheduler-task-name"]');
    await taskNameInput.setValue('health_check');

    const taskTypeSelect = await $('[data-testid="scheduler-task-type"]');
    await taskTypeSelect.click();
    const healthCheckOption = await $('[data-testid="task-type-health-check"]');
    await healthCheckOption.click();

    const cronInput = await $('[data-testid="scheduler-task-cron"]');
    await cronInput.setValue('*/5 * * * *');

    const saveBtn = await $('[data-testid="scheduler-task-save"]');
    await saveBtn.click();
    await browser.pause(500);
  });

  it('should show created task in the task list', async () => {
    const schedBtn = await $(S.schedulerPanel);
    await schedBtn.click();
    await browser.pause(500);

    // Create a task first
    const createBtn = await $(S.schedulerAddTask);
    await createBtn.click();
    await browser.pause(500);

    const taskNameInput = await $('[data-testid="scheduler-task-name"]');
    await taskNameInput.setValue('list_check');

    const cronInput = await $('[data-testid="scheduler-task-cron"]');
    await cronInput.setValue('0 * * * *');

    const saveBtn = await $('[data-testid="scheduler-task-save"]');
    await saveBtn.click();
    await browser.pause(500);

    const tasks = await $$('[data-testid="scheduler-task-item"]');
    expect(tasks.length).toBeGreaterThanOrEqual(1);

    const taskNames = await tasks.map((t) => t.getText());
    const found = taskNames.some((n) => n.includes('list_check'));
    expect(found).toBe(true);
  });

  it('should show next execution in upcoming tab', async () => {
    const schedBtn = await $(S.schedulerPanel);
    await schedBtn.click();
    await browser.pause(500);

    // Create a task
    const createBtn = await $(S.schedulerAddTask);
    await createBtn.click();
    await browser.pause(500);

    const taskNameInput = await $('[data-testid="scheduler-task-name"]');
    await taskNameInput.setValue('upcoming_check');

    const cronInput = await $('[data-testid="scheduler-task-cron"]');
    await cronInput.setValue('*/10 * * * *');

    const saveBtn = await $('[data-testid="scheduler-task-save"]');
    await saveBtn.click();
    await browser.pause(500);

    const upcomingTab = await $('[data-testid="scheduler-upcoming-tab"]');
    await upcomingTab.click();
    await browser.pause(500);

    const upcomingItems = await $$('[data-testid="scheduler-upcoming-item"]');
    expect(upcomingItems.length).toBeGreaterThanOrEqual(1);
  });

  it('should delete a scheduled task', async () => {
    const schedBtn = await $(S.schedulerPanel);
    await schedBtn.click();
    await browser.pause(500);

    // Create a task
    const createBtn = await $(S.schedulerAddTask);
    await createBtn.click();
    await browser.pause(500);

    const taskNameInput = await $('[data-testid="scheduler-task-name"]');
    await taskNameInput.setValue('deletable_task');

    const cronInput = await $('[data-testid="scheduler-task-cron"]');
    await cronInput.setValue('0 0 * * *');

    const saveBtn = await $('[data-testid="scheduler-task-save"]');
    await saveBtn.click();
    await browser.pause(500);

    let tasks = await $$('[data-testid="scheduler-task-item"]');
    const initialCount = await tasks.length;

    // Delete the task
    const deleteBtn = await tasks[0].$('[data-testid="scheduler-task-delete"]');
    await deleteBtn.click();
    await browser.pause(300);

    const confirmBtn = await $(S.confirmYes);
    await confirmBtn.click();
    await browser.pause(500);

    tasks = await $$('[data-testid="scheduler-task-item"]');
    expect(tasks.length).toBe(initialCount - 1);
  });
});
