import { describe, expect, it } from "vitest";
import { fail2banInvokeArgs } from "../src/hooks/ops/useFail2ban";

describe("Fail2Ban invoke argument contract", () => {
  it("uses the camel-cased Rust command parameter names", () => {
    expect(fail2banInvokeArgs.jail("host", "ssh jail")).toEqual({
      hostId: "host",
      jailName: "ssh jail",
    });
    expect(fail2banInvokeArgs.jailSeconds("host", "sshd", 600)).toEqual({
      hostId: "host",
      jailName: "sshd",
      seconds: 600,
    });
    expect(fail2banInvokeArgs.jailCount("host", "sshd", 5)).toEqual({
      hostId: "host",
      jailName: "sshd",
      count: 5,
    });
    expect(fail2banInvokeArgs.filter("host", "nginx-auth")).toEqual({
      hostId: "host",
      filterName: "nginx-auth",
    });
    expect(
      fail2banInvokeArgs.filterTest("host", "sshd", "/var/log/auth log"),
    ).toEqual({
      hostId: "host",
      logFile: "/var/log/auth log",
      filterName: "sshd",
    });
    expect(
      fail2banInvokeArgs.regexTest("host", "^it's .+$", "/var/log/auth.log"),
    ).toEqual({
      hostId: "host",
      logFile: "/var/log/auth.log",
      regex: "^it's .+$",
    });
    expect(fail2banInvokeArgs.action("host", "iptables-multiport")).toEqual({
      hostId: "host",
      actionName: "iptables-multiport",
    });
  });
});
