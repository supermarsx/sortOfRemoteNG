import { describe, expect, it } from "vitest";
import {
  EMPTY_EXCHANGE_CONNECTION_FORM,
  EXCHANGE_CLIENT_SECRET_KEY,
  EXCHANGE_ON_PREM_PASSWORD_KEY,
  exchangeSecretsForVault,
} from "./exchangeConnectionFields";

describe("exchangeSecretsForVault", () => {
  it("does not erase relevant secrets when their plaintext is unavailable", () => {
    expect(
      exchangeSecretsForVault({
        ...EMPTY_EXCHANGE_CONNECTION_FORM,
        environment: "hybrid",
        clientSecret: "",
        password: "",
      }),
    ).toEqual({});
  });

  it("explicitly retires the on-prem secret when switching online", () => {
    expect(
      exchangeSecretsForVault({
        ...EMPTY_EXCHANGE_CONNECTION_FORM,
        environment: "online",
        clientSecret: "online-secret",
      }),
    ).toEqual({
      [EXCHANGE_CLIENT_SECRET_KEY]: "online-secret",
      [EXCHANGE_ON_PREM_PASSWORD_KEY]: undefined,
    });
  });

  it("explicitly retires the online secret when switching on-premises", () => {
    expect(
      exchangeSecretsForVault({
        ...EMPTY_EXCHANGE_CONNECTION_FORM,
        environment: "onPremises",
        password: "on-prem-secret",
      }),
    ).toEqual({
      [EXCHANGE_CLIENT_SECRET_KEY]: undefined,
      [EXCHANGE_ON_PREM_PASSWORD_KEY]: "on-prem-secret",
    });
  });
});
