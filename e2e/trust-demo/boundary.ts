/** No native state, persisted profile, or real trust operation exists in this fixture. */
export const refused: string[] = [];
export function invoke(command: string): Promise<never> {
  refused.push(command);
  return Promise.reject(new Error(`Unexpected native command: ${command}`));
}
export const onCurrentDatabaseChange = () => () => {};
