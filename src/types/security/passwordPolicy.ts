/** Local protection passwords only; never remote account credentials. */
export interface PasswordPolicy {
  version: 1;
  enabled: boolean;
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  version: 1,
  enabled: false,
  minLength: 12,
  requireUppercase: false,
  requireLowercase: false,
  requireDigit: false,
  requireSymbol: false,
};
